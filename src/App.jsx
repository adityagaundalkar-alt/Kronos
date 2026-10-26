import { useState, useEffect, useCallback, useRef, useMemo, useContext } from "react";
import { signInWithGoogle, explainAuthError, signOutUser, ensureAuth, onAuthChange, access, loadRoom, listMyTerms, saveMyTerm, removeMyTerm } from "./firebase.js";
import { iso, parseISO, addDays, fmt, fmtLong, getWeekStart, slotDate } from "./dates.js";
import { treeToState } from "./sync.js";
import { checkConflicts, getAllConflicts } from "./conflicts.js";
import { slotRange, customLabel, timeLabel, startKey, validateCustomTimes, fromMinutes } from "./timeslots.js";
import { DAYS, DAYS_FULL, WEEKS, PALETTE, ROOM_TYPES, CATEGORIES, uid, initials, getPalette, paletteById } from "./constants.js";
import { emptyState, termFrom, sanitizeState, loadLocal, saveLocal, backupLocalState, loadRecentRooms, forgetRoom } from "./state.js";
import { PresenceCtx, CollabCtx } from "./collab/context.js";
import { planMoves, shiftMoves } from "./move.js";
import { planRepeat } from "./repeat.js";
import { suggestFixes } from "./fixes.js";
import { askConfirm, ConfirmProvider } from "./ui/Confirm.jsx";
import { buildGroupTree } from "./groups.js";
import { changesBetween, applyChanges, invert, MAX_HISTORY } from "./history.js";
import GroupPicker from "./ui/GroupPicker.jsx";
import SearchSelect from "./ui/SearchSelect.jsx";
import { Badge, Btn, Modal, Field, EmptyState, Segmented, Avatar, useMedia, useTheme, useToasts, Toasts } from "./ui/kit.jsx";
import Icon from "./ui/Icon.jsx";
import AvailabilityGrid from "./features/AvailabilityGrid.jsx";
import { CommentsPanel, CommentsTab } from "./features/Comments.jsx";
import AutoScheduleTab from "./features/AutoSchedule.jsx";
import { useCollaboration } from "./collab/useCollaboration.js";
import { CollabModal, ShareModal, RoomBar, AccessLostModal, ActivityFeed, RolePill } from "./collab/CollabUI.jsx";
import { codeFromSearch, ROLE_LABEL } from "./access.js";
import { Rail, TabBar, MoreSheet, visibleViews, VIEWS } from "./shell/Shell.jsx";
import LoginScreen from "./shell/Login.jsx";
import TermsScreen from "./shell/Terms.jsx";

// ═══════════════════════════════════════════════════════════════════
//  APPOINTMENT MODAL
// ═══════════════════════════════════════════════════════════════════
function ApptModal({appt,weekNum,dayIdx,timeId,state,onSave,onClose,onDelete,readOnly=false}) {
  const {courses,instructors,rooms,groups,appointments,slots}=state;
  const isEdit=!!appt;
  const [form,setForm]=useState(()=>{
    if(isEdit) return {...appt};
    const w=weekNum??1,d=dayIdx??0,t=timeId??slots[0]?.id;
    return {weekNum:w,dayIdx:d,timeId:t,courseId:"",instructorId:"",roomId:"",groupIds:[],section:"",notes:""};
  });
  const [repeat,setRepeat]=useState({every:0,until:16});
  // "Other event": extra classes, workshops, exams - anything that is not one of the term's courses.
  const [other,setOther]=useState(()=>!!(isEdit&&!appt.courseId&&appt.courseName));
  const hasWhat=!!form.courseId||(other&&!!(form.courseName||"").trim());
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [overrides,setOverrides]=useState(()=>({instructor:false,room:false,group:false,...Object.fromEntries((isEdit&&Array.isArray(appt.overrides)?appt.overrides:[]).map(t=>[t,true]))}));

  // Collaboration awareness: who else has this session open, and did it change underneath us?
  const {editing}=useContext(PresenceCtx);
  const otherEditors=isEdit?(editing[appt.id]||[]):[];
  const openedAs=useRef(isEdit?JSON.stringify(appt):null);
  const liveAppt=isEdit?appointments[appt.id]:null;
  const deletedRemotely=isEdit&&!liveAppt;
  const changedRemotely=isEdit&&!!liveAppt&&JSON.stringify(liveAppt)!==openedAs.current;

  // auto-fill from course
  useEffect(()=>{
    if(!form.courseId) return;
    const c=courses.find(x=>x.id===form.courseId);
    if(!c) return;
    setForm(f=>({...f,
      instructorId:f.instructorId||c.defaultInstructorId||"",
      groupIds:(Array.isArray(f.groupIds)&&f.groupIds.length)?f.groupIds:(c.defaultGroupIds||[]),
    }));
  },[form.courseId]);

  // Optional custom start/end inside the slot (e.g. 10:00-11:30 in a 09:00-12:00 slot)
  const [useCustom,setUseCustom]=useState(()=>isEdit&&!!(appt.start&&appt.end));
  const slotObj=slots.find(s=>s.id===form.timeId);
  const timesCheck=useCustom?validateCustomTimes(form.start,form.end,slotObj):{ok:true,message:"",outsideSlot:false};
  function toggleCustom(on) {
    setUseCustom(on);
    if(on) {
      const r=slotRange(slotObj); // start from the slot's own window so nothing changes until edited
      setForm(f=>({...f,start:f.start||(r?fromMinutes(r.start):"09:00"),end:f.end||(r?fromMinutes(r.end):"10:00")}));
    }
  }
  // What the session will actually be saved as (no leftover times when custom is off)
  const effective=useMemo(()=>{
    const {start,end,...rest}=form;
    return useCustom?{...rest,start,end}:rest;
  },[form,useCustom]);

  const conflicts=useMemo(()=>checkConflicts(appointments,effective,slots,isEdit?appt.id:null),[effective,appointments,slots]);
  const blockingConflicts=conflicts.filter(c=>!overrides[c.type]);
  // What a repeat would save, with the weeks it has to skip.
  const plan=useMemo(()=>repeat.every>0&&!isEdit?planRepeat({appointments,slots,holidays:state.holidays,week1Start:state.week1Start},{...effective,overrides:[...new Set(conflicts.map(c=>c.type))].filter(t=>overrides[t])},{every:repeat.every,until:Math.max(repeat.until,form.weekNum),newId:uid}):null,[repeat,effective,appointments,slots,overrides,conflicts,isEdit,state.holidays,state.week1Start,form.weekNum]);

  function handleSave() {
    if(!hasWhat||form.weekNum===undefined) return;
    if(deletedRemotely) return; // someone else deleted it - saving would silently resurrect it
    if(blockingConflicts.length) return;
    const course=courses.find(x=>x.id===form.courseId);
    if(!timesCheck.ok) return;
    const base={...effective,courseName:other?(form.courseName||"").trim():course?.name,courseCode:other?((form.courseCode||"").trim()||"EXTRA"):course?.code,section:form.section||""};
    if(other) base.courseId="";
    // Remember which clashes were knowingly overridden, so they show as resolved (but still tracked) in Conflicts.
    const kept=[...new Set(conflicts.map(c=>c.type))].filter(t=>overrides[t]);
    if(kept.length) base.overrides=kept; else delete base.overrides;
    const toSave=[];
    if(repeat.every>0&&!isEdit) {
      const real=planRepeat({appointments,slots,holidays:state.holidays,week1Start:state.week1Start},base,{every:repeat.every,until:Math.max(repeat.until,form.weekNum),newId:uid});
      toSave.push(...real.toSave);
      if(!toSave.length) return;
    } else {
      toSave.push(isEdit?{...base,id:appt.id}:{...base,id:uid()});
    }
    onSave(toSave,isEdit);
  }

  const selCourse=courses.find(x=>x.id===form.courseId);
  const pal=selCourse?paletteById(selCourse.colorId):null;

  return (
    <Modal title={readOnly?"Session":isEdit?"Edit session":"New session"}
      subtitle={isEdit?`${appt.courseCode} · ${DAYS_FULL[appt.dayIdx]} ${slots.find(s=>s.id===appt.timeId)?.short||appt.timeId}${customLabel(appt)?" · "+customLabel(appt):""}`:"Schedule a new class session"}
      onClose={onClose} width={520}>
      <div style={{padding:20,display:"flex",flexDirection:"column",gap:0}}>
        {deletedRemotely&&(
          <div className="callout bad" role="alert" style={{marginBottom:12}}>
            A collaborator deleted this session. Close this window. Saving is turned off so it isn't brought back by accident.
          </div>
        )}
        {!deletedRemotely&&changedRemotely&&!readOnly&&(
          <div className="callout warn" role="status" style={{marginBottom:12}}>
            A collaborator changed this session while you had it open. Saving will overwrite their change.
          </div>
        )}
        {otherEditors.length>0&&!readOnly&&(
          <div className="callout info" role="status" style={{marginBottom:12}}>
            {otherEditors.map(e=>e.name).join(", ")} {otherEditors.length>1?"are":"is"} also editing this session.
          </div>
        )}
        {readOnly&&<div className="callout info" style={{marginBottom:12}}>You have view-only access, so you can read this session and comment on it.</div>}
        <fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>
        {/* Course */}
        <Field label="Course" required>
          <SearchSelect value={other?"__other":form.courseId} placeholder="— Select course —" options={[...courses.map(c=>({value:c.id,label:`[${c.code}] ${c.name}`})),{value:"__other",label:"Other event (extra class, workshop, exam…)"}]} onChange={v=>{
            if(v==="__other"){setOther(true);setForm(f=>({...f,courseId:"",instructorId:"",groupIds:[]}));}
            else{setOther(false);setForm(f=>{const n={...f,courseId:v,instructorId:"",groupIds:[]};delete n.courseName;delete n.courseCode;return n;});}
          }}/>
        </Field>
        {other&&(
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8}}>
            <Field label="Event title" required>
              <input value={form.courseName||""} onChange={e=>setForm(f=>({...f,courseName:e.target.value}))} placeholder="e.g. Extra class: Machine Learning"/>
            </Field>
            <Field label="Short code" hint="Optional">
              <input value={form.courseCode||""} onChange={e=>setForm(f=>({...f,courseCode:e.target.value}))} placeholder="EXTRA" maxLength={12}/>
            </Field>
          </div>
        )}
        {pal&&(
          <div style={{marginBottom:12,padding:"8px 10px",borderRadius:"var(--r)",
            background:pal.bg,border:`1px solid ${pal.border}`,
            display:"flex",alignItems:"center",gap:8,fontSize:14,color:pal.accent}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:pal.accent,flexShrink:0}}/>
            {selCourse.name} · {selCourse.credits} credits · {selCourse.category}
          </div>
        )}

        {/* Week + Day + Time */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
          <Field label="Week">
            <select value={form.weekNum} onChange={e=>setForm(f=>({...f,weekNum:+e.target.value}))}>
              {WEEKS.map(w=><option key={w.n} value={w.n}>{w.label}</option>)}
            </select>
          </Field>
          <Field label="Day">
            <select value={form.dayIdx} onChange={e=>setForm(f=>({...f,dayIdx:+e.target.value}))}>
              {DAYS_FULL.map((d,i)=><option key={i} value={i}>{d}</option>)}
            </select>
          </Field>
          <Field label="Slot">
            <select value={form.timeId} onChange={e=>setForm(f=>({...f,timeId:e.target.value}))}>
              {slots.map(s=><option key={s.id} value={s.id}>{s.short}</option>)}
            </select>
          </Field>
        </div>

        {/* Optional custom time within the slot */}
        <div style={{marginBottom:12}}>
          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,color:"var(--muted)",cursor:"pointer"}}>
            <input type="checkbox" checked={useCustom} onChange={e=>toggleCustom(e.target.checked)}
              style={{width:"auto",margin:0}}/>
            Custom time {slotObj&&<span style={{color:"var(--muted2)"}}>(default: whole slot{slotObj.label?`, ${slotObj.label}`:""})</span>}
          </label>
          {useCustom&&(
            <div style={{marginTop:8}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Field label="Starts">
                  <input type="time" value={form.start||""} onChange={e=>setForm(f=>({...f,start:e.target.value}))}/>
                </Field>
                <Field label="Ends">
                  <input type="time" value={form.end||""} onChange={e=>setForm(f=>({...f,end:e.target.value}))}/>
                </Field>
              </div>
              {!timesCheck.ok&&<div style={{fontSize:12.5,color:"var(--danger)",marginTop:-4}}>{timesCheck.message}</div>}
              {timesCheck.ok&&timesCheck.outsideSlot&&(
                <div style={{fontSize:12.5,color:"var(--warn)",marginTop:-4}}>
                  These times extend outside the {slotObj?.short||"slot"} window; the session will still show in that slot.
                </div>
              )}
              {!slotRange(slotObj)&&(
                <div style={{fontSize:11.5,color:"var(--muted2)",marginTop:2}}>
                  Tip: put times in the slot name (Settings, e.g. "09:00 – 12:00") so sessions in different slots can be checked against each other.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Instructor + Room */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <Field label="Instructor">
            <SearchSelect value={form.instructorId||""} onChange={v=>setForm(f=>({...f,instructorId:v}))} noneLabel="— None —" options={instructors.map(i=>({value:i.id,label:i.name}))}/>
          </Field>
          <Field label="Room">
            <SearchSelect value={form.roomId||""} onChange={v=>setForm(f=>({...f,roomId:v}))} noneLabel="— TBD —" options={rooms.map(r=>({value:r.id,label:r.name,hint:`${r.capacity} seats`}))}/>
          </Field>
        </div>

        {/* Groups */}
        <Field label="Student Groups">
          <GroupPicker groups={groups} value={form.groupIds} onChange={v=>setForm(f=>({...f,groupIds:v}))} placeholder="Select groups..."/>
        </Field>

        {/* Section + Notes */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:8,marginBottom:12}}>
          <Field label="Section" hint="e.g. A, B, 1, 2">
            <input value={form.section||""} onChange={e=>setForm(f=>({...f,section:e.target.value}))}
              placeholder="e.g. A"/>
          </Field>
          <Field label="Notes" hint="Optional session notes">
            <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
              placeholder="Any notes for this session..."/>
          </Field>
        </div>

        {/* Conflicts */}
        {conflicts.length>0&&(
          <div style={{marginBottom:12}}>
            {conflicts.map((c,i)=>(
              <div key={i} className={overrides[c.type]?"callout":"callout bad"} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:4}}>
                <span style={{fontSize:14,color:overrides[c.type]?"var(--muted)":"var(--danger)"}}>
                  {c.label} — {c.clash}
                </span>
                <Btn variant={overrides[c.type]?"outline":"danger"} size="xs"
                  onClick={()=>setOverrides(o=>({...o,[c.type]:!o[c.type]}))}>
                  {overrides[c.type]?"Blocked":"Override"}
                </Btn>
              </div>
            ))}
          </div>
        )}

        {/* Pin */}
        <label style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:12,cursor:readOnly?"default":"pointer"}}>
          <input type="checkbox" checked={!!form.locked} onChange={e=>{const on=e.target.checked;setForm(f=>{const n={...f};if(on)n.locked=true;else delete n.locked;return n;});}} style={{width:"auto",margin:"3px 0 0"}}/>
          <span style={{fontSize:14}}><b>Pin this session</b><span style={{display:"block",color:"var(--muted)",fontSize:14}}>Auto-schedule won't move or remove it.</span></span>
        </label>

        {/* Repeat */}
        {!isEdit&&(
          <div style={{marginBottom:16,padding:"10px 12px",borderRadius:"var(--r)",background:"var(--bg3)",border:"1px solid var(--border)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <label htmlFor="rep-every" style={{fontSize:14,fontWeight:600}}>Repeat</label>
              <select id="rep-every" value={repeat.every} onChange={e=>setRepeat(r=>({...r,every:+e.target.value}))} style={{width:"auto"}}>
                <option value={0}>Does not repeat</option>
                <option value={1}>Every week</option>
                <option value={2}>Every 2 weeks</option>
                <option value={3}>Every 3 weeks</option>
                <option value={4}>Every 4 weeks</option>
              </select>
              {repeat.every>0&&<>
                <label htmlFor="rep-until" style={{fontSize:14}}>until</label>
                <select id="rep-until" value={Math.max(repeat.until,form.weekNum)} onChange={e=>setRepeat(r=>({...r,until:+e.target.value}))} style={{width:"auto"}}>
                  {WEEKS.filter(w=>w.n>=form.weekNum&&w.n>0).map(w=><option key={w.n} value={w.n}>{w.label}</option>)}
                </select>
              </>}
            </div>
            {plan&&(
              <div role="status" style={{fontSize:13,color:"var(--muted)",marginTop:8}}>
                {plan.toSave.length?`Will add ${plan.toSave.length} session${plan.toSave.length===1?"":"s"}: ${plan.toSave.map(a=>WEEKS.find(w=>w.n===a.weekNum)?.short).join(", ")}.`:"Nothing can be added with these settings."}
                {plan.holiday.length>0&&` Skipping holidays: ${plan.holiday.map(w=>`W${w}`).join(", ")}.`}
                {plan.clash.length>0&&` Skipping clashes: ${plan.clash.map(w=>`W${w}`).join(", ")}.`}
              </div>
            )}
          </div>
        )}
        </fieldset>

        {/* Actions */}
        {confirmDelete&&!readOnly&&(
          <div className="callout bad" role="alertdialog" style={{marginBottom:12}}>
            <div style={{marginBottom:8}}>{appt?.locked?"This session is pinned. ":""}Delete this session{appt?.courseCode?` (${appt.courseCode})`:""}? Its comments are deleted too.</div>
            <div style={{display:"flex",gap:8}}>
              <Btn variant="danger" onClick={()=>onDelete(appt.id)}>Delete session</Btn>
              <Btn variant="outline" onClick={()=>setConfirmDelete(false)}>Keep it</Btn>
            </div>
          </div>
        )}
        {isEdit&&<div style={{marginBottom:14}}><CommentsPanel apptId={appt.id}/></div>}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",paddingTop:4}}>
          <div>
            {isEdit&&!readOnly&&!confirmDelete&&<Btn variant="danger" onClick={()=>setConfirmDelete(true)}>Delete</Btn>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="outline" onClick={onClose}>{readOnly?"Close":"Cancel"}</Btn>
            {!readOnly&&<Btn variant="primary" onClick={handleSave}
              disabled={!hasWhat||blockingConflicts.length>0||!timesCheck.ok||deletedRemotely}
              style={{minWidth:90}}>
              {isEdit?"Update":"Schedule"}
            </Btn>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CHIP (appointment cell)
// ═══════════════════════════════════════════════════════════════════
function ApptChip({appt,courses,instructors,rooms,onClick,conflicts=[],selectable=false,selected=false,draggable=false,onDragStart,onDragEnd}) {
  const pal=getPalette(appt.courseId,courses);
  const hasConflict=(conflicts||[]).some(c=>c&&c.a&&c.b&&(c.a.id===appt.id||c.b.id===appt.id));
  const instr=instructors.find(x=>x.id===appt.instructorId);
  const room=rooms.find(x=>x.id===appt.roomId);
  const editors=useContext(PresenceCtx).editing[appt.id]||[];
  const openComments=useContext(CollabCtx).comments.open[appt.id]||0;
  const label=`${appt.courseCode} ${appt.courseName}${instr?`, ${instr.name}`:""}${room?`, ${room.name}`:""}${hasConflict?", has a clash":""}${appt.locked?", pinned":""}${openComments?`, ${openComments} open comment${openComments>1?"s":""}`:""}`;
  return (
    <button type="button" className={`session${hasConflict?" clash":""}`} onClick={e=>{e.stopPropagation();onClick(appt);}}
      aria-label={label} aria-pressed={selectable?selected:undefined}
      draggable={draggable||undefined} onDragStart={draggable?e=>onDragStart?.(e,appt):undefined} onDragEnd={draggable?onDragEnd:undefined}
      title={editors.length?`Being edited by ${editors.map(e=>e.name).join(", ")}`:undefined}
      style={{background:pal.bg,borderColor:editors.length?editors[0].color:pal.border,borderLeftColor:pal.accent,color:pal.accent,
        boxShadow:selected?"0 0 0 2px var(--accent)":editors.length?`0 0 0 1px ${editors[0].color}`:undefined,cursor:draggable?"grab":undefined,outline:selected?"2px solid var(--accent)":undefined,outlineOffset:selected?1:undefined}}>
      {selectable&&<span aria-hidden="true" style={{position:"absolute",top:3,right:4,width:16,height:16,borderRadius:4,border:"1.5px solid "+(selected?"var(--accent)":"var(--border2)"),background:selected?"var(--accent)":"var(--bg2)",color:"var(--on-accent)",display:"grid",placeItems:"center"}}>{selected&&<Icon name="check" size={11} style={{strokeWidth:3}}/>}</span>}
      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:1}}>
        <span className="code">{appt.courseCode}{appt.section?` §${appt.section}`:""}</span>
        {customLabel(appt)&&<span title="Custom time" style={{fontSize:11.5,fontFamily:"var(--mono)",color:"var(--muted)"}}>{customLabel(appt)}</span>}
        <span style={{flex:1}}/>
        {appt.locked&&<span title="Pinned: auto-schedule won't move it" style={{display:"inline-flex"}}><Icon name="lock" size={13}/></span>}
        {openComments>0&&<span title={`${openComments} open comment${openComments>1?"s":""}`} style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:11.5,fontWeight:700}}><Icon name="chat" size={13}/>{openComments}</span>}
      </div>
      <div className="sname">{appt.courseName}</div>
      {(instr||room)&&<div className="smeta">{instr?instr.name.split(" ").slice(-1)[0]:""}{instr&&room?" · ":""}{room?room.name:""}</div>}
      {editors.length>0&&(
        <div style={{position:"absolute",bottom:3,right:4,display:"flex",gap:2}}>
          {editors.slice(0,3).map((e,k)=>(
            <span key={k} title={e.name} style={{width:16,height:16,borderRadius:"50%",background:e.color,color:"#fff",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{initials(e.name)}</span>
          ))}
        </div>
      )}
    </button>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  COHORT TIMETABLE EXPORT
// ═══════════════════════════════════════════════════════════════════
function exportCohortHTML(state, groupId) {
  const {appointments,courses,instructors,rooms,groups,week1Start,slots,settings}=state;
  const group=groups.find(g=>g.id===groupId);
  if(!group) return;

  const appts=Object.values(appointments).filter(a=>(a.groupIds||[]).includes(groupId));

  // Build week→day→slot map
  const byWeek={};
  appts.forEach(a=>{
    if(!byWeek[a.weekNum]) byWeek[a.weekNum]={};
    const k=`${a.dayIdx}_${a.timeId}`;
    if(!byWeek[a.weekNum][k]) byWeek[a.weekNum][k]=[];
    byWeek[a.weekNum][k].push(a);
  });

  const weeks=WEEKS.filter(w=>w.n>0);
  

  let rows="";
  weeks.forEach(w=>{
    const ws=getWeekStart(week1Start,w.n);
    let hasContent=Object.keys(byWeek[w.n]||{}).length>0;
    if(!hasContent) return;
    rows+=`<tr class="week-header"><td colspan="${1+DAYS.length*slots.length}">${w.label} &mdash; ${fmt(ws)} &ndash; ${fmt(addDays(ws,DAYS.length-1))}</td></tr>
<tr>`;
    rows+=`<td class="slot-label"></td>`;
    DAYS.forEach((d,di)=>{
      const dt=slotDate(week1Start,w.n,di);
      rows+=`<td colspan="${slots.length}" class="day-header">${d}<br><span class="date">${fmt(dt)}</span></td>`;
    });
    rows+="</tr><tr>";
    rows+=`<td class="slot-label">Time</td>`;
    DAYS.forEach((_,di)=>{
      slots.forEach(s=>{
        rows+=`<td class="slot-time">${s.short}<br><span class="date">${s.label}</span></td>`;
      });
    });
    rows+="</tr><tr>";
    rows+=`<td class="slot-label">Sessions</td>`;
    DAYS.forEach((_,di)=>{
      slots.forEach(s=>{
        const key=`${di}_${s.id}`;
        const cells=[...((byWeek[w.n]||{})[key]||[])].sort((x,y)=>startKey(x,slots)-startKey(y,slots));
        if(cells.length===0){rows+=`<td class="empty"></td>`;return;}
        const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
        const block=cell=>{
          const pal=getPalette(cell.courseId,courses);
          const instr=instructors.find(x=>x.id===cell.instructorId);
          const room=rooms.find(x=>x.id===cell.roomId);
          return {pal,html:`
          <div class="code" style="color:${pal.accent}">${esc(cell.courseCode)}</div>
          ${customLabel(cell)?`<div class="meta">${esc(customLabel(cell))}</div>`:""}
          <div class="name">${esc(cell.courseName)}</div>
          ${instr?`<div class="meta">${esc(instr.name)}</div>`:""}
          ${room?`<div class="meta">${esc(room.name)}</div>`:""}`};
        };
        if(cells.length===1){
          const {pal,html}=block(cells[0]);
          rows+=`<td class="session" style="background:${pal.bg};border-color:${pal.border}">${html}</td>`;
        } else { // several sessions share this slot (custom times): list them in time order
          rows+=`<td class="session multi">${cells.map(c=>{const {pal,html}=block(c);
            return `<div class="sub" style="background:${pal.bg};border-color:${pal.border}">${html}</div>`;}).join("")}</td>`;
        }
      });
    });
    rows+="</tr>";
  });

  const html=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${group.name} — Timetable — ${settings.semester}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Outfit',sans-serif;background:#f8fafc;color:#1e293b;padding:24px;font-size:14px;}
  h1{font-size:22px;font-weight:700;margin-bottom:4px;}
  .subtitle{color:#64748b;font-size:13px;margin-bottom:24px;}
  table{width:100%;border-collapse:separate;border-spacing:3px;margin-bottom:32px;}
  td,th{padding:6px 8px;border-radius:6px;vertical-align:top;}
  .week-header td{background:#1e293b;color:#f1f5f9;font-weight:600;font-size:12px;
    letter-spacing:0.06em;padding:8px 10px;border-radius:6px;}
  .day-header{background:#e2e8f0;font-weight:600;font-size:12px;text-align:center;color:#334155;}
  .slot-label{color:#94a3b8;font-size:11px;width:60px;}
  .multi{background:#fff;padding:4px;}
  .sub{border:1px solid;border-radius:6px;padding:4px 6px;margin-bottom:4px;text-align:left;}
  .sub:last-child{margin-bottom:0;}
  .slot-time{background:#f1f5f9;font-size:10px;color:#64748b;text-align:center;
    font-family:'JetBrains Mono',monospace;}
  .date{font-size:9px;color:#94a3b8;font-family:'JetBrains Mono',monospace;}
  .session{border:1px solid;border-radius:6px;min-width:110px;}
  .code{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;margin-bottom:3px;}
  .name{font-size:11px;font-weight:500;line-height:1.3;}
  .meta{font-size:10px;color:#64748b;margin-top:2px;}
  .empty{background:#f8fafc;}
  @media print{body{padding:8px;}h1{font-size:16px;}}
  .print-btn{position:fixed;top:16px;right:16px;background:#1e293b;color:#f1f5f9;
    border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-family:inherit;
    font-size:13px;font-weight:500;}
  .print-btn:hover{background:#334155;}
  @media print{.print-btn{display:none;}}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<h1>${group.name} — Timetable</h1>
<div class="subtitle">${settings.institution} &middot; ${settings.semester} &middot; ${appts.length} sessions scheduled</div>
<table>${rows}</table>
</body></html>`;

  const blob=new Blob([html],{type:"text/html"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`${group.name.replace(/\s+/g,"-")}-timetable.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCohortCSV(state, groupId) {
  const {appointments,courses,instructors,rooms,groups,slots}=state;
  const group=groups.find(g=>g.id===groupId);
  if(!group) return;
  const appts=Object.values(appointments)
    .filter(a=>(a.groupIds||[]).includes(groupId))
    .sort((a,b)=>a.weekNum-b.weekNum||a.dayIdx-b.dayIdx);
  const rows=[["Week","Day","Slot","Time","Course Code","Course Name","Instructor","Room","All Groups"]];
  appts.forEach(a=>{
    const instr=instructors.find(x=>x.id===a.instructorId)?.name||"";
    const room=rooms.find(x=>x.id===a.roomId)?.name||"";
    const grps=(a.groupIds||[]).map(g=>groups.find(x=>x.id===g)?.name).filter(Boolean).join("|");
    const slotLabel=timeLabel(a,slots);
    rows.push([WEEKS.find(w=>w.n===a.weekNum)?.label||`W${a.weekNum}`,
      DAYS_FULL[a.dayIdx],a.timeId.toUpperCase(),slotLabel,
      a.courseCode||"",a.courseName||"",instr,room,grps]);
  });
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`${group.name.replace(/\s+/g,"-")}-timetable.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}


// ── Export dropdown component ──────────────────────────────────────
function ExportDropdown({state,filterGroups=[]}) {
  const [open,setOpen]=useState(false);
  const ref=useRef();
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);
  const groups=state.groups;
  const targets=filterGroups.filter(id=>groups.some(g=>g.id===id));
  const targetGroup=targets.length===1?targets[0]:null;

  return (
    <div ref={ref} style={{position:"relative"}}>
      <Btn variant="outline" onClick={()=>setOpen(v=>!v)}>
        <Icon name="download" size={15}/> Export <Icon name={open?"up":"down"} size={14}/>
      </Btn>
      {open&&(
        <div style={{position:"absolute",top:"100%",right:0,marginTop:4,zIndex:50,
          background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:"var(--r2)",
          minWidth:220,boxShadow:"var(--shadow)",overflow:"hidden"}}>
          <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",
            fontSize:11.5,color:"var(--muted)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>
            Export Cohort Timetable
          </div>
          {targets.length===0&&(
            <div style={{padding:"10px 12px",fontSize:12.5,color:"var(--muted)"}}>
              Use the group filter to select a cohort first
            </div>
          )}
          {targets.length>1&&targets.map(id=>(
            <div key={id} style={{padding:"8px 14px",fontSize:13,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8}}>
              <span style={{flex:1,fontWeight:500}}>{groups.find(g=>g.id===id)?.name}</span>
              <Btn variant="outline" size="xs" onClick={()=>{exportCohortHTML(state,id);setOpen(false);}}>HTML</Btn>
              <Btn variant="outline" size="xs" onClick={()=>{exportCohortCSV(state,id);setOpen(false);}}>CSV</Btn>
            </div>
          ))}
          {targetGroup&&(
            <>
              <div onClick={()=>{exportCohortHTML(state,targetGroup);setOpen(false);}}
                style={{padding:"10px 14px",cursor:"pointer",fontSize:13,
                  borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--bg4)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{fontSize:14}}>🌐</span>
                <div>
                  <div style={{fontWeight:500}}>Export as HTML</div>
                  <div style={{fontSize:11.5,color:"var(--muted)"}}>Full printable timetable · open in browser</div>
                </div>
              </div>
              <div onClick={()=>{exportCohortCSV(state,targetGroup);setOpen(false);}}
                style={{padding:"10px 14px",cursor:"pointer",fontSize:13,
                  display:"flex",alignItems:"center",gap:8}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--bg4)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{fontSize:14}}>📊</span>
                <div>
                  <div style={{fontWeight:500}}>Export as CSV</div>
                  <div style={{fontSize:11.5,color:"var(--muted)"}}>All sessions · open in Excel or Sheets</div>
                </div>
              </div>
            </>
          )}
          {/* Export all groups */}
          <div style={{borderTop:"1px solid var(--border)",padding:"6px 8px",display:"flex",flexWrap:"wrap",gap:4}}>
            {groups.map(g=>(
              <button key={g.id}
                onClick={()=>{exportCohortHTML(state,g.id);setOpen(false);}}
                style={{fontSize:11.5,padding:"3px 8px",borderRadius:99,cursor:"pointer",
                  background:"var(--bg4)",border:"1px solid var(--border2)",
                  color:"var(--muted)",fontFamily:"inherit"}}
                onMouseEnter={e=>e.currentTarget.style.color="var(--accent)"}
                onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SCHEDULE TAB
// ═══════════════════════════════════════════════════════════════════
function ScheduleTab({state,onApptClick,onCellClick,conflicts,onMove,onDeleteMany}) {
  const {appointments,courses,instructors,rooms,week1Start,holidays,slots}=state;
  const {canEdit}=useContext(CollabCtx);
  const isPhone=useMedia("(max-width: 760px)");
  const [filterGroups,setFilterGroups]=useState([]);
  const [selWeek,setSelWeek]=useState(1);
  const [selectMode,setSelectMode]=useState(false);
  const [sel,setSel]=useState([]);
  const dragRef=useRef(null);
  const [overCell,setOverCell]=useState(null);
  const ws=getWeekStart(week1Start,selWeek);
  const days=DAYS.slice(0,Object.values(appointments).some(x=>x.dayIdx>=5)?DAYS.length:5); // Saturday appears only when a session uses it

  const holidayOn=di=>{
    const d=iso(slotDate(week1Start,selWeek,di));
    return holidays.find(h=>h.date===d)||null;
  };

  const apptMap=useMemo(()=>{
    const m={};
    Object.values(appointments).forEach(a=>{
      if(a.weekNum!==selWeek) return;
      if(filterGroups.length&&!(a.groupIds||[]).some(g=>filterGroups.includes(g))) return;
      (m[`${a.dayIdx}_${a.timeId}`]||=[]).push(a);
    });
    Object.values(m).forEach(list=>list.sort((x,y)=>startKey(x,slots)-startKey(y,slots)));
    return m;
  },[appointments,selWeek,filterGroups,slots]);

  const toggleSel=id=>setSel(l=>l.includes(id)?l.filter(x=>x!==id):[...l,id]);
  const visibleIds=Object.values(apptMap).flat().map(a=>a.id);
  const slotOrder=slots.map(x=>x.id);
  function startDrag(e,a) {
    dragRef.current=a.id;
    e.dataTransfer.effectAllowed="move";
    e.dataTransfer.setData("text/plain",a.id);
  }
  function dropOn(di,slotId) {
    const a=appointments[dragRef.current]; dragRef.current=null; setOverCell(null);
    if(!a||!onMove) return;
    const ids=sel.includes(a.id)?sel:[a.id]; // dragging one of the selected sessions moves them all by the same amount
    const dDay=di-a.dayIdx, dSlot=slotOrder.indexOf(slotId)-slotOrder.indexOf(a.timeId), dWeek=selWeek-a.weekNum;
    onMove(ids.map(id=>{const x=appointments[id]; if(!x) return {id}; const si=slotOrder.indexOf(x.timeId)+dSlot; return {id,weekNum:x.weekNum+dWeek,dayIdx:x.dayIdx+dDay,timeId:slotOrder[si]??""};}),ids.length>1?`${ids.length} sessions`:(a.courseCode||a.courseName));
  }
  const chip=a=><ApptChip key={a.id} appt={a} courses={courses} instructors={instructors} rooms={rooms} conflicts={conflicts}
    onClick={selectMode?(x=>toggleSel(x.id)):onApptClick} selectable={selectMode} selected={sel.includes(a.id)}
    draggable={canEdit&&!selectMode||canEdit&&selectMode&&sel.includes(a.id)} onDragStart={startDrag} onDragEnd={()=>{dragRef.current=null;setOverCell(null);}}/>;
  const addBtn=(di,slot,label)=>canEdit&&(
    <button type="button" className="add-hint" aria-label={label} onClick={e=>{e.stopPropagation();onCellClick(selWeek,di,slot.id);}}
      style={{width:"100%",background:"transparent",border:0}}><Icon name="plus" size={16}/></button>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",minHeight:0}}>
      <div className="no-print" style={{padding:"10px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10,flexShrink:0,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <Btn variant="outline" icon label="Previous week" onClick={()=>setSelWeek(v=>Math.max(0,v-1))}><Icon name="left" size={16}/></Btn>
          <select aria-label="Week" value={selWeek} onChange={e=>setSelWeek(+e.target.value)} style={{width:150}}>
            {WEEKS.map(w=><option key={w.n} value={w.n}>{w.label}</option>)}
          </select>
          <Btn variant="outline" icon label="Next week" onClick={()=>setSelWeek(v=>Math.min(16,v+1))}><Icon name="right" size={16}/></Btn>
        </div>
        <span style={{fontSize:14,color:"var(--muted)",fontFamily:"var(--mono)"}}>{fmt(ws)} to {fmt(addDays(ws,days.length-1))}</span>
        <div style={{flex:1}}/>
        {canEdit&&<Btn variant={selectMode?"accent":"outline"} onClick={()=>{setSelectMode(v=>!v);setSel([]);}} aria-pressed={selectMode}>{selectMode?"Done selecting":"Select"}</Btn>}
        <GroupPicker groups={state.groups} value={filterGroups} onChange={setFilterGroups} compact noneLabel="All groups" placeholder="All groups" style={{width:260,maxWidth:"100%"}}/>
        <ExportDropdown state={state} filterGroups={filterGroups}/>
      </div>
      {selectMode&&(
        <div className="no-print" role="toolbar" aria-label="Selected sessions" style={{padding:"8px 16px",borderBottom:"1px solid var(--border)",background:"var(--accent-soft)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flexShrink:0}}>
          <b style={{fontSize:14}}>{sel.length} selected</b>
          <Btn variant="outline" size="xs" onClick={()=>setSel(visibleIds)}>All in this week</Btn>
          <Btn variant="outline" size="xs" onClick={()=>setSel([])} disabled={!sel.length}>Clear</Btn>
          <span style={{width:1,height:20,background:"var(--border2)"}}/>
          <Btn variant="outline" size="xs" disabled={!sel.length} onClick={()=>onMove(shiftMoves(state,sel,{days:-1}),`${sel.length} sessions`)}>Day ‹</Btn>
          <Btn variant="outline" size="xs" disabled={!sel.length} onClick={()=>onMove(shiftMoves(state,sel,{days:1}),`${sel.length} sessions`)}>Day ›</Btn>
          <Btn variant="outline" size="xs" disabled={!sel.length} onClick={()=>onMove(shiftMoves(state,sel,{weeks:-1}),`${sel.length} sessions`)}>Week ‹</Btn>
          <Btn variant="outline" size="xs" disabled={!sel.length} onClick={()=>onMove(shiftMoves(state,sel,{weeks:1}),`${sel.length} sessions`)}>Week ›</Btn>
          <select aria-label="Move selected to week" disabled={!sel.length} value="" onChange={e=>{if(e.target.value!=="")onMove(sel.map(id=>({id,weekNum:+e.target.value})),`${sel.length} sessions`);}} style={{width:"auto"}}>
            <option value="">Move to week…</option>
            {WEEKS.map(w=><option key={w.n} value={w.n}>{w.label}</option>)}
          </select>
          <div style={{flex:1}}/>
          <Btn variant="danger" size="xs" disabled={!sel.length} onClick={async()=>{if(await onDeleteMany(sel))setSel([]);}}><Icon name="trash" size={14}/> Delete</Btn>
        </div>
      )}

      <div style={{flex:1,overflow:"auto",padding:isPhone?12:16,minHeight:0,WebkitOverflowScrolling:"touch"}}>
        {!isPhone?(
          <div className="sheet-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="period" style={{background:"var(--bg3)"}}><span className="sr-only">Period</span></th>
                  {days.map((d,di)=>{
                    const h=holidayOn(di);
                    return (
                      <th key={di} style={{color:h?"var(--warn)":undefined}}>
                        <div>{d}</div>
                        <div style={{fontFamily:"var(--mono)",fontSize:13,fontWeight:500,color:h?"var(--warn)":"var(--muted)"}}>{h?(h.name||"Holiday"):fmt(slotDate(week1Start,selWeek,di))}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {slots.map(slot=>(
                  <tr key={slot.id}>
                    <th scope="row" className="period" style={{textAlign:"left"}}>
                      <div className="period-name">{slot.short}</div>
                      <div className="period-time">{slot.label}</div>
                    </th>
                    {days.map((_,di)=>{
                      const h=holidayOn(di), cells=apptMap[`${di}_${slot.id}`]||[];
                      if(h) return <td key={di} className="cell holiday" style={{textAlign:"center",color:"var(--warn)",fontSize:14}}>{cells.length?cells.map(chip):"Holiday"}</td>;
                      return (
                        <td key={di} className={`cell${canEdit?"":" readonly"}${overCell===`${di}_${slot.id}`?" drop-target":""}`}
                          onDragOver={canEdit?e=>{if(!dragRef.current)return;e.preventDefault();e.dataTransfer.dropEffect="move";setOverCell(`${di}_${slot.id}`);}:undefined}
                          onDragLeave={canEdit?()=>setOverCell(c=>c===`${di}_${slot.id}`?null:c):undefined}
                          onDrop={canEdit?e=>{if(!dragRef.current)return;e.preventDefault();dropOn(di,slot.id);}:undefined}
                          onClick={()=>{if(canEdit&&!selectMode&&cells.length===0)onCellClick(selWeek,di,slot.id);}}>
                          {cells.map(chip)}
                          {addBtn(di,slot,cells.length?`Add another session, ${DAYS[di]} ${slot.short}`:`Add a session, ${DAYS[di]} ${slot.short}`)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ):(
          <div className="agenda">
            {days.map((d,di)=>{
              const h=holidayOn(di);
              return (
                <section key={di} aria-label={DAYS_FULL[di]} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:"var(--r2)",overflow:"hidden"}}>
                  <h2 style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",padding:"10px 12px",background:"var(--bg3)",fontSize:15,fontWeight:700,color:h?"var(--warn)":undefined}}>
                    {DAYS_FULL[di]}<span style={{fontFamily:"var(--mono)",fontSize:12.5,fontWeight:500,color:h?"var(--warn)":"var(--muted)"}}>{h?(h.name||"Holiday"):fmt(slotDate(week1Start,selWeek,di))}</span>
                  </h2>
                  {slots.map(slot=>{
                    const cells=apptMap[`${di}_${slot.id}`]||[];
                    if(h&&!cells.length) return null;
                    return (
                      <div key={slot.id} style={{padding:"8px 12px",borderTop:"1px solid var(--border)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:14,marginBottom:cells.length||canEdit?6:0}}>
                          <b>{slot.short}</b><span style={{fontFamily:"var(--mono)",color:"var(--muted)"}}>{slot.label}</span>
                        </div>
                        {cells.map(chip)}
                        {!h&&canEdit&&<Btn variant="outline" size="sm" onClick={()=>onCellClick(selWeek,di,slot.id)} style={{width:"100%"}}><Icon name="plus" size={15}/> {cells.length?"Add another":"Add a session"}</Btn>}
                        {!cells.length&&!canEdit&&<div style={{color:"var(--muted2)",fontSize:14}}>Nothing scheduled</div>}
                      </div>
                    );
                  })}
                  {h&&!slots.some(sl=>(apptMap[`${di}_${sl.id}`]||[]).length)&&<div style={{padding:"10px 12px",color:"var(--warn)",fontSize:14}}>No classes. {h.name||"Holiday"}.</div>}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════════
function DashboardTab({state,conflicts}) {
  const {appointments,instructors,courses,rooms,groups}=state;
  const apptList=Object.values(appointments);
  const totalSessions=apptList.length;
  const conflictCount=conflicts.length;
  const scheduledWeeks=[...new Set(apptList.map(a=>a.weekNum))].length;

  // Sessions per course
  const byCourse=courses.map(c=>({
    ...c,
    count:apptList.filter(a=>a.courseId===c.id).length,
    pal:paletteById(c.colorId),
  })).sort((a,b)=>b.count-a.count);

  // Load per instructor
  const byInstructor=instructors.map(i=>({
    ...i,
    count:apptList.filter(a=>a.instructorId===i.id).length,
    pal:paletteById(i.colorId),
  })).sort((a,b)=>b.count-a.count);

  // Sessions by day
  const byDay=DAYS.map((d,i)=>({day:d,count:apptList.filter(a=>a.dayIdx===i).length}));
  const maxDay=Math.max(...byDay.map(d=>d.count),1);

  const StatCard=({label,value,sub,color="var(--text)"})=>(
    <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",
      padding:"14px 16px",flex:1,minWidth:120}}>
      <div style={{fontSize:11.5,color:"var(--muted)",textTransform:"uppercase",
        letterSpacing:"0.08em",fontWeight:600,marginBottom:6}}>{label}</div>
      <div style={{fontSize:24,fontWeight:700,color,fontFamily:"var(--mono)",letterSpacing:"-0.02em"}}>
        {value}
      </div>
      {sub&&<div style={{fontSize:11.5,color:"var(--muted)",marginTop:4}}>{sub}</div>}
    </div>
  );


  return (
    <div style={{padding:16,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",height:"100%"}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>Overview</div>
        <div style={{color:"var(--muted)",fontSize:12.5}}>{state.settings.semester}</div>
      </div>

      {/* Stat cards */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <StatCard label="Total Sessions" value={totalSessions} sub={`across ${scheduledWeeks} weeks`}/>
        <StatCard label="Conflicts" value={conflictCount}
          color={conflictCount>0?"var(--danger)":"var(--accent)"}
          sub={conflictCount===0?"All clear":"Need attention"}/>
        <StatCard label="Instructors" value={instructors.length} sub={`${instructors.filter(i=>i.available).length} available`}/>
        <StatCard label="Rooms" value={rooms.length} sub={`${rooms.length} venues`}/>
        <StatCard label="Courses" value={courses.length} sub={`${groups.length} student groups`}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
        {/* Sessions by day */}
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:14}}>
          <div style={{fontSize:12.5,fontWeight:600,marginBottom:12,color:"var(--muted)"}}>
            SESSIONS BY DAY
          </div>
          {byDay.map(({day,count})=>(
            <div key={day} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <span style={{width:28,fontSize:11.5,fontFamily:"var(--mono)",color:"var(--muted)",flexShrink:0}}>{day}</span>
              <div style={{flex:1,background:"var(--bg4)",borderRadius:3,height:6,overflow:"hidden"}}>
                <div style={{width:`${(count/maxDay)*100}%`,height:"100%",
                  background:"var(--accent)",borderRadius:3,transition:"width 0.5s"}}/>
              </div>
              <span style={{fontSize:11.5,fontFamily:"var(--mono)",color:"var(--text)",
                width:20,textAlign:"right"}}>{count}</span>
            </div>
          ))}
        </div>

        {/* Instructor load */}
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:14}}>
          <div style={{fontSize:12.5,fontWeight:600,marginBottom:12,color:"var(--muted)"}}>
            INSTRUCTOR LOAD
          </div>
          {byInstructor.map(i=>{
            const pct=i.maxLoad?Math.min((i.count/i.maxLoad)*100,100):0;
            return (
              <div key={i.id} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                  <span style={{fontSize:11.5,color:"var(--text)",
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"70%"}}>
                    {i.name.split(" ").slice(-1)[0]}
                  </span>
                  <span style={{fontSize:11,fontFamily:"var(--mono)",
                    color:pct>90?"var(--danger)":pct>70?"var(--warn)":"var(--muted)"}}>
                    {i.count}/{i.maxLoad}
                  </span>
                </div>
                <div style={{background:"var(--bg4)",borderRadius:3,height:4,overflow:"hidden"}}>
                  <div style={{width:`${pct}%`,height:"100%",borderRadius:3,transition:"width 0.5s",
                    background:pct>90?"var(--danger)":pct>70?"var(--warn)":i.pal.accent}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Course breakdown */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:14}}>
        <div style={{fontSize:12.5,fontWeight:600,marginBottom:12,color:"var(--muted)"}}>
          COURSE BREAKDOWN
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
          {byCourse.map(c=>(
            <div key={c.id} style={{background:"var(--bg3)",borderRadius:"var(--r)",
              border:`1px solid ${c.pal.border}`,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:c.pal.accent,flexShrink:0}}/>
                <span style={{fontSize:11,fontFamily:"var(--mono)",fontWeight:600,color:c.pal.accent}}>{c.code}</span>
                <Badge color="muted" style={{marginLeft:"auto"}}>{c.category}</Badge>
              </div>
              <div style={{fontSize:12.5,fontWeight:500,marginBottom:3,color:"var(--text)",
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div>
              <div style={{fontSize:11.5,color:"var(--muted)"}}>
                {c.count} session{c.count!==1?"s":""} · {c.credits} credits
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  CSV IMPORT MODAL  (courses + instructors + groups)
// ═══════════════════════════════════════════════════════════════════
function CSVImportModal({state,setState,toast,onClose}) {
  const [step,setStep]=useState("upload"); // upload | preview | done
  const [preview,setPreview]=useState(null); // {rows,headers,parsed}
  const [error,setError]=useState("");
  const [mapping,setMapping]=useState({
    courseName:"",courseCode:"",instructor:"",group:"",category:"",credits:""  // group col accepts "CS-1A | CS-1B"
  });
  const [parseResult,setParseResult]=useState(null);

  const TEMPLATE_CSV=[
    "Course Name,Course Code,Instructor,Student Groups,Category,Credits",
    "Intro to Python,CS101,Dr. Alice Chen,CS-1A,Core,3",
    "Data Structures,CS201,Prof. Ben Okafor,CS-2A | CS-2B,Core,3",
    "Machine Learning,CS401,Prof. James Wright,Year 1 | Year 2,Elective,4",
    "Physics Lab,PH101,Dr. Sara Lim,CS-1B,Lab,2"
  ].join("\n");

  function downloadTemplate() {
    const blob=new Blob([TEMPLATE_CSV],{type:"text/csv"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="kronos-import-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function parseCSVLine(line) {
    const result=[];let cur="",inQ=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      const QUOTE=String.fromCharCode(34);if(ch===QUOTE&&inQ&&line[i+1]===QUOTE){cur+=QUOTE;i++;continue;}
      const QUOTE2=String.fromCharCode(34);if(ch===QUOTE2){inQ=!inQ;continue;}
      if(ch===","&&!inQ){result.push(cur.trim());cur="";continue;}
      cur+=ch;
    }
    result.push(cur.trim());
    return result;
  }

  function handleFile(file) {
    setError("");
    const reader=new FileReader();
    reader.onload=e=>{
      try {
        const text=e.target.result;
        const lines=text.split(/\r?\n/).filter(l=>l.trim());
        if(lines.length<2){setError("File must have a header row and at least one data row");return;}
        const headers=parseCSVLine(lines[0]);
        const rows=lines.slice(1).map(l=>parseCSVLine(l));
        // Auto-detect column mapping
        const detect=(hints)=>headers.findIndex(h=>hints.some(hint=>h.toLowerCase().includes(hint)))||"";
        const autoMap={
          courseName: headers[detect(["course name","subject","module","name"])]||headers[0]||"",
          courseCode: headers[detect(["code","course code","subject code"])]||headers[1]||"",
          instructor: headers[detect(["instructor","teacher","lecturer","staff"])]||"",
          group:      headers[detect(["group","cohort","class","student"])]||"",
          category:   headers[detect(["category","type","kind"])]||"",
          credits:    headers[detect(["credit","credits","units","hours"])]||"",
        };
        setMapping(autoMap);
        setPreview({headers,rows});
        setStep("preview");
      } catch(err) {
        setError("Could not parse file: "+err.message);
      }
    };
    reader.readAsText(file);
  }

  function handleImport() {
    if(!preview) return;
    const {headers,rows}=preview;
    const get=(row,col)=>col?row[headers.indexOf(col)]||"":"";
    
    const newCourses=[...state.courses];
    const newInstructors=[...state.instructors];
    const newGroups=[...state.groups];
    let addedCourses=0,addedInstructors=0,addedGroups=0;

    const COLORS=["sky","emerald","rose","violet","amber","orange","lime","pink","cyan","slate"];
    let colorIdx=newCourses.length%COLORS.length;

    rows.forEach(row=>{
      if(row.every(r=>!r)) return; // skip empty rows
      const courseName=get(row,mapping.courseName).trim();
      const courseCode=get(row,mapping.courseCode).trim();
      const instructorName=get(row,mapping.instructor).trim();
      // Support multiple groups separated by pipe | or semicolon ;
      const groupRaw=get(row,mapping.group);
      const groupNames=groupRaw.split(/[|;]/).map(g=>g.trim()).filter(Boolean);
      const category=get(row,mapping.category).trim()||"Core";
      const credits=parseInt(get(row,mapping.credits))||3;
      if(!courseName) return;

      // Find or create instructor
      let instrId="";
      if(instructorName) {
        let instr=newInstructors.find(i=>i.name.toLowerCase()===instructorName.toLowerCase());
        if(!instr){
          instr={id:uid(),name:instructorName,email:"",dept:"",maxLoad:8,available:true,colorId:"sky",availability:{}};
          newInstructors.push(instr);
          addedInstructors++;
        }
        instrId=instr.id;
      }

      // Find or create each group (supports multiple)
      const groupIds=[];
      groupNames.forEach(groupName=>{
        let grp=newGroups.find(g=>g.name.toLowerCase()===groupName.toLowerCase());
        if(!grp){
          grp={id:uid(),name:groupName,parentId:null,size:30};
          newGroups.push(grp);
          addedGroups++;
        }
        groupIds.push(grp.id);
      });

      // Find or create course
      let course=newCourses.find(c=>
        (courseCode&&c.code.toLowerCase()===courseCode.toLowerCase())||
        c.name.toLowerCase()===courseName.toLowerCase()
      );
      if(!course){
        course={
          id:uid(),name:courseName,code:courseCode||courseName.slice(0,6).toUpperCase(),
          colorId:COLORS[colorIdx%COLORS.length],
          defaultInstructorId:instrId,
          defaultGroupIds:groupIds,
          category:CATEGORIES.includes(category)?category:"Core",
          credits,
        };
        newCourses.push(course);
        colorIdx++;
        addedCourses++;
      } else {
        // Merge new info into existing course
        if(instrId&&!course.defaultInstructorId) course.defaultInstructorId=instrId;
        groupIds.forEach(gid=>{
          if(!(course.defaultGroupIds||[]).includes(gid))
            course.defaultGroupIds=[...(course.defaultGroupIds||[]),gid];
        });
      }
    });

    setState(s=>({...s,courses:newCourses,instructors:newInstructors,groups:newGroups}));
    setParseResult({addedCourses,addedInstructors,addedGroups,total:rows.length});
    toast(`Imported: ${addedCourses} courses, ${addedInstructors} instructors, ${addedGroups} groups`,"ok");
    setStep("done");
  }

  return (
    <Modal title="Import from CSV" subtitle="Add courses, instructors and groups in bulk" onClose={onClose} width={580}>
      <div style={{padding:20}}>

        {step==="upload"&&(
          <>
            <div style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:"var(--r2)",
              padding:20,textAlign:"center",marginBottom:16}}>
              <div style={{marginBottom:8,color:"var(--muted)"}}><Icon name="download" size={28}/></div>
              <div style={{fontSize:14,fontWeight:500,marginBottom:4}}>Drop your CSV file here or click to browse</div>
              <div style={{fontSize:12.5,color:"var(--muted)",marginBottom:14}}>
                Columns: Course Name, Course Code, Instructor, Student Groups, Category, Credits
                <br/><span style={{fontSize:11.5,color:"var(--muted2)"}}>Tip: separate multiple groups with a pipe character e.g. <strong>CS-1A | CS-1B</strong></span>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"center",alignItems:"center"}}>
                <label style={{display:"inline-block",cursor:"pointer"}}>
                  <input type="file" accept=".csv,.txt"
                    onChange={e=>e.target.files[0]&&handleFile(e.target.files[0])}
                    style={{display:"none"}}/>
                  <span style={{display:"inline-flex",alignItems:"center",gap:6,
                    background:"var(--accent-soft)",color:"var(--accent)",
                    border:"1px solid var(--accent-line)",borderRadius:"var(--r)",
                    padding:"5px 10px",fontSize:12.5,fontWeight:500,cursor:"pointer",
                    fontFamily:"inherit"}}>
                    Browse File
                  </span>
                </label>
                <Btn variant="outline" onClick={downloadTemplate}><Icon name="download" size={15}/> Download template</Btn>
              </div>
            </div>
            {error&&<div style={{color:"var(--danger)",fontSize:12.5,marginBottom:12}}>{error}</div>}
            <div style={{background:"var(--bg3)",borderRadius:"var(--r)",padding:12,
              border:"1px solid var(--border)"}}>
              <div style={{fontSize:11.5,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
                letterSpacing:"0.08em",marginBottom:8}}>Expected Format</div>
              <pre style={{fontSize:11.5,fontFamily:"var(--mono)",color:"var(--muted)",
                overflowX:"auto",lineHeight:1.6}}>
{`Course Name,Course Code,Instructor,Student Groups,Category,Credits
Intro to Python,CS101,Dr. Alice Chen,CS-1A,Core,3
Machine Learning,CS401,Prof. James Wright,Year 1 | Year 2,Elective,4`}
              </pre>
            </div>
          </>
        )}

        {step==="preview"&&preview&&(
          <>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>
                Column Mapping — {preview.rows.length} rows detected
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                {[
                  ["courseName","Course Name *"],
                  ["courseCode","Course Code"],
                  ["instructor","Instructor"],
                  ["group","Student Groups (pipe-separated)"],
                  ["category","Category"],
                  ["credits","Credits"],
                ].map(([key,label])=>(
                  <Field key={key} label={label}>
                    <select value={mapping[key]} onChange={e=>setMapping(m=>({...m,[key]:e.target.value}))}>
                      <option value="">— Not mapped —</option>
                      {preview.headers.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </div>

            {/* Preview table */}
            <div style={{background:"var(--bg3)",borderRadius:"var(--r)",padding:10,
              border:"1px solid var(--border)",marginBottom:14,maxHeight:200,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain"}}>
              <div style={{fontSize:11.5,color:"var(--muted)",marginBottom:8,fontWeight:600,
                textTransform:"uppercase",letterSpacing:"0.08em"}}>
                Preview (first 5 rows)
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11.5}}>
                <thead>
                  <tr>{preview.headers.map(h=>(
                    <th key={h} style={{textAlign:"left",padding:"3px 6px",
                      color:"var(--muted)",borderBottom:"1px solid var(--border)",fontWeight:600}}>
                      {h}
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0,5).map((row,i)=>(
                    <tr key={i}>{row.map((cell,j)=>(
                      <td key={j} style={{padding:"3px 6px",borderBottom:"1px solid var(--border)",
                        color:"var(--text)"}}>{cell||<span style={{color:"var(--muted2)"}}>—</span>}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{display:"flex",gap:8}}>
              <Btn variant="outline" onClick={()=>setStep("upload")}><Icon name="left" size={15}/> Back</Btn>
              <Btn variant="primary" onClick={handleImport}
                disabled={!mapping.courseName}
                style={{flex:1,justifyContent:"center"}}>
                Import {preview.rows.length} Rows
              </Btn>
            </div>
          </>
        )}

        {step==="done"&&parseResult&&(
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{marginBottom:12,color:"var(--accent)"}}><Icon name="check" size={36}/></div>
            <div style={{fontSize:14,fontWeight:600,color:"var(--accent)",marginBottom:16}}>
              Import Complete
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:20,flexWrap:"wrap"}}>
              {[
                ["Courses Added",parseResult.addedCourses,"green"],
                ["Instructors Added",parseResult.addedInstructors,"blue"],
                ["Groups Added",parseResult.addedGroups,"muted"],
              ].map(([label,val,color])=>(
                <div key={label} style={{background:"var(--bg3)",borderRadius:"var(--r2)",
                  padding:"10px 16px",minWidth:100}}>
                  <div style={{fontSize:22,fontWeight:700,fontFamily:"var(--mono)",
                    color:color==="green"?"var(--accent)":color==="blue"?"var(--accent2)":"var(--text)"}}>
                    {val}
                  </div>
                  <div style={{fontSize:11.5,color:"var(--muted)",marginTop:2}}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:12.5,color:"var(--muted)",marginBottom:16}}>
              All imported courses now appear in the Courses tab with their assigned instructors and groups.
              Head to Auto-Schedule to place them on the timetable.
            </div>
            <Btn variant="primary" onClick={onClose} style={{minWidth:120,justifyContent:"center"}}>Done</Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  COURSES TAB
// ═══════════════════════════════════════════════════════════════════
function CoursesTab({state,setState,toast}) {
  const {courses,instructors,groups}=state;
  const [editing,setEditing]=useState(null);
  const [search,setSearch]=useState("");
  const [showImport,setShowImport]=useState(false);

  const blank={id:"",name:"",code:"",colorId:"sky",defaultInstructorId:"",
    defaultGroupIds:[],category:"Core",credits:3};

  function save(form) {
    const apptUpdates={};
    Object.entries(state.appointments).forEach(([k,a])=>{
      if(a.courseId===form.id) apptUpdates[k]={...a,courseName:form.name,courseCode:form.code};
    });
    if(form.id) {
      setState(s=>({...s,
        courses:s.courses.map(c=>c.id===form.id?form:c),
        appointments:{...s.appointments,...apptUpdates},
      }));
      toast("Course updated","ok");
    } else {
      const id=uid();
      setState(s=>({...s,courses:[...s.courses,{...form,id}]}));
      toast("Course added","ok");
    }
    setEditing(null);
  }
  async function remove(id) {
    const c=state.courses.find(x=>x.id===id);
    const used=Object.values(state.appointments||{}).filter(a=>a&&a.courseId===id).length;
    if(!await askConfirm({title:"Delete this course?",message:`${c?`${c.code} ${c.name}`:"This course"} will be removed from the term.`,detail:used?`${used} scheduled session${used===1?"":"s"} use it and will stay on the timetable.`:null,confirmLabel:"Delete course"})) return;
    setState(s=>({...s,courses:s.courses.filter(c=>c.id!==id)}),"deleted course",c?.name);
    toast("Course removed. You can undo it.","warn");
    setEditing(null);
  }

  const filtered=courses.filter(c=>
    c.name.toLowerCase().includes(search.toLowerCase())||
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{display:"flex",height:"100%"}}>
      {/* List */}
      <div style={{width:340,borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column"}}>
        <div style={{padding:12,borderBottom:"1px solid var(--border)",display:"flex",gap:8}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search courses..." style={{flex:1}}/>
          <Btn variant="outline" onClick={()=>setShowImport(true)}>Import CSV</Btn>
          <Btn variant="accent" onClick={()=>setEditing({...blank})}>+ Add</Btn>
        </div>
        <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch"}}>
          {filtered.map(c=>{
            const pal=paletteById(c.colorId);
            const sessions=Object.values(state.appointments).filter(a=>a.courseId===c.id).length;
            return (
              <div key={c.id} onClick={()=>setEditing({...c})}
                style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",
                  cursor:"pointer",background:editing?.id===c.id?"var(--bg3)":"transparent",
                  borderLeft:`3px solid ${editing?.id===c.id?pal.accent:"transparent"}`,
                  transition:"all 0.12s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:pal.accent,flexShrink:0}}/>
                  <span style={{fontSize:11.5,fontFamily:"var(--mono)",fontWeight:600,color:pal.accent}}>{c.code}</span>
                  <Badge color="muted">{c.category}</Badge>
                  <span style={{marginLeft:"auto",fontSize:11.5,color:"var(--muted2)"}}>{sessions}×</span>
                </div>
                <div style={{fontSize:13,fontWeight:500,color:"var(--text)"}}>{c.name}</div>
                <div style={{fontSize:11.5,color:"var(--muted)",marginTop:2}}>{c.credits} credits</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Editor */}
      {editing&&(
        <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch"}}>
          <CourseEditor form={editing} setForm={setEditing}
            instructors={instructors} groups={groups}
            onSave={save} onDelete={editing.id?()=>remove(editing.id):null}
            onClose={()=>setEditing(null)}/>
        </div>
      )}
      {!editing&&(
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
          color:"var(--muted2)",fontSize:13}}>
          Select a course to edit or click + Add
        </div>
      )}
      {showImport&&(
        <CSVImportModal state={state} setState={setState} toast={toast}
          onClose={()=>setShowImport(false)}/>
      )}
    </div>
  );
}

function CourseEditor({form,setForm,instructors,groups,onSave,onDelete,onClose}) {
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const pal=paletteById(form.colorId);
  return (
    <div style={{padding:20}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:600}}>{form.id?"Edit Course":"New Course"}</div>
        <div style={{display:"flex",gap:8}}>
          {onDelete&&<Btn variant="danger" onClick={onDelete}>Delete</Btn>}
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={()=>onSave(form)}
            disabled={!form.name||!form.code}>Save</Btn>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <Field label="Course Name" required>
          <input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Intro to Python"/>
        </Field>
        <Field label="Course Code" required>
          <input value={form.code} onChange={e=>set("code",e.target.value.toUpperCase())} placeholder="e.g. CS101"/>
        </Field>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
        <Field label="Category">
          <select value={form.category} onChange={e=>set("category",e.target.value)}>
            {CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Credits">
          <input type="number" min={1} max={10} value={form.credits}
            onChange={e=>set("credits",+e.target.value)}/>
        </Field>
        <Field label="Default Instructor">
          <SearchSelect value={form.defaultInstructorId||""} onChange={v=>set("defaultInstructorId",v)} noneLabel="— None —" options={instructors.map(i=>({value:i.id,label:i.name}))}/>
        </Field>
      </div>
      <Field label="Default Student Groups" hint="Pre-selected when scheduling this course">
        <GroupPicker groups={groups} value={form.defaultGroupIds} onChange={v=>set("defaultGroupIds",v)} placeholder="Select default groups..."/>
      </Field>
      <Field label="Color">
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:4}}>
          {PALETTE.map(p=>(
            <button key={p.id} onClick={()=>set("colorId",p.id)}
              style={{width:28,height:28,borderRadius:"50%",background:p.accent,
                border:`2px solid ${form.colorId===p.id?"white":"transparent"}`,
                outline:`2px solid ${form.colorId===p.id?p.accent:"transparent"}`,
                cursor:"pointer",transition:"all 0.1s"}}>
            </button>
          ))}
        </div>
        <div style={{marginTop:8,padding:"8px 12px",borderRadius:"var(--r)",
          background:pal.bg,border:`1px solid ${pal.border}`,
          fontSize:12.5,color:pal.accent}}>
          Preview: {form.code||"CODE"} · {form.name||"Course Name"}
        </div>
      </Field>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  ASSETS TAB (Instructors, Rooms, Groups)
// ═══════════════════════════════════════════════════════════════════
function AssetsTab({state,setState,toast}) {
  const [sub,setSub]=useState("instructors");
  const tabs=[{id:"instructors",label:"Instructors"},{id:"rooms",label:"Rooms"},{id:"groups",label:"Groups"}];
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",gap:2,padding:"10px 12px",borderBottom:"1px solid var(--border)",flexShrink:0}}>
        {tabs.map(t=>(
          <Btn key={t.id} variant={sub===t.id?"accent":"ghost"} onClick={()=>setSub(t.id)}>
            {t.label}
          </Btn>
        ))}
      </div>
      <div style={{flex:1,overflow:"hidden"}}>
        {sub==="instructors"&&<InstructorsPanel state={state} setState={setState} toast={toast}/>}
        {sub==="rooms"&&<RoomsPanel state={state} setState={setState} toast={toast}/>}
        {sub==="groups"&&<GroupsPanel state={state} setState={setState} toast={toast}/>}
      </div>
    </div>
  );
}

function InstructorsPanel({state,setState,toast}) {
  const {instructors,appointments}=state;  const [editing,setEditing]=useState(null);
  const blank={id:"",name:"",email:"",dept:"",maxLoad:8,available:true,colorId:"sky"};

  function save(form) {
    if(form.id) {
      setState(s=>({...s,instructors:s.instructors.map(i=>i.id===form.id?form:i)}));
      toast("Instructor updated","ok");
    } else {
      setState(s=>({...s,instructors:[...s.instructors,{...form,id:uid()}]}));
      toast("Instructor added","ok");
    }
    setEditing(null);
  }
  async function remove(id) {
    const i=state.instructors.find(x=>x.id===id);
    const used=Object.values(state.appointments||{}).filter(a=>a&&a.instructorId===id).length;
    if(!await askConfirm({title:"Delete this instructor?",message:`${i?.name||"This instructor"} will be removed from the term.`,detail:used?`${used} scheduled session${used===1?"":"s"} still name them.`:null,confirmLabel:"Delete instructor"})) return;
    setState(s=>({...s,instructors:s.instructors.filter(i=>i.id!==id)}),"deleted instructor",i?.name);
    toast("Instructor removed. You can undo it.","warn");
    setEditing(null);
  }

  return (
    <div style={{display:"flex",height:"100%"}}>
      <div style={{width:300,borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column"}}>
        <div style={{padding:10,borderBottom:"1px solid var(--border)"}}>
          <Btn variant="accent" style={{width:"100%",justifyContent:"center"}}
            onClick={()=>setEditing({...blank})}>+ Add Instructor</Btn>
        </div>
        <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch"}}>
          {instructors.map(i=>{
            const pal=paletteById(i.colorId);
            const sessions=Object.values(appointments).filter(a=>a.instructorId===i.id).length;
            return (
              <div key={i.id} onClick={()=>setEditing({...i})}
                style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",
                  cursor:"pointer",background:editing?.id===i.id?"var(--bg3)":"transparent",
                  borderLeft:`3px solid ${editing?.id===i.id?pal.accent:"transparent"}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:pal.bg,
                    border:`1px solid ${pal.border}`,display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:11,fontWeight:700,color:pal.accent,flexShrink:0}}>
                    {initials(i.name)}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12.5,fontWeight:500,color:"var(--text)",
                      whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{i.name}</div>
                    <div style={{fontSize:11,color:"var(--muted)"}}>{i.dept}</div>
                  </div>
                  <Badge color={i.available?"green":"red"}>{i.available?"Active":"Away"}</Badge>
                </div>
                <div style={{fontSize:11,color:"var(--muted2)",display:"flex",gap:8}}>
                  <span>{sessions} sessions</span>
                  <span>·</span>
                  <span>Max {i.maxLoad}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {editing&&(
        <div style={{flex:1,padding:20,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:600}}>{editing.id?"Edit Instructor":"New Instructor"}</div>
            <div style={{display:"flex",gap:6}}>
              {editing.id&&<Btn variant="danger" onClick={()=>remove(editing.id)}>Delete</Btn>}
              <Btn variant="outline" onClick={()=>setEditing(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={()=>save(editing)} disabled={!editing.name}>Save</Btn>
            </div>
          </div>
          <Field label="Full Name" required>
            <input value={editing.name} onChange={e=>setEditing(f=>({...f,name:e.target.value}))} placeholder="Dr. Jane Smith"/>
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Email">
              <input value={editing.email} onChange={e=>setEditing(f=>({...f,email:e.target.value}))} type="email"/>
            </Field>
            <Field label="Department">
              <input value={editing.dept} onChange={e=>setEditing(f=>({...f,dept:e.target.value}))}/>
            </Field>
            <Field label="Max Weekly Load">
              <input type="number" min={1} max={20} value={editing.maxLoad}
                onChange={e=>setEditing(f=>({...f,maxLoad:+e.target.value}))}/>
            </Field>
            <Field label="Status">
              <select value={editing.available?"true":"false"}
                onChange={e=>setEditing(f=>({...f,available:e.target.value==="true"}))}>
                <option value="true">Available</option>
                <option value="false">Away / Unavailable</option>
              </select>
            </Field>
          </div>
          <Field label="Color">
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
              {PALETTE.map(p=>(
                <button key={p.id} onClick={()=>setEditing(f=>({...f,colorId:p.id}))}
                  style={{width:24,height:24,borderRadius:"50%",background:p.accent,
                    border:`2px solid ${editing.colorId===p.id?"white":"transparent"}`,cursor:"pointer"}}>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Weekly Availability" hint="Click cells to mark when this instructor can teach">
            <AvailabilityGrid
              availability={editing.availability||{}}
              onChange={avail=>setEditing(f=>({...f,availability:avail}))}
              slots={state.slots}
            />
          </Field>
        </div>
      )}
      {!editing&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted2)",fontSize:13}}>Select an instructor to edit</div>}
    </div>
  );
}

function RoomsPanel({state,setState,toast}) {
  const {rooms}=state;
  const [editing,setEditing]=useState(null);
  const blank={id:"",name:"",capacity:30,building:"",type:"seminar"};

  function save(form) {
    if(form.id) {
      setState(s=>({...s,rooms:s.rooms.map(r=>r.id===form.id?form:r)}));
      toast("Room updated","ok");
    } else {
      setState(s=>({...s,rooms:[...s.rooms,{...form,id:uid()}]}));
      toast("Room added","ok");
    }
    setEditing(null);
  }
  async function remove(id) {
    const rm=state.rooms.find(x=>x.id===id);
    const used=Object.values(state.appointments||{}).filter(a=>a&&a.roomId===id).length;
    if(!await askConfirm({title:"Delete this room?",message:`${rm?.name||"This room"} will be removed from the term.`,detail:used?`${used} scheduled session${used===1?"":"s"} use it.`:null,confirmLabel:"Delete room"})) return;
    setState(s=>({...s,rooms:s.rooms.filter(r=>r.id!==id)}),"deleted room",rm?.name);
    toast("Room removed. You can undo it.","warn");
    setEditing(null);
  }

  const typeColors={lecture:"violet",seminar:"sky",lab:"emerald",studio:"amber",online:"rose"};

  return (
    <div style={{display:"flex",height:"100%"}}>
      <div style={{width:280,borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column"}}>
        <div style={{padding:10,borderBottom:"1px solid var(--border)"}}>
          <Btn variant="accent" style={{width:"100%",justifyContent:"center"}} onClick={()=>setEditing({...blank})}>+ Add Room</Btn>
        </div>
        <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch"}}>
          {rooms.map(r=>{
            const tc=typeColors[r.type]||"muted";
            return (
              <div key={r.id} onClick={()=>setEditing({...r})}
                style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",cursor:"pointer",
                  background:editing?.id===r.id?"var(--bg3)":"transparent"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <span style={{fontSize:12.5,fontWeight:500}}>{r.name}</span>
                  <Badge color={tc} style={{marginLeft:"auto"}}>{r.type}</Badge>
                </div>
                <div style={{fontSize:11.5,color:"var(--muted)"}}>
                  {r.building} · {r.capacity} seats
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {editing&&(
        <div style={{flex:1,padding:20,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:600}}>{editing.id?"Edit Room":"New Room"}</div>
            <div style={{display:"flex",gap:6}}>
              {editing.id&&<Btn variant="danger" onClick={()=>remove(editing.id)}>Delete</Btn>}
              <Btn variant="outline" onClick={()=>setEditing(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={()=>save(editing)} disabled={!editing.name}>Save</Btn>
            </div>
          </div>
          <Field label="Room Name" required>
            <input value={editing.name} onChange={e=>setEditing(f=>({...f,name:e.target.value}))}/>
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Building">
              <input value={editing.building} onChange={e=>setEditing(f=>({...f,building:e.target.value}))}/>
            </Field>
            <Field label="Capacity">
              <input type="number" min={1} value={editing.capacity}
                onChange={e=>setEditing(f=>({...f,capacity:+e.target.value}))}/>
            </Field>
            <Field label="Type">
              <select value={editing.type} onChange={e=>setEditing(f=>({...f,type:e.target.value}))}>
                {ROOM_TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
        </div>
      )}
      {!editing&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted2)",fontSize:13}}>Select a room to edit</div>}
    </div>
  );
}

function GroupsPanel({state,setState,toast}) {
  const {groups}=state;
  const [editing,setEditing]=useState(null);
  const [openFolders,setOpenFolders]=useState({});
  const [gq,setGq]=useState("");
  const blank={id:"",name:"",parentId:null,size:30};

  function save(form) {
    if(form.id) {
      setState(s=>({...s,groups:s.groups.map(g=>g.id===form.id?form:g)}));
      toast("Group updated","ok");
    } else {
      setState(s=>({...s,groups:[...s.groups,{...form,id:uid()}]}));
      toast("Group added","ok");
    }
    setEditing(null);
  }
  async function remove(id) {
    const g=state.groups.find(x=>x.id===id);
    const kids=state.groups.filter(x=>x.parentId===id).length;
    if(!await askConfirm({title:"Delete this group?",message:`${g?.name||"This group"} will be removed from the term.`,detail:kids?`Its ${kids} child group${kids===1?"":"s"} will be removed too.`:null,confirmLabel:"Delete group"})) return;
    setState(s=>({...s,groups:s.groups.filter(g=>g.id!==id&&g.parentId!==id)}),"deleted group",g?.name);
    toast("Group removed. You can undo it.","warn");
    setEditing(null);
  }

  function GroupNode({g,depth=0,noKids=false}) {
    const children=noKids?[]:groups.filter(x=>x.parentId===g.id);
    return (
      <div>
        <div onClick={()=>setEditing({...g})}
          style={{padding:`8px 12px`,paddingLeft:12+depth*16,borderBottom:"1px solid var(--border)",
            cursor:"pointer",background:editing?.id===g.id?"var(--bg3)":"transparent",
            display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:11.5,color:"var(--muted2)"}}>{depth>0?"↳":"•"}</span>
          <span style={{fontSize:12.5,fontWeight:depth===0?600:400}}>{g.name}</span>
          {g.size&&<span style={{fontSize:11,color:"var(--muted2)",marginLeft:"auto"}}>{g.size} students</span>}
        </div>
        {children.map(c=><GroupNode key={c.id} g={c} depth={depth+1}/>)}
      </div>
    );
  }

  const tree=useMemo(()=>buildGroupTree(groups),[groups]);

  return (
    <div style={{display:"flex",height:"100%"}}>
      <div style={{width:260,borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column"}}>
        <div style={{padding:10,borderBottom:"1px solid var(--border)"}}>
          <Btn variant="accent" style={{width:"100%",justifyContent:"center"}} onClick={()=>setEditing({...blank})}>+ Add Group</Btn>
        </div>
        <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch"}}>
          {groups.length>8&&(
            <div style={{padding:8,borderBottom:"1px solid var(--border)"}}>
              <input value={gq} onChange={e=>setGq(e.target.value)} placeholder="Search groups…" aria-label="Search groups" style={{width:"100%"}}/>
            </div>
          )}
          {gq.trim()
            ? groups.filter(g=>g.name.toLowerCase().includes(gq.trim().toLowerCase())).map(g=><GroupNode key={g.id} g={{...g,parentId:null}} noKids/>)
            : tree.map(n=>{
                if(!n.children.length) return <GroupNode key={n.key} g={n.self} noKids/>;
                const open=openFolders[n.key]??(editing&&(editing.id===n.self?.id||n.children.some(c=>c.id===editing.id)));
                return (
                  <div key={n.key}>
                    <button type="button" aria-expanded={!!open} onClick={()=>setOpenFolders(o=>({...o,[n.key]:!open}))}
                      style={{width:"100%",textAlign:"left",padding:"9px 12px",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid var(--border)",fontWeight:600,fontSize:13}}>
                      <Icon name={open?"down":"right"} size={14} style={{color:"var(--muted)"}}/>
                      <span style={{flex:1}}>{n.label}</span>
                      <span style={{fontSize:12,color:"var(--muted)",fontWeight:400}}>{n.children.length}</span>
                    </button>
                    {open&&<>
                      {n.self&&<GroupNode g={n.self} noKids/>}
                      {n.children.map(c=><GroupNode key={c.id} g={c} depth={1} noKids/>)}
                    </>}
                  </div>
                );
              })}
        </div>
      </div>
      {editing&&(
        <div style={{flex:1,padding:20,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:600}}>{editing.id?"Edit Group":"New Group"}</div>
            <div style={{display:"flex",gap:6}}>
              {editing.id&&<Btn variant="danger" onClick={()=>remove(editing.id)}>Delete</Btn>}
              <Btn variant="outline" onClick={()=>setEditing(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={()=>save(editing)} disabled={!editing.name}>Save</Btn>
            </div>
          </div>
          <Field label="Group Name" required>
            <input value={editing.name} onChange={e=>setEditing(f=>({...f,name:e.target.value}))}/>
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Parent Group" hint="Leave empty for top-level">
              <GroupPicker single groups={groups.filter(g=>g.id!==editing.id)} value={editing.parentId?[editing.parentId]:[]} onChange={v=>setEditing(f=>({...f,parentId:v[0]||null}))} noneLabel="— Top level —"/>
            </Field>
            <Field label="Student Count">
              <input type="number" min={0} value={editing.size||""} onChange={e=>setEditing(f=>({...f,size:+e.target.value}))}/>
            </Field>
          </div>
        </div>
      )}
      {!editing&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted2)",fontSize:13}}>Select a group to edit</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  INSTRUCTOR VIEW TAB
// ═══════════════════════════════════════════════════════════════════
function InstructorTab({state,onApptClick}) {
  const {instructors,appointments,courses,rooms,groups,week1Start,slots}=state;
  const [selInstructor,setSelInstructor]=useState(instructors[0]?.id||"");
  const [selWeek,setSelWeek]=useState(1);
  const instr=instructors.find(x=>x.id===selInstructor);
  const days=DAYS.slice(0,Object.values(appointments).some(x=>x.dayIdx>=5)?DAYS.length:5);

  const myAppts=Object.values(appointments).filter(a=>a.instructorId===selInstructor&&a.weekNum===selWeek);
  const apptMap={};
  myAppts.forEach(a=>{const k=`${a.dayIdx}_${a.timeId}`;if(!apptMap[k])apptMap[k]=[];apptMap[k].push(a);});

  function downloadCSV() {
    const all=Object.values(appointments).filter(a=>a.instructorId===selInstructor);
    const rows=[["Week","Day","Slot","Course","Code","Room","Groups"]];
    all.sort((a,b)=>a.weekNum-b.weekNum||a.dayIdx-b.dayIdx).forEach(a=>{
      const room=rooms.find(r=>r.id===a.roomId)?.name||"TBD";
      const grps=a.groupIds?.map(g=>groups.find(x=>x.id===g)?.name).filter(Boolean).join(", ")||"";
      rows.push([WEEKS.find(w=>w.n===a.weekNum)?.label||a.weekNum,DAYS_FULL[a.dayIdx],
        timeLabel(a,slots),a.courseName,a.courseCode,room,grps]);
    });
    const csv=rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const a=document.createElement("a");
    a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
    a.download=`${instr?.name||"instructor"}-schedule.csv`;
    a.click();
  }

  if(!instructors.length) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--muted)"}}>
      No instructors found. Add some in Assets.
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",
        display:"flex",alignItems:"center",gap:10,flexShrink:0,flexWrap:"wrap"}}>
        <SearchSelect label="Instructor" value={selInstructor} onChange={setSelInstructor} style={{width:240,maxWidth:"100%"}} placeholder="Choose an instructor" options={instructors.map(i=>({value:i.id,label:i.name}))}/>
        <select value={selWeek} onChange={e=>setSelWeek(+e.target.value)} style={{width:130}}>
          {WEEKS.map(w=><option key={w.n} value={w.n}>{w.label}</option>)}
        </select>
        {instr&&(
          <Badge color={instr.available?"green":"red"}>{instr.available?"Available":"Away"}</Badge>
        )}
        <div style={{flex:1}}/>
        <Btn variant="outline" onClick={downloadCSV}><Icon name="download" size={15}/> Export CSV</Btn>
      </div>
      {instr&&(
        <div style={{padding:"8px 14px",borderBottom:"1px solid var(--border)",flexShrink:0,
          display:"flex",alignItems:"center",gap:12,background:"var(--bg2)"}}>
          <div style={{width:32,height:32,borderRadius:"50%",
            background:paletteById(instr.colorId).bg,
            border:`1px solid ${paletteById(instr.colorId).border}`,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:11.5,fontWeight:700,color:paletteById(instr.colorId).accent}}>
            {initials(instr.name)}
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>{instr.name}</div>
            <div style={{fontSize:11.5,color:"var(--muted)"}}>{instr.dept} · {instr.email}</div>
          </div>
          <div style={{marginLeft:"auto",fontSize:11.5,color:"var(--muted)"}}>
            {Object.values(appointments).filter(a=>a.instructorId===selInstructor).length} total sessions · max {instr.maxLoad}/week
          </div>
        </div>
      )}
      <div style={{flex:1,overflowY:"auto",overflowX:"auto",padding:12,minHeight:0,WebkitOverflowScrolling:"touch"}}>
        <table style={{width:"100%",borderCollapse:"separate",borderSpacing:3}}>
          <thead>
            <tr>
              <th style={{width:80,textAlign:"left",padding:"6px 8px",fontSize:11.5,color:"var(--muted)",
                textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>Slot</th>
              {days.map((d,di)=>(
                <th key={di} style={{textAlign:"left",padding:"6px 8px",fontSize:12.5,fontWeight:500}}>
                  <div>{d}</div>
                  <div style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--mono)",fontWeight:400}}>
                    {fmt(slotDate(week1Start,selWeek,di))}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map(slot=>(
              <tr key={slot.id}>
                <td style={{verticalAlign:"top",padding:"6px 8px"}}>
                  <div style={{fontSize:11.5,fontWeight:600,color:"var(--accent)",fontFamily:"var(--mono)"}}>{slot.short.toUpperCase()}</div>
                  <div style={{fontSize:11,color:"var(--muted2)"}}>{slot.label}</div>
                </td>
                {days.map((_,di)=>{
                  const cells=(apptMap[`${di}_${slot.id}`])||[];
                  return (
                    <td key={di} style={{verticalAlign:"top",background:"var(--bg2)",
                      border:"1px solid var(--border)",borderRadius:"var(--r)",padding:4,minHeight:70}}>
                      {cells.map(a=>(
                        <ApptChip key={a.id} appt={a} courses={courses}
                          instructors={instructors} rooms={rooms} onClick={onApptClick} conflicts={[]}/>
                      ))}
                      {cells.length===0&&(
                        <div style={{height:50,display:"flex",alignItems:"center",
                          justifyContent:"center",color:"var(--muted2)",fontSize:11.5,opacity:0.3}}>—</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CONFLICTS TAB
// ═══════════════════════════════════════════════════════════════════
function ConflictsTab({conflicts,state,onApptClick,onFix}) {
  const {instructors,rooms,courses,slots}=state;
  const [fixKey,setFixKey]=useState(null);
  const [fixWho,setFixWho]=useState(0);
  if(!conflicts.length) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      flex:1,minHeight:0,gap:12}}>
      <div style={{color:"var(--accent)"}}><Icon name="check" size={32}/></div>
      <div style={{fontSize:14,fontWeight:600,color:"var(--accent)"}}>No conflicts detected</div>
      <div style={{fontSize:12.5,color:"var(--muted)"}}>Your schedule is clean and conflict-free</div>
    </div>
  );

  const grouped={instructor:[],room:[],group:[]};
  const open=conflicts.filter(c=>!c.overridden), resolved=conflicts.filter(c=>c.overridden);
  open.forEach(c=>{ if(grouped[c.type]) grouped[c.type].push(c); });
  const typeLabel={instructor:"Instructor Conflicts",room:"Room Conflicts",group:"Group Conflicts"};
  const typeColor={instructor:"var(--danger)",room:"var(--warn)",group:"var(--accent2)"};

  const renderCard=(c,i)=>{
            const weekLabel=WEEKS.find(w=>w.n===c.a.weekNum)?.label||`Week ${c.a.weekNum}`;
            const dayLabel=DAYS_FULL[c.a.dayIdx];
            const slotLabel=slots.find(x=>x.id===c.a.timeId)?.short||c.a.timeId;
            return (
              <div key={i} style={{background:"var(--bg2)",border:`1px solid ${c.overridden?"var(--border2)":"var(--danger-line)"}`,opacity:c.overridden?.85:1,
                borderRadius:"var(--r2)",padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:11.5,color:"var(--muted)",marginBottom:6,fontFamily:"var(--mono)"}}>
                  {weekLabel} · {dayLabel} · {slotLabel}
                  {c.overridden&&<span style={{marginLeft:8,color:"var(--accent)",fontWeight:700}}>✓ Overridden · {typeLabel[c.type].replace(" Conflicts","").toLowerCase()} clash accepted</span>}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {[c.a,c.b].map((appt,j)=>{
                    const pal=getPalette(appt.courseId,courses);
                    return (
                      <div key={j} onClick={()=>onApptClick(appt)}
                        style={{flex:1,minWidth:140,background:pal.bg,border:`1px solid ${pal.border}`,
                          borderRadius:"var(--r)",padding:"7px 10px",cursor:"pointer"}}>
                        <div style={{fontSize:11,fontFamily:"var(--mono)",color:pal.accent,fontWeight:600,marginBottom:2}}>
                          {appt.courseCode}
                        </div>
                        <div style={{fontSize:12.5,color:pal.accent}}>{appt.courseName}</div>
                        <div style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--mono)",marginTop:2}}>{timeLabel(appt,slots)}</div>
                      </div>
                    );
                  })}
                </div>
                {!c.overridden&&onFix&&(()=>{
                  const key=`${c.a.id}|${c.b.id}|${c.type}`, open=fixKey===key;
                  const who=[c.a,c.b][fixWho]||c.a;
                  const fixes=open?suggestFixes(state,who):null;
                  const list=fixes?(c.type==="room"?[...fixes.rooms,...fixes.moves]:fixes.moves):[];
                  return (
                    <div style={{marginTop:8}}>
                      <Btn variant="outline" size="xs" onClick={()=>{setFixKey(open?null:key);setFixWho(0);}} aria-expanded={open}>{open?"Hide suggestions":"Suggest a fix"}</Btn>
                      {open&&(
                        <div style={{marginTop:8,padding:10,border:"1px solid var(--border2)",borderRadius:"var(--r)",background:"var(--bg3)"}}>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,alignItems:"center",fontSize:13}}>
                            <span style={{color:"var(--muted)"}}>Move</span>
                            {[c.a,c.b].map((x,k)=><button key={k} type="button" className={`btn xs ${fixWho===k?"accent":"outline"}`} onClick={()=>setFixWho(k)}>{x.courseCode||x.courseName}{x.section?` §${x.section}`:""}</button>)}
                          </div>
                          {list.length===0&&<div style={{fontSize:13,color:"var(--muted)"}}>Nothing in this week fits without a new clash. Try the other session, or move it to another week from the session editor.</div>}
                          {list.map((f,k)=>(
                            <div key={k} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderTop:k?"1px solid var(--border)":"none"}}>
                              <span style={{fontSize:13,flex:1}}>{f.kind==="room"?"Use room ":"Move to "}<b>{f.label}</b></span>
                              <Btn variant="primary" size="xs" onClick={()=>{onFix(who.id,f.changes,f.kind==="room"?`room ${f.label}`:f.label);setFixKey(null);}}>Apply</Btn>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          };

  return (
    <div style={{padding:16,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",height:"100%"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:700}}>Conflict Report</div>
        {open.length>0?<Badge color="red">{open.length} unresolved</Badge>:<Badge color="green">All resolved</Badge>}
        {resolved.length>0&&<Badge color="muted">{resolved.length} overridden</Badge>}
      </div>
      {Object.entries(grouped).filter(([,v])=>v.length).map(([type,items])=>(
        <div key={type} style={{marginBottom:16}}>
          <div style={{fontSize:11.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",
            color:typeColor[type]||"var(--muted)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:typeColor[type],display:"inline-block"}}/>
            {typeLabel[type]} ({items.length})
          </div>
          {items.map(renderCard)}
        </div>
      ))}
      {resolved.length>0&&(
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--accent)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
            <Icon name="check" size={14}/>Resolved by override ({resolved.length})
          </div>
          {resolved.map(renderCard)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CHANGELOG TAB
// ═══════════════════════════════════════════════════════════════════
function ChangelogTab({log}) {
  if(!log.length) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--muted2)",fontSize:13}}>
      No activity yet
    </div>
  );
  return (
    <div style={{padding:16,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",height:"100%"}}>
      <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Activity Log</div>
      {[...log].reverse().map((e,i)=>(
        <div key={i} style={{display:"flex",gap:10,marginBottom:8,paddingBottom:8,
          borderBottom:"1px solid var(--border)"}}>
          <div style={{fontSize:11,color:"var(--muted2)",fontFamily:"var(--mono)",
            whiteSpace:"nowrap",paddingTop:1,minWidth:80}}>
            {new Date(e.at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}
          </div>
          <div style={{flex:1}}>
            <span style={{fontSize:11.5,fontWeight:500,color:"var(--text)"}}>{e.action}</span>
            {e.detail&&<span style={{fontSize:11.5,color:"var(--muted)"}}> — {e.detail}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════
function SettingsTab({state,setState,toast}) {
  const {settings,week1Start,slots}=state;
  const [form,setForm]=useState({...settings,week1Start,slots:[...slots]});

  function save() {
    setState(s=>({...s,settings:{institution:form.institution,semester:form.semester,logo:form.logo},
      week1Start:form.week1Start,slots:form.slots}));
    toast("Settings saved","ok");
  }

  function addSlot() {
    setForm(f=>({...f,slots:[...f.slots,{id:uid(),label:"",short:""}]}));
  }
  function removeSlot(id) {
    setForm(f=>({...f,slots:f.slots.filter(s=>s.id!==id)}));
  }

  function addHoliday() {
    setState(s=>({...s,holidays:[...s.holidays,{id:uid(),date:"",name:""}]}));
  }
  function updateHoliday(id,key,val) {
    setState(s=>({...s,holidays:s.holidays.map(h=>h.id===id?{...h,[key]:val}:h)}));
  }
  async function removeHoliday(id) {
    const h=state.holidays.find(x=>x.id===id);
    if(!await askConfirm({title:"Remove this holiday?",message:`${h?.name||"This holiday"} will be removed, and its date becomes a normal teaching day.`,confirmLabel:"Remove holiday"})) return;
    setState(s=>({...s,holidays:s.holidays.filter(h=>h.id!==id)}),"removed holiday",h?.name);
  }

  const importRef=useRef(null);
  function exportData() {
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="timetable-export.json";
    a.click();
  }
  function importData(e) {
    const file=e.target.files[0];
    e.target.value=""; // so choosing the same file again still fires
    if(!file) return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      try {
        const data=sanitizeState(JSON.parse(ev.target.result));
        if(!data||typeof data!=="object") throw new Error("bad file");
        const have=Object.keys(state.appointments||{}).length+state.courses.length;
        if(have&&!await askConfirm({title:"Replace this term's data?",message:"Importing replaces everything in this term with the contents of the file.",detail:`Now: ${Object.keys(state.appointments||{}).length} sessions and ${state.courses.length} courses. In the file: ${Object.keys(data.appointments||{}).length} sessions and ${(data.courses||[]).length} courses. You can undo it afterwards.`,confirmLabel:"Replace data"})) return;
        setState({...data,settings:{...data.settings,semester:state.settings.semester||data.settings?.semester||""}}); // the term keeps its own name
        toast("Data imported successfully. You can undo it.","ok");
      } catch { toast("Invalid file format","error"); }
    };
    reader.readAsText(file);
  }
  async function resetData() {
    const n=Object.keys(state.appointments||{}).length;
    if(await askConfirm({title:"Clear this whole term?",message:"Courses, instructors, rooms, groups, holidays and all sessions will be removed.",detail:`${n} session${n===1?"":"s"} will be deleted. You can undo this right after, while this page stays open.`,confirmLabel:"Clear term"})) {
      setState(emptyState(state.settings.semester),"cleared term");
      toast("Term cleared. You can undo it.","warn");
    }
  }

  return (
    <div style={{padding:20,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",height:"100%",maxWidth:640}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:20}}>Settings</div>

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:16,marginBottom:16}}>
        <div style={{fontSize:12.5,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:12}}>Institution</div>
        <Field label="Institution Name">
          <input value={form.institution} onChange={e=>setForm(f=>({...f,institution:e.target.value}))}/>
        </Field>
        <Field label="Semester Label">
          <input value={form.semester} onChange={e=>setForm(f=>({...f,semester:e.target.value}))}/>
        </Field>
        <Field label="Week 1 Start Date" hint="Orientation = 1 week before this date">
          <input type="date" value={form.week1Start} onChange={e=>setForm(f=>({...f,week1Start:e.target.value}))}/>
        </Field>
      </div>

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:16,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:12.5,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.08em"}}>
            Time Slots
          </div>
          <Btn variant="outline" size="xs" onClick={addSlot}>+ Add Slot</Btn>
        </div>
        {form.slots.map((s,i)=>(
          <div key={s.id} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
            <input value={s.short} placeholder="Label (e.g. Morning)"
              onChange={e=>setForm(f=>({...f,slots:f.slots.map((sl,j)=>j===i?{...sl,short:e.target.value}:sl)}))}
              style={{width:110}}/>
            <input value={s.label} placeholder="Time (e.g. 09:00 – 12:00)"
              onChange={e=>setForm(f=>({...f,slots:f.slots.map((sl,j)=>j===i?{...sl,label:e.target.value}:sl)}))}/>
            <Btn variant="danger" size="xs" onClick={()=>removeSlot(s.id)}>Remove</Btn>
          </div>
        ))}
      </div>

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:16,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:12.5,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Holidays</div>
          <Btn variant="outline" size="xs" onClick={addHoliday}>+ Add Holiday</Btn>
        </div>
        {state.holidays.map(h=>(
          <div key={h.id} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
            <input type="date" value={h.date} onChange={e=>updateHoliday(h.id,"date",e.target.value)} style={{width:140}}/>
            <input value={h.name} placeholder="Holiday name" onChange={e=>updateHoliday(h.id,"name",e.target.value)}/>
            <Btn variant="danger" size="xs" onClick={()=>removeHoliday(h.id)}>Remove</Btn>
          </div>
        ))}
        {!state.holidays.length&&<div style={{fontSize:12.5,color:"var(--muted2)"}}>No holidays defined</div>}
      </div>

      <Btn variant="primary" onClick={save} style={{marginBottom:20}}>Save Settings</Btn>

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:16}}>
        <div style={{fontSize:12.5,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:12}}>Data Management</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Btn variant="outline" onClick={exportData}><Icon name="download" size={15}/> Export JSON</Btn>
          <Btn variant="outline" onClick={()=>importRef.current?.click()}>Import JSON</Btn>
          <input ref={importRef} type="file" accept=".json,application/json" aria-label="Import JSON file" onChange={importData} style={{display:"none"}}/>
          <Btn variant="danger" onClick={resetData}>Clear this term</Btn>
        </div>
      </div>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════
function useAuth() {
  const [user, setUser] = useState(null);
  const [authUid, setAuthUid] = useState(null); // includes the anonymous identity used for room codes
  const [loading, setLoading] = useState(true);
  useEffect(() => onAuthChange(u => {
    // Anonymous identities exist only so room-code joiners pass database rules; the UI treats them as "not signed in".
    setAuthUid(u?.uid || null);
    setUser(u && !u.isAnonymous ? u : null);
    setLoading(false);
  }), []);
  return { user, authUid, loading };
}

const readName = () => { try { return localStorage.getItem("kronos_user") || ""; } catch { return ""; } };
const writeName = n => { try { localStorage.setItem("kronos_user", n); } catch { /* private mode */ } };

// ═══════════════════════════════════════════════════════════════════
//  ROOT
// ═══════════════════════════════════════════════════════════════════
export default function TimetableBuilder() { return <ConfirmProvider><Builder /></ConfirmProvider>; }
function Builder() {
  const { user, authUid, loading: authLoading } = useAuth();
  const theme = useTheme();
  const [joinLinkCode] = useState(() => codeFromSearch(typeof window !== "undefined" ? window.location.search : ""));
  const [skipAuth, setSkipAuth] = useState(!!joinLinkCode);
  const [state, setStateRaw] = useState(() => sanitizeState(loadLocal()) || emptyState());
  const [tab, setTab] = useState("schedule");
  const [modal, setModal] = useState(null);
  const [showCollab, setShowCollab] = useState(joinLinkCode ? "join" : null); // null | "create" | "join"
  const [localMode, setLocalMode] = useState(false);   // working on this device only, without a team
  const [termList, setTermList] = useState(loadRecentRooms);
  const [openingCode, setOpeningCode] = useState("");
  const [pendingCode, setPendingCode] = useState(""); // a term chosen from the list that still needs the person's name
  const [termsError, setTermsError] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [userName, setUserName] = useState(readName);
  const stateRef = useRef(state);          // always the latest state, readable outside render
  const toast = useToasts();

  // A share link (?join=CODE) is consumed once: tidy the address bar so a refresh doesn't reopen it.
  useEffect(() => {
    if (joinLinkCode) { try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ } }
  }, [joinLinkCode]);

  // All state changes go through here. Side effects (local save, term sync) happen
  // OUTSIDE React's state updater so they run exactly once.
  const commit = useCallback(next => { stateRef.current = next; setStateRaw(next); saveLocal(next); }, []);

  // Changes arriving from collaborators: applied without being pushed back.
  const applyRemote = useCallback(fn => {
    const prev = stateRef.current, raw = fn(prev);
    if (raw === prev) return false;
    commit(sanitizeState(raw));
    return true;
  }, [commit]);

  const collab = useCollaboration({ getState: () => stateRef.current, applyRemote, toast: toast.push, sanitize: sanitizeState, backup: backupLocalState });
  const { session, canEdit } = collab;

  // Viewers can't change the timetable, whatever the UI does.
  const canEditRef = useRef(true);
  canEditRef.current = canEdit;
  const collabRef = useRef(null);
  collabRef.current = session;
  const undoStack = useRef([]), redoStack = useRef([]);
  const [, setHistoryTick] = useState(0);
  const termKey = session?.roomCode || "";
  useEffect(() => { undoStack.current = []; redoStack.current = []; setHistoryTick(t => t + 1); }, [termKey]);
  const setState = useCallback((updater, opType, opDetail) => {
    if (!canEditRef.current) { toast.push(collabRef.current?.archived ? "This term is archived, so it can't be changed. An admin can reopen it." : "You have view-only access to this term.", "info"); return; }
    const prev = stateRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    if (next === prev) return;
    commit(next);
    collab.pushDiff(prev, next, opType, opDetail);
    const changes = changesBetween(prev, next);
    if (changes.length) {
      undoStack.current = [...undoStack.current, { changes, label: opType || "change" }].slice(-MAX_HISTORY);
      redoStack.current = [];
      setHistoryTick(t => t + 1);
    }
  }, [commit, collab.pushDiff, toast.push]);

  // Undo / redo: your own changes only, newest first. Items a teammate has touched since are left alone.
  const stepHistory = useCallback(dir => {
    if (!canEditRef.current) return;
    const from = dir === "undo" ? undoStack : redoStack, to = dir === "undo" ? redoStack : undoStack;
    const entry = from.current[from.current.length - 1];
    if (!entry) return;
    const prev = stateRef.current;
    const res = applyChanges(prev, invert(entry.changes));
    from.current = from.current.slice(0, -1);
    if (res.applied) {
      to.current = [...to.current, { changes: invert(entry.changes), label: entry.label }].slice(-MAX_HISTORY);
      commit(res.state);
      collab.pushDiff(prev, res.state, dir, entry.label);
    }
    setHistoryTick(t => t + 1);
    const verb = dir === "undo" ? "Undid" : "Redid";
    if (!res.applied) toast.push("Couldn't " + dir + ": a teammate has changed those items since", "warn");
    else if (res.skipped) toast.push(`${verb} ${entry.label}, except ${res.skipped} item${res.skipped === 1 ? "" : "s"} a teammate changed since`, "warn");
    else toast.push(`${verb}: ${entry.label}`, "ok");
  }, [commit, collab.pushDiff, toast.push]);
  const canUndo = canEdit && undoStack.current.length > 0, canRedo = canEdit && redoStack.current.length > 0;
  useEffect(() => {
    const onKey = e => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); stepHistory("undo"); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); stepHistory("redo"); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stepHistory]);

  const conflicts = useMemo(() => getAllConflicts(state.appointments || {}, state.slots), [state.appointments, state.slots]);
  const openConflicts = useMemo(() => conflicts.filter(c => !c.overridden), [conflicts]);

  // Signing in or out changes our database identity; room access is tied to it, so join again with the same code.
  const lastUid = useRef(null);
  useEffect(() => {
    const prev = lastUid.current;
    lastUid.current = authUid;
    if (prev && authUid && prev !== authUid && collab.session) collab.rejoin();
  }, [authUid]);

  // The list of terms: this browser's recent ones, plus (when signed in) the ones saved to the account.
  const refreshTerms = useCallback(async () => {
    const local = loadRecentRooms();
    let cloud = [];
    if (user) { try { cloud = await listMyTerms(user.uid); } catch { /* offline: the local list still works */ } }
    const byCode = new Map();
    [...cloud, ...local].forEach(t => { const prev = byCode.get(t.code); if (!prev || (t.at || 0) >= (prev.at || 0)) byCode.set(t.code, { ...prev, ...t }); });
    setTermList([...byCode.values()].sort((a, b) => (b.at || 0) - (a.at || 0)));
  }, [user?.uid]);
  useEffect(() => { refreshTerms(); }, [refreshTerms, session?.code, session?.archived, session?.roomName]);
  useEffect(() => { // remember the open term in the account so any device can list it
    if (user && session && session.code) saveMyTerm(user.uid, { code: session.code, name: session.roomName || "", role: session.role, archived: !!session.archived, at: Date.now() }).catch(() => {});
  }, [user?.uid, session?.code, session?.roomName, session?.role, session?.archived]);

  function handleApptClick(appt) { setModal({ appt }); }
  function handleCellClick(weekNum, dayIdx, timeId) { if (canEdit) setModal({ weekNum, dayIdx, timeId }); }

  function handleApptSave(appts, isEdit) {
    const opDetail = appts.map(a => `W${a.weekNum} ${DAYS[a.dayIdx]} ${a.timeId}`).join(", ");
    setState(s => {
      const next = { ...s.appointments };
      appts.forEach(a => { next[a.id] = a; });
      return { ...s, appointments: next,
        changelog: [...s.changelog.slice(-199), { at: Date.now(), action: isEdit ? "Session updated" : "Session scheduled", detail: appts[0]?.courseName }] };
    }, isEdit ? "updated session" : "scheduled session", opDetail);
    toast.push(isEdit ? "Session updated" : `${appts.length} session${appts.length !== 1 ? "s" : ""} scheduled`, "ok");
    setModal(null);
  }

  async function moveSessions(moves, what) {
    const cur = stateRef.current;
    const plan = planMoves(cur, moves, { maxDay: Object.values(cur.appointments || {}).some(a => a && a.dayIdx >= 5) ? 5 : 4 });
    if (!plan.moved.length) { toast.push(plan.blocked.length ? `Nothing moved: ${plan.blocked[0].reason}` : "Nothing to move", "warn"); return; }
    if (plan.newClashes > 0 && !await askConfirm({ title: "This creates new clashes", message: `Moving ${what} causes ${plan.newClashes} new clash${plan.newClashes === 1 ? "" : "es"}.`, detail: "You can undo the move, and fix the clashes from the Conflicts tab.", confirmLabel: "Move anyway", danger: false })) return;
    setState(s => ({ ...s, appointments: { ...s.appointments, ...Object.fromEntries(plan.moved.map(id => [id, plan.appointments[id]])) },
      changelog: [...s.changelog.slice(-199), { at: Date.now(), action: "Sessions moved", detail: `${what}${plan.moved.length > 1 ? ` (${plan.moved.length})` : ""}` }] }), "moved sessions", what);
    toast.push(`Moved ${plan.moved.length} session${plan.moved.length === 1 ? "" : "s"}${plan.blocked.length ? `; ${plan.blocked.length} couldn't move (${plan.blocked[0].reason})` : ""}. You can undo it.`, plan.blocked.length ? "warn" : "ok");
  }
  async function deleteSessions(ids) {
    if (!ids.length) return false;
    if (!await askConfirm({ title: `Delete ${ids.length} session${ids.length === 1 ? "" : "s"}?`, message: "They will be removed from the timetable, together with their comments.", detail: "You can undo the delete, but comments can't be brought back.", confirmLabel: `Delete ${ids.length}` })) return false;
    setState(s => { const a = { ...s.appointments }; ids.forEach(id => delete a[id]);
      return { ...s, appointments: a, changelog: [...s.changelog.slice(-199), { at: Date.now(), action: "Sessions deleted", detail: `${ids.length} sessions` }] };
    }, "deleted sessions", `${ids.length} sessions`);
    ids.forEach(id => collab.commentApi.removeForAppt(id));
    toast.push(`${ids.length} session${ids.length === 1 ? "" : "s"} deleted`, "warn");
    return true;
  }
  function handleFix(id, changes, label) {
    const appt = stateRef.current.appointments[id];
    if (!appt) return;
    setState(s => { const next = { ...s.appointments[id], ...changes }; Object.keys(next).forEach(k => next[k] === undefined && delete next[k]);
      return { ...s, appointments: { ...s.appointments, [id]: next }, changelog: [...s.changelog.slice(-199), { at: Date.now(), action: "Clash fixed", detail: `${appt.courseCode || appt.courseName} → ${label}` }] };
    }, "fixed clash", appt.courseCode || appt.courseName);
    toast.push(`Moved ${appt.courseCode || appt.courseName} to ${label}. You can undo it.`, "ok");
  }
  function handleApptDelete(id) {
    const appt = stateRef.current.appointments[id];
    setState(s => { const a = { ...s.appointments }; delete a[id];
      return { ...s, appointments: a, changelog: [...s.changelog.slice(-199), { at: Date.now(), action: "Session deleted", detail: appt?.courseName }] };
    }, "deleted session", appt?.courseName);
    collab.commentApi.removeForAppt(id);
    toast.push("Session deleted", "warn");
  }

  async function handleSignIn() {
    try { await signInWithGoogle(); }
    catch (e) { const x = explainAuthError(e); if (!x.silent) toast.push(x.message, "warn", 10000); }
  }
  async function handleSignOut() {
    await signOutUser();
    if (collab.session) { try { await ensureAuth(); } catch { /* the access-lost dialog explains it */ } } // new anonymous identity; the effect above rejoins
  }

  async function handleCreateRoom(termName, name, { copyFrom } = {}) {
    const displayName = user?.displayName || name;
    setUserName(displayName); writeName(displayName);
    let start = emptyState(termName);
    if (copyFrom) { // reuse the people and places of an earlier term (needs us to be a member of it)
      const found = await access.join(copyFrom);
      const loaded = await loadRoom(found.rid);
      const earlier = loaded?.tree ? treeToState(loaded.tree) : loaded?.legacy;
      if (!earlier) throw new Error("The earlier term has no data to copy");
      start = termFrom(sanitizeState(earlier), termName);
    }
    commit(start);
    await collab.createRoom(termName, displayName);
    setShowCollab(null); setTab("schedule");
    setShowShare(true);
    toast.push("Term created. Share the editor code or the read-only link.", "ok");
  }
  async function handleJoinRoom(code, name) {
    const displayName = user?.displayName || name;
    setUserName(displayName); writeName(displayName);
    const sess = await collab.joinRoom(code, displayName);
    setShowCollab(null); setPendingCode("");
    setTab("schedule");
    toast.push(`Opened ${sess.roomName || "the term"} as ${ROLE_LABEL[sess.role].toLowerCase()}`, "ok");
  }
  async function handleOpenTerm(term) {
    const displayName = user?.displayName || userName;
    if (!displayName) { setPendingCode(term.code); setShowCollab("join"); return; } // need a name first; the join dialog asks for it
    setOpeningCode(term.code); setTermsError("");
    try { await handleJoinRoom(term.code, displayName); }
    catch (e) {
      setTermsError(e?.message === "Room not found"
        ? `"${term.name || "That term"}" can't be opened with its saved code. An admin may have changed it. Ask them for the current code, or remove it from this list.`
        : "Couldn't open the term: " + (e?.message || "network error"));
    }
    setOpeningCode("");
  }
  async function handleForgetTerm(term) {
    if (!await askConfirm({ title: "Remove this term from your list?", message: `${term.name || "This term"} stays available to everyone else, and you can join it again with its code.`, confirmLabel: "Remove from list" })) return;
    forgetRoom(term.code);
    if (user) removeMyTerm(user.uid, term.code).catch(() => {});
    setTermList(l => l.filter(t => t.code !== term.code));
  }
  function handleSwitchTerm() {
    collab.leaveRoom();
    commit(emptyState()); // the term's data stays in the term; nothing is left behind on this screen
    setLocalMode(false); setTab("schedule"); setShowShare(false); setModal(null);
  }

  // Tell collaborators which view we're on and which session we have open
  useEffect(() => { collab.setPresenceFields({ tab }); }, [tab, session?.roomCode]);
  useEffect(() => { collab.setPresenceFields({ editing: modal?.appt?.id || null }); }, [modal?.appt?.id, session?.roomCode]);
  const presenceCtx = useMemo(() => {
    const editing = {};
    Object.entries(collab.presence).forEach(([id, p]) => {
      if (id === session?.userId || !p.editing) return;
      (editing[p.editing] ||= []).push({ name: p.name || "Someone", color: p.color || "#888" });
    });
    return { editing };
  }, [collab.presence, session?.userId]);

  const collabCtx = useMemo(() => ({
    session, role: collab.role, canEdit, inRoom: !!session,
    comments: collab.comments, api: session ? collab.commentApi : null,
  }), [session, collab.role, canEdit, collab.comments, collab.commentApi]);

  const views = useMemo(() => visibleViews({ canEdit, inRoom: !!session }), [canEdit, session]);
  useEffect(() => { if (!views.some(v => v.id === tab)) setTab("schedule"); }, [views, tab]);

  if (authLoading) return (
    <div role="status" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--bg)" }}>
      <div style={{ textAlign: "center" }}>
        <div className="brand-mark" style={{ margin: "0 auto 12px", width: 40, height: 40, fontSize: 18 }} aria-hidden="true">K</div>
        <div style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</div>
      </div>
    </div>
  );
  if (!user && !skipAuth) return <LoginScreen onSkip={() => setSkipAuth(true)} />;

  const collabModal = showCollab && (
    <CollabModal onCreate={handleCreateRoom} onJoin={handleJoinRoom} onClose={() => { setShowCollab(null); setPendingCode(""); }} defaultName={userName}
      initialCode={pendingCode || joinLinkCode} initialMode={showCollab} terms={termList} />
  );
  if (!session && !localMode) return (
    <>
      <TermsScreen terms={termList} openingCode={openingCode} error={termsError} user={user}
        onOpen={handleOpenTerm} onForget={handleForgetTerm} onNew={() => setShowCollab("create")} onJoin={() => setShowCollab("join")}
        onSignIn={handleSignIn} onSignOut={handleSignOut} onLocal={() => setLocalMode(true)} />
      {collabModal}
      <Toasts list={toast.list} dismiss={toast.dismiss} />
    </>
  );

  const conflictCount = openConflicts.length;
  const openComments = Object.values(collab.comments.open || {}).reduce((a, b) => a + b, 0);
  const counts = { conflicts: conflictCount, comments: openComments };
  const current = VIEWS.find(v => v.id === tab) || VIEWS[0];
  const subtitle = tab === "schedule"
    ? `${state.settings.semester || (session ? "Term" : "This device only")}${session?.archived ? " · archived, read-only" : canEdit ? "" : " · view only"}`
    : current.sub || state.settings.semester || "";

  return (
    <PresenceCtx.Provider value={presenceCtx}>
    <CollabCtx.Provider value={collabCtx}>
      <div className="app">
        <Rail views={views} view={tab} onView={setTab} counts={counts} theme={theme.resolved} onToggleTheme={theme.toggle}
          user={user} onSignIn={handleSignIn} onSignOut={handleSignOut} signedInHint="Sign in to see your terms on any device" />
        <div className="main">
          <header className="top">
            <div className="top-title">
              <h1 className="page-title">{current.title || current.label}</h1>
              {subtitle && <div className="page-sub">{subtitle}</div>}
            </div>
            <div className="top-actions">
              {conflictCount > 0 && (
                <button type="button" className="pill bad" onClick={() => setTab("conflicts")}>
                  <span className="dot pulse" />{conflictCount} conflict{conflictCount !== 1 ? "s" : ""}
                </button>
              )}
              {canEdit && (
                <div role="group" aria-label="History" style={{ display: "inline-flex", gap: 4 }}>
                  <Btn variant="outline" size="md" onClick={() => stepHistory("undo")} disabled={!canUndo} title={canUndo ? `Undo ${undoStack.current[undoStack.current.length - 1].label} (Ctrl+Z)` : "Nothing to undo"} label="Undo"><Icon name="undo" size={16} /></Btn>
                  <Btn variant="outline" size="md" onClick={() => stepHistory("redo")} disabled={!canRedo} title={canRedo ? `Redo ${redoStack.current[redoStack.current.length - 1].label} (Ctrl+Shift+Z)` : "Nothing to redo"} label="Redo"><Icon name="redo" size={16} /></Btn>
                </div>
              )}
              {!session && <Btn variant="outline" size="md" onClick={() => setLocalMode(false)}><Icon name="people" size={16} /> <span className="hide-sm">Open a term</span></Btn>}
              {canEdit && <Btn variant="primary" size="md" onClick={() => setModal({ weekNum: 1, dayIdx: 0, timeId: state.slots[0]?.id })}><Icon name="plus" size={16} /> Schedule</Btn>}
            </div>
          </header>
          {session && (
            <RoomBar session={session} presence={collab.presence} syncing={collab.syncing} lastSyncAt={collab.lastSyncAt}
              onShare={() => setShowShare(true)} onLeave={handleSwitchTerm} />
          )}
          <main className="view" id="main">
            {tab === "schedule" && <ScheduleTab state={state} onApptClick={handleApptClick} onCellClick={handleCellClick} conflicts={openConflicts} onMove={moveSessions} onDeleteMany={deleteSessions} />}
            {tab === "dashboard" && <DashboardTab state={state} conflicts={openConflicts} />}
            {tab === "autoschedule" && canEdit && <AutoScheduleTab state={state} setState={setState} toast={toast.push} />}
            {tab === "courses" && canEdit && <CoursesTab state={state} setState={setState} toast={toast.push} />}
            {tab === "assets" && canEdit && <AssetsTab state={state} setState={setState} toast={toast.push} />}
            {tab === "instructor" && <InstructorTab state={state} onApptClick={handleApptClick} />}
            {tab === "conflicts" && <ConflictsTab conflicts={conflicts} state={state} onApptClick={handleApptClick} onFix={canEdit ? handleFix : null} />}
            {tab === "comments" && session && <CommentsTab state={state} onOpenAppt={ref => { const id = typeof ref === "string" ? ref : ref?.id; const a = (id && state.appointments[id]) || (typeof ref === "object" ? ref : null); if (a) setModal({ appt: a }); else toast.push("That session no longer exists", "warn"); }} />}
            {tab === "changelog" && canEdit && <ChangelogTab log={state.changelog} />}
            {tab === "settings" && canEdit && <SettingsTab state={state} setState={setState} toast={toast.push} />}
            {tab === "activity" && session && <ActivityFeed roomCode={session.roomCode} presence={collab.presence} selfId={session.userId} />}
          </main>
        </div>
        <TabBar views={views} view={tab} onView={setTab} counts={counts} onMore={() => setShowMore(true)} />
      </div>

      {modal && (
        <ApptModal appt={modal.appt || null} weekNum={modal.weekNum} dayIdx={modal.dayIdx} timeId={modal.timeId} state={state}
          readOnly={!canEdit} onSave={handleApptSave} onClose={() => setModal(null)} onDelete={id => { handleApptDelete(id); setModal(null); }} />
      )}
      {collabModal}
      {showShare && session && (
        <ShareModal session={session} onClose={() => setShowShare(false)} toast={toast.push}
          onUpgrade={collab.upgradeLegacy} onAdminCodeChanged={collab.updateSessionCode} onArchive={collab.setArchived} />
      )}
      {showMore && (
        <MoreSheet views={views} view={tab} onView={setTab} onClose={() => setShowMore(false)} theme={theme.resolved} onToggleTheme={theme.toggle}
          user={user} onSignIn={handleSignIn} onSignOut={handleSignOut} />
      )}
      {collab.accessLost && (
        <AccessLostModal info={collab.accessLost} onClose={collab.clearAccessLost}
          onJoinAgain={() => { collab.clearAccessLost(); setShowCollab(true); }} />
      )}
      <Toasts list={toast.list} dismiss={toast.dismiss} />
    </CollabCtx.Provider>
    </PresenceCtx.Provider>
  );
}
