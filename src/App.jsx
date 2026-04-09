import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  auth, db,
  signInWithGoogle, signOutUser, onAuthChange,
  loadUserState, saveUserState,
  colLoad, colSave, colGetPresence, colSetPresence,
  colPushOp, colGetOps, listRooms, registerRoom, subscribeToRoom,
} from "./firebase.js";

// ═══════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const DAYS      = ["Mon","Tue","Wed","Thu","Fri"];
const DAYS_FULL = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
const WEEKS     = [
  { n:0,  label:"Orientation", short:"ORI" },
  ...Array.from({length:16},(_,i)=>({ n:i+1, label:`Week ${i+1}`, short:`W${i+1}` })),
];
const DEFAULT_SLOTS = [
  { id:"am", label:"09:00 – 12:00", short:"Morning"   },
  { id:"pm", label:"13:00 – 16:00", short:"Afternoon" },
  { id:"ev", label:"17:00 – 20:00", short:"Evening"   },
];
const PALETTE = [
  { id:"sky",     accent:"#0284c7", bg:"rgba(2,132,199,0.10)",   border:"rgba(2,132,199,0.35)"   },
  { id:"emerald", accent:"#059669", bg:"rgba(5,150,105,0.10)",   border:"rgba(5,150,105,0.35)"   },
  { id:"rose",    accent:"#e11d48", bg:"rgba(225,29,72,0.08)",   border:"rgba(225,29,72,0.30)"   },
  { id:"violet",  accent:"#7c3aed", bg:"rgba(124,58,237,0.09)",  border:"rgba(124,58,237,0.30)"  },
  { id:"amber",   accent:"#b45309", bg:"rgba(180,83,9,0.09)",    border:"rgba(180,83,9,0.30)"    },
  { id:"orange",  accent:"#c2410c", bg:"rgba(194,65,12,0.09)",   border:"rgba(194,65,12,0.30)"   },
  { id:"lime",    accent:"#4d7c0f", bg:"rgba(77,124,15,0.09)",   border:"rgba(77,124,15,0.30)"   },
  { id:"pink",    accent:"#be185d", bg:"rgba(190,24,93,0.08)",   border:"rgba(190,24,93,0.28)"   },
  { id:"cyan",    accent:"#0e7490", bg:"rgba(14,116,144,0.09)",  border:"rgba(14,116,144,0.30)"  },
  { id:"slate",   accent:"#475569", bg:"rgba(71,85,105,0.08)",   border:"rgba(71,85,105,0.25)"   },
];
const ROOM_TYPES    = ["lecture","seminar","lab","studio","online"];
const CATEGORIES    = ["Core","Elective","Lab","Workshop","Seminar"];
const TABS = [
  { id:"schedule",     icon:"⬛", label:"Schedule"     },
  { id:"dashboard",   icon:"◈",  label:"Dashboard"    },
  { id:"autoschedule",icon:"⚡",  label:"Auto-Schedule"},
  { id:"courses",     icon:"◉",  label:"Courses"      },
  { id:"assets",      icon:"⬡",  label:"Assets"       },
  { id:"instructor",  icon:"◎",  label:"By Instructor"},
  { id:"conflicts",   icon:"△",  label:"Conflicts"    },
  { id:"changelog",   icon:"≡",  label:"Changelog"    },
  { id:"settings",    icon:"⚙",  label:"Settings"     },
];

// ═══════════════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════════════
const uid      = () => Math.random().toString(36).slice(2,9);
const addDays  = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
const iso      = d => d.toISOString().slice(0,10);
const fmt      = d => d.toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
const fmtLong  = d => d.toLocaleDateString("en-GB",{weekday:"short",day:"2-digit",month:"short",year:"numeric"});

function getWeekStart(w1,wn) {
  const b=new Date(w1), off=wn===0?-7:(wn-1)*7;
  return addDays(b,off);
}
function slotDate(w1,wn,di) { return addDays(getWeekStart(w1,wn),di); }
function getPalette(courseId,courses) {
  const c=courses?.find(x=>x.id===courseId);
  return PALETTE.find(p=>p.id===c?.colorId)||PALETTE[0];
}
function initials(name) {
  return name.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════
//  LOCAL STORAGE (solo fallback)
// ═══════════════════════════════════════════════════════════════════
const LOCAL_KEY = "kronos_v5";
const loadLocal = () => { try{ const s=localStorage.getItem(LOCAL_KEY); return s?JSON.parse(s):null; }catch{ return null; } };
const saveLocal = s  => { try{ localStorage.setItem(LOCAL_KEY,JSON.stringify(s)); }catch{} };

// ═══════════════════════════════════════════════════════════════════
//  COLLABORATION LAYER═══
const USER_COLORS = ["#059669","#0284c7","#be185d","#7c3aed","#b45309","#c2410c","#0e7490","#e11d48"];
const userColor   = (idx) => USER_COLORS[idx % USER_COLORS.length];

// Collab backend functions are imported from ./firebase.js
// genRoomCode stays here (no Firebase needed)
function genRoomCode() {
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}


// ═══════════════════════════════════════════════════════════════════
//  SEED DATA
// ═══════════════════════════════════════════════════════════════════
function seed() {
  const today=new Date(), mon=new Date(today);
  mon.setDate(today.getDate()-today.getDay()+1);
  const w1=iso(mon);
  const iA=uid(),iB=uid(),iC=uid(),iD=uid();
  const r1=uid(),r2=uid(),r3=uid(),r4=uid();
  const g1=uid(),g2=uid(),g3=uid(),g4=uid(),g5=uid();
  const c1=uid(),c2=uid(),c3=uid(),c4=uid();
  const instructors=[
    {id:iA,name:"Dr. Alice Chen",    email:"a.chen@uni.edu",   dept:"Computer Science", maxLoad:8,  available:true,  colorId:"sky",
      availability:{0:["am","pm"],1:["am"],2:["am","pm"],3:["pm"],4:["am"]}},
    {id:iB,name:"Prof. Ben Okafor",  email:"b.okafor@uni.edu", dept:"Mathematics",      maxLoad:6,  available:true,  colorId:"emerald",
      availability:{0:["pm"],1:["am","pm"],2:["pm"],3:["am","pm"],4:[]}},
    {id:iC,name:"Dr. Sara Lim",      email:"s.lim@uni.edu",    dept:"Physics",           maxLoad:8,  available:false, colorId:"amber",
      availability:{0:["am"],1:[],2:["am"],3:["am"],4:["am","pm"]}},
    {id:iD,name:"Prof. James Wright",email:"j.wright@uni.edu", dept:"Computer Science", maxLoad:10, available:true,  colorId:"violet",
      availability:{0:["am","pm"],1:["am","pm"],2:["am","pm"],3:["am","pm"],4:["am","pm"]}},
  ];
  const rooms=[
    {id:r1,name:"Lecture Hall A", capacity:120, building:"Main",    type:"lecture"},
    {id:r2,name:"Room 101",       capacity:40,  building:"Main",    type:"seminar"},
    {id:r3,name:"Lab Alpha",      capacity:24,  building:"Science", type:"lab"},
    {id:r4,name:"Room 202",       capacity:60,  building:"Main",    type:"seminar"},
  ];
  const groups=[
    {id:g1,name:"Year 1",  parentId:null,  size:80},
    {id:g2,name:"Year 2",  parentId:null,  size:75},
    {id:g3,name:"CS-1A",   parentId:g1,    size:40},
    {id:g4,name:"CS-1B",   parentId:g1,    size:38},
    {id:g5,name:"CS-2A",   parentId:g2,    size:35},
  ];
  const courses=[
    {id:c1,name:"Intro to Computer Science",code:"CS101",colorId:"sky",    defaultInstructorId:iA,defaultGroupIds:[g3],    category:"Core",    credits:3},
    {id:c2,name:"Data Structures & Algorithms",code:"CS201",colorId:"emerald",defaultInstructorId:iB,defaultGroupIds:[g5], category:"Core",    credits:3},
    {id:c3,name:"Machine Learning",         code:"CS401",colorId:"violet", defaultInstructorId:iD,defaultGroupIds:[g1,g2], category:"Elective",credits:4},
    {id:c4,name:"Physics Lab",              code:"PH101",colorId:"amber",  defaultInstructorId:iC,defaultGroupIds:[g4],    category:"Lab",     credits:2},
  ];
  const appointments={};
  [
    [1,0,"am",c1,iA,r2,[g3]],[1,2,"pm",c2,iB,r3,[g5]],[1,4,"am",c3,iD,r1,[g1,g2]],
    [2,1,"am",c1,iA,r2,[g3]],[2,3,"pm",c2,iB,r4,[g5]],[2,0,"pm",c3,iD,r1,[g1]],
    [3,2,"am",c4,iC,r3,[g4]],[3,0,"am",c1,iA,r2,[g3]],[3,4,"pm",c2,iB,r3,[g5]],
    [4,1,"pm",c3,iD,r1,[g1,g2]],[5,2,"am",c4,iC,r3,[g4]],[5,0,"pm",c1,iA,r2,[g3]],
    [6,0,"am",c1,iA,r2,[g3]],[6,3,"pm",c2,iB,r4,[g5]],[7,1,"am",c3,iD,r1,[g1,g2]],
    [7,4,"pm",c4,iC,r3,[g4]],[8,0,"am",c1,iA,r2,[g3]],[8,2,"pm",c2,iB,r3,[g5]],
  ].forEach(([wn,di,ti,cid,iid,rid,gids])=>{
    const course=courses.find(c=>c.id===cid), id=uid();
    appointments[id]={id,weekNum:wn,dayIdx:di,timeId:ti,courseId:cid,
      courseName:course?.name,courseCode:course?.code,
      instructorId:iid,roomId:rid,groupIds:gids,notes:""};
  });
  return {
    week1Start:w1,instructors,rooms,groups,courses,appointments,
    holidays:[],changelog:[],
    settings:{institution:"University of Excellence",semester:"Semester 1 – 2026",logo:""},
    slots:DEFAULT_SLOTS,
  };
}


// ── Sanitize appointment loaded from Firebase (strips undefined array fields) ──
function sanitizeAppt(a) {
  if(!a) return a;
  return {
    ...a,
    groupIds:   Array.isArray(a.groupIds)   ? a.groupIds   : [],
    notes:      a.notes      || "",
    section:    a.section    || "",
    courseCode: a.courseCode || "",
    courseName: a.courseName || "",
    instructorId: a.instructorId || "",
    roomId:     a.roomId     || "",
  };
}
function sanitizeState(s) {
  if(!s) return s;
  const appointments = {};
  Object.entries(s.appointments||{}).forEach(([k,v])=>{
    appointments[k] = sanitizeAppt(v);
  });
  return {
    ...s,
    appointments,
    instructors: (s.instructors||[]).map(i=>({...i,availability:i.availability||{}})),
    courses:     (s.courses||[]).map(c=>({...c,defaultGroupIds:Array.isArray(c.defaultGroupIds)?c.defaultGroupIds:[]})),
    groups:      s.groups     || [],
    rooms:       s.rooms      || [],
    holidays:    s.holidays   || [],
    changelog:   s.changelog  || [],
    slots:       s.slots      || [{id:"am",label:"09:00 – 12:00",short:"Morning"},{id:"pm",label:"13:00 – 16:00",short:"Afternoon"},{id:"ev",label:"17:00 – 20:00",short:"Evening"}],
    settings:    s.settings   || {institution:"",semester:"",logo:""},
  };
}

// ═══════════════════════════════════════════════════════════════════
//  CONFLICT ENGINE
// ═══════════════════════════════════════════════════════════════════
function checkConflicts(appointments,appt,wn,di,ti,excludeId=null) {
  const out=[];
  const safeAppt={...appt,groupIds:Array.isArray(appt.groupIds)?appt.groupIds:[]};
  Object.values(appointments).forEach(raw=>{
    const a={...raw,groupIds:Array.isArray(raw.groupIds)?raw.groupIds:[],instructorId:raw.instructorId||"",roomId:raw.roomId||""};
    if(a.weekNum!==wn||a.dayIdx!==di||a.timeId!==ti||a.id===excludeId) return;
    if(safeAppt.instructorId&&a.instructorId===safeAppt.instructorId)
      out.push({type:"instructor",label:"Instructor double-booked",clash:a.courseName||a.courseCode});
    if(safeAppt.roomId&&a.roomId===safeAppt.roomId)
      out.push({type:"room",label:"Room already occupied",clash:a.courseName||a.courseCode});
    const grpClash=safeAppt.groupIds.filter(g=>a.groupIds.includes(g));
    if(grpClash.length)
      out.push({type:"group",label:"Student group clash",clash:a.courseName||a.courseCode});
  });
  return out;
}
function getAllConflicts(appointments) {
  const all=[];
  if(!appointments||typeof appointments!=="object") return all;
  // Always sanitize here — Firebase may strip empty arrays on any path
  const list=Object.values(appointments).filter(Boolean).map(a=>({
    ...a,
    groupIds:Array.isArray(a.groupIds)?a.groupIds:[],
    instructorId:a.instructorId||"",
    roomId:a.roomId||"",
    weekNum:a.weekNum??0,
    dayIdx:a.dayIdx??0,
    timeId:a.timeId||"",
  }));
  list.forEach((a,i)=>{
    list.slice(i+1).forEach(b=>{
      if(a.weekNum!==b.weekNum||a.dayIdx!==b.dayIdx||a.timeId!==b.timeId) return;
      if(a.instructorId&&a.instructorId===b.instructorId)
        all.push({type:"instructor",a,b,label:"Instructor double-booked"});
      if(a.roomId&&a.roomId===b.roomId)
        all.push({type:"room",a,b,label:"Room double-booked"});
      const g=a.groupIds.filter(x=>b.groupIds.includes(x));
      if(g.length) all.push({type:"group",a,b,label:"Student group clash"});
    });
  });
  return all;
}

// ═══════════════════════════════════════════════════════════════════
//  TOAST HOOK
// ═══════════════════════════════════════════════════════════════════
function useToasts() {
  const [list,setList]=useState([]);
  const push=useCallback((msg,type="ok")=>{
    const id=uid();
    setList(t=>[...t,{id,msg,type}]);
    setTimeout(()=>setList(t=>t.filter(x=>x.id!==id)),3500);
  },[]);
  const dismiss=useCallback(id=>setList(t=>t.filter(x=>x.id!==id)),[]);
  return {list,push,dismiss};
}

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL CSS
// ═══════════════════════════════════════════════════════════════════
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html{font-size:15px;scroll-behavior:smooth;}
body{background:#f0f2f5;color:#1a1d27;font-family:'Outfit',sans-serif;overflow-x:hidden;}
:root{
  --bg:     #f0f2f5;
  --bg2:    #ffffff;
  --bg3:    #f7f8fa;
  --bg4:    #eef0f4;
  --bg5:    #e4e7ed;
  --border: rgba(0,0,0,0.08);
  --border2:rgba(0,0,0,0.14);
  --text:   #1a1d27;
  --muted:  #6b7280;
  --muted2: #9ca3af;
  --accent: #059669;
  --accent2:#2563eb;
  --danger: #dc2626;
  --warn:   #d97706;
  --mono:   'JetBrains Mono',monospace;
  --r:      6px;
  --r2:     10px;
  --r3:     14px;
  --shadow: 0 2px 12px rgba(0,0,0,0.10);
  --glow:   0 0 0 2px rgba(5,150,105,0.2);
}
input,select,textarea{
  background:#ffffff;color:var(--text);border:1px solid var(--border2);
  border-radius:var(--r);padding:8px 11px;font-family:inherit;font-size:13px;
  outline:none;transition:border-color 0.15s;width:100%;
}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:var(--glow);}
input[type=checkbox]{width:auto;cursor:pointer;accent-color:var(--accent);}
input[type=range]{width:auto;padding:0;background:transparent;border:none;}
button{font-family:inherit;cursor:pointer;border:none;outline:none;transition:all 0.15s;}
::-webkit-scrollbar{width:6px;height:6px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--muted2);border-radius:3px;}
::-webkit-scrollbar-thumb:hover{background:var(--muted);}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
@keyframes spin{to{transform:rotate(360deg)}}
.fade-in{animation:fadeIn 0.2s ease}
.slide-in{animation:slideIn 0.2s ease}
html,body,#root{height:100%;overflow:hidden;}
`;

// ═══════════════════════════════════════════════════════════════════
//  MINI COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function Badge({children,color="muted",style={}}) {
  const colors={
    muted:{bg:"var(--bg4)",color:"var(--muted)",border:"1px solid var(--border2)"},
    green:{bg:"rgba(52,211,153,0.12)",color:"#34d399",border:"rgba(52,211,153,0.25)"},
    red:{bg:"rgba(248,113,113,0.12)",color:"#f87171",border:"rgba(248,113,113,0.25)"},
    yellow:{bg:"rgba(251,191,36,0.12)",color:"#fbbf24",border:"rgba(251,191,36,0.25)"},
    blue:{bg:"rgba(59,130,246,0.12)",color:"#60a5fa",border:"rgba(59,130,246,0.25)"},
    accent:{bg:"rgba(5,150,105,0.10)",color:"var(--accent)",border:"rgba(5,150,105,0.22)"},
  };
  const c=colors[color]||colors.muted;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",
      borderRadius:99,fontSize:10,fontWeight:600,letterSpacing:"0.05em",
      background:c.bg,color:c.color,border:`1px solid ${c.border}`,...style}}>
      {children}
    </span>
  );
}

function Btn({children,onClick,variant="ghost",size="sm",style={},disabled=false,title=""}) {
  const variants={
    ghost:{background:"transparent",color:"var(--muted)",border:"1px solid transparent"},
    outline:{background:"transparent",color:"var(--text)",border:"1px solid var(--border2)"},
    solid:{background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border2)"},
    accent:{background:"rgba(5,150,105,0.12)",color:"var(--accent)",border:"1px solid rgba(110,231,183,0.3)"},
    danger:{background:"rgba(248,113,113,0.12)",color:"var(--danger)",border:"1px solid rgba(248,113,113,0.25)"},
    primary:{background:"var(--accent)",color:"#ffffff",border:"none"},
  };
  const sizes={xs:{padding:"3px 8px",fontSize:10},sm:{padding:"5px 10px",fontSize:11},md:{padding:"7px 14px",fontSize:12}};
  const v=variants[variant]||variants.ghost;
  const s=sizes[size]||sizes.sm;
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{...v,...s,borderRadius:"var(--r)",fontWeight:500,fontFamily:"inherit",
        opacity:disabled?0.4:1,cursor:disabled?"not-allowed":"pointer",
        display:"inline-flex",alignItems:"center",gap:5,...style}}
      onMouseEnter={e=>{if(!disabled){e.currentTarget.style.opacity="0.8";}}}
      onMouseLeave={e=>{e.currentTarget.style.opacity="1";}}>
      {children}
    </button>
  );
}

function Modal({title,subtitle,onClose,children,width=520}) {
  useEffect(()=>{
    const esc=(e)=>{if(e.key==="Escape") onClose();};
    document.addEventListener("keydown",esc);
    return ()=>document.removeEventListener("keydown",esc);
  },[onClose]);
  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{position:"fixed",inset:0,background:"rgba(15,20,40,0.55)",zIndex:200,
        display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div className="fade-in" style={{background:"var(--bg2)",border:"1px solid var(--border2)",
        borderRadius:"var(--r3)",width:"100%",maxWidth:width,maxHeight:"90vh",
        display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"var(--shadow)"}}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",
          display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontWeight:600,fontSize:14}}>{title}</div>
            {subtitle&&<div style={{color:"var(--muted)",fontSize:11,marginTop:2}}>{subtitle}</div>}
          </div>
          <Btn onClick={onClose} style={{fontSize:14,padding:"4px 8px"}}>✕</Btn>
        </div>
        <div style={{overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",flex:1}}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({label,children,required=false,hint=""}) {
  return (
    <div style={{marginBottom:12}}>
      <label style={{display:"block",fontSize:10,fontWeight:600,color:"var(--muted)",
        textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>
        {label}{required&&<span style={{color:"var(--danger)"}}> *</span>}
      </label>
      {children}
      {hint&&<div style={{fontSize:10,color:"var(--muted2)",marginTop:3}}>{hint}</div>}
    </div>
  );
}

function MultiSelect({options,value=[],onChange,placeholder="Select..."}) {
  const [open,setOpen]=useState(false);
  const ref=useRef();
  useEffect(()=>{
    const h=(e)=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return ()=>document.removeEventListener("mousedown",h);
  },[]);
  const selected=options.filter(o=>value.includes(o.value));
  return (
    <div ref={ref} style={{position:"relative"}}>
      <div onClick={()=>setOpen(v=>!v)}
        style={{background:"var(--bg3)",border:`1px solid ${open?"var(--accent)":"var(--border2)"}`,
          borderRadius:"var(--r)",padding:"6px 10px",cursor:"pointer",minHeight:33,
          display:"flex",flexWrap:"wrap",gap:4,alignItems:"center",
          boxShadow:open?"var(--glow)":"none"}}>
        {selected.length===0&&<span style={{color:"var(--muted)",fontSize:11}}>{placeholder}</span>}
        {selected.map(o=>(
          <span key={o.value} style={{display:"inline-flex",alignItems:"center",gap:3,
            background:"var(--bg5)",border:"1px solid var(--border2)",
            borderRadius:4,padding:"1px 6px",fontSize:10,color:"var(--text)"}}>
            {o.label}
            <span onClick={e=>{e.stopPropagation();onChange(value.filter(v=>v!==o.value));}}
              style={{cursor:"pointer",color:"var(--muted)",marginLeft:2,fontSize:9}}>✕</span>
          </span>
        ))}
        <span style={{marginLeft:"auto",color:"var(--muted)",fontSize:10}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,
          background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:"var(--r)",
          marginTop:2,maxHeight:180,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",boxShadow:"var(--shadow)"}}>
          {options.map(o=>{
            const sel=value.includes(o.value);
            return (
              <div key={o.value} onClick={()=>onChange(sel?value.filter(v=>v!==o.value):[...value,o.value])}
                style={{padding:"7px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,
                  fontSize:11,background:sel?"var(--bg4)":"transparent",
                  borderBottom:"1px solid var(--border)"}}>
                <span style={{width:12,height:12,borderRadius:3,border:`1px solid var(--border2)`,
                  background:sel?"var(--accent)":"transparent",flexShrink:0,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,
                  color:"#080a0e",fontWeight:700}}>{sel?"✓":""}</span>
                {o.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  TOAST RENDERER
// ═══════════════════════════════════════════════════════════════════
function Toasts({list,dismiss}) {
  const colors={ok:{bg:"#f0fdf4",border:"#86efac",color:"#15803d"},
    error:{bg:"#fef2f2",border:"#fca5a5",color:"#dc2626"},
    warn:{bg:"#fffbeb",border:"#fcd34d",color:"#b45309"},
    info:{bg:"#eff6ff",border:"#93c5fd",color:"#1d4ed8"}};
  return (
    <div style={{position:"fixed",bottom:20,right:20,zIndex:999,display:"flex",flexDirection:"column",gap:8}}>
      {list.map(t=>{
        const c=colors[t.type]||colors.info;
        return (
          <div key={t.id} className="slide-in" onClick={()=>dismiss(t.id)}
            style={{background:c.bg,border:`1px solid ${c.border}`,color:c.color,
              padding:"10px 14px",borderRadius:"var(--r2)",fontSize:12,fontWeight:500,
              cursor:"pointer",minWidth:240,boxShadow:"var(--shadow)"}}>
            {t.msg}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  APPOINTMENT MODAL
// ═══════════════════════════════════════════════════════════════════
function ApptModal({appt,weekNum,dayIdx,timeId,state,onSave,onClose,onDelete}) {
  const {courses,instructors,rooms,groups,appointments,slots}=state;
  const isEdit=!!appt;
  const [form,setForm]=useState(()=>{
    if(isEdit) return {...appt};
    const w=weekNum??1,d=dayIdx??0,t=timeId??slots[0]?.id;
    return {weekNum:w,dayIdx:d,timeId:t,courseId:"",instructorId:"",roomId:"",groupIds:[],section:"",notes:""};
  });
  const [scheduleAll,setScheduleAll]=useState(false);
  const [overrides,setOverrides]=useState({instructor:false,room:false,group:false});

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

  const conflicts=useMemo(()=>checkConflicts(appointments,form,form.weekNum,form.dayIdx,form.timeId,isEdit?appt.id:null),[form,appointments]);
  const blockingConflicts=conflicts.filter(c=>!overrides[c.type]);

  function handleSave() {
    if(!form.courseId||!form.weekNum===undefined) return;
    if(blockingConflicts.length) return;
    const course=courses.find(x=>x.id===form.courseId);
    const base={...form,courseName:course?.name,courseCode:course?.code,section:form.section||""};
    const toSave=[];
    if(scheduleAll&&!isEdit) {
      WEEKS.filter(w=>w.n>0).forEach(w=>{
        const wConflicts=checkConflicts(appointments,{...base,weekNum:w.n},w.n,form.dayIdx,form.timeId);
        if(!wConflicts.length) toSave.push({...base,id:uid(),weekNum:w.n});
      });
    } else {
      toSave.push(isEdit?{...base,id:appt.id}:{...base,id:uid()});
    }
    onSave(toSave,isEdit);
  }

  const selCourse=courses.find(x=>x.id===form.courseId);
  const pal=selCourse?PALETTE.find(p=>p.id===selCourse.colorId)||PALETTE[0]:null;

  return (
    <Modal title={isEdit?"Edit Session":"New Session"}
      subtitle={isEdit?`${appt.courseCode} · ${DAYS_FULL[appt.dayIdx]} ${appt.timeId==="am"?"Morning":"Afternoon"}`:"Schedule a new class session"}
      onClose={onClose} width={520}>
      <div style={{padding:20,display:"flex",flexDirection:"column",gap:0}}>
        {/* Course */}
        <Field label="Course" required>
          <select value={form.courseId} onChange={e=>setForm(f=>({...f,courseId:e.target.value,instructorId:"",groupIds:[]}))}>
            <option value="">— Select course —</option>
            {courses.map(c=><option key={c.id} value={c.id}>[{c.code}] {c.name}</option>)}
          </select>
        </Field>
        {pal&&(
          <div style={{marginBottom:12,padding:"8px 10px",borderRadius:"var(--r)",
            background:pal.bg,border:`1px solid ${pal.border}`,
            display:"flex",alignItems:"center",gap:8,fontSize:11,color:pal.accent}}>
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

        {/* Instructor + Room */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <Field label="Instructor">
            <select value={form.instructorId} onChange={e=>setForm(f=>({...f,instructorId:e.target.value}))}>
              <option value="">— None —</option>
              {instructors.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </Field>
          <Field label="Room">
            <select value={form.roomId} onChange={e=>setForm(f=>({...f,roomId:e.target.value}))}>
              <option value="">— TBD —</option>
              {rooms.map(r=><option key={r.id} value={r.id}>{r.name} ({r.capacity})</option>)}
            </select>
          </Field>
        </div>

        {/* Groups */}
        <Field label="Student Groups">
          <MultiSelect
            options={groups.map(g=>({value:g.id,label:g.name}))}
            value={form.groupIds}
            onChange={v=>setForm(f=>({...f,groupIds:v}))}
            placeholder="Select groups..."
          />
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
              <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"7px 10px",borderRadius:"var(--r)",marginBottom:4,
                background:`rgba(248,113,113,${overrides[c.type]?0.04:0.12})`,
                border:`1px solid rgba(248,113,113,${overrides[c.type]?0.15:0.3})`}}>
                <span style={{fontSize:11,color:overrides[c.type]?"var(--muted)":"var(--danger)"}}>
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

        {/* Schedule All */}
        {!isEdit&&(
          <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,cursor:"pointer",
            padding:"8px 10px",borderRadius:"var(--r)",background:"var(--bg3)",
            border:"1px solid var(--border)"}}>
            <input type="checkbox" checked={scheduleAll} onChange={e=>setScheduleAll(e.target.checked)}/>
            <span style={{fontSize:11,color:"var(--text)"}}>Schedule across all 16 weeks (skips conflicts)</span>
          </label>
        )}

        {/* Actions */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingTop:4}}>
          <div>
            {isEdit&&<Btn variant="danger" onClick={()=>{onDelete(appt.id);onClose();}}>Delete</Btn>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSave}
              disabled={!form.courseId||blockingConflicts.length>0}
              style={{minWidth:90}}>
              {isEdit?"Update":"Schedule"}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CHIP (appointment cell)
// ═══════════════════════════════════════════════════════════════════
function ApptChip({appt,courses,instructors,rooms,onClick,conflicts=[]}) {
  const pal=getPalette(appt.courseId,courses);
  const hasConflict=(conflicts||[]).some(c=>c&&c.a&&c.b&&(c.a.id===appt.id||c.b.id===appt.id));
  const instr=instructors.find(x=>x.id===appt.instructorId);
  const room=rooms.find(x=>x.id===appt.roomId);
  return (
    <div onClick={()=>onClick(appt)}
      style={{background:pal.bg,border:`1px solid ${hasConflict?"var(--danger)":pal.border}`,
        borderRadius:"var(--r)",padding:"5px 7px",cursor:"pointer",marginBottom:3,
        transition:"all 0.12s",position:"relative",overflow:"hidden"}}>
      {hasConflict&&(
        <div style={{position:"absolute",top:0,right:0,width:0,height:0,
          borderStyle:"solid",borderWidth:"0 16px 16px 0",
          borderColor:`transparent var(--danger) transparent transparent`}}/>
      )}
      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
        <span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:pal.accent,
          background:"rgba(0,0,0,0.06)",padding:"1px 4px",borderRadius:3}}>
          {appt.courseCode}{appt.section?` §${appt.section}`:""}
        </span>
      </div>
      <div style={{fontSize:10,fontWeight:500,color:pal.accent,lineHeight:1.3,
        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
        {appt.courseName}
      </div>
      {instr&&<div style={{fontSize:9,color:"var(--muted)",marginTop:2,
        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
        {instr.name.split(" ").slice(-1)[0]}
        {room?" · "+room.name:""}
      </div>}
    </div>
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
  const PALETTE_MAP=Object.fromEntries(PALETTE.map(p=>[p.id,p]));

  let rows="";
  weeks.forEach(w=>{
    const ws=getWeekStart(week1Start,w.n);
    let hasContent=Object.keys(byWeek[w.n]||{}).length>0;
    if(!hasContent) return;
    rows+=`<tr class="week-header"><td colspan="${1+DAYS.length*slots.length}">${w.label} &mdash; ${fmt(ws)} &ndash; ${fmt(addDays(ws,4))}</td></tr>
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
        const cells=(byWeek[w.n]||{})[key]||[];
        if(cells.length===0){rows+=`<td class="empty"></td>`;return;}
        const cell=cells[0];
        const pal=PALETTE_MAP[courses.find(x=>x.id===cell.courseId)?.colorId]||PALETTE[0];
        const instr=instructors.find(x=>x.id===cell.instructorId);
        const room=rooms.find(x=>x.id===cell.roomId);
        rows+=`<td class="session" style="background:${pal.bg};border-color:${pal.border}">
          <div class="code" style="color:${pal.accent}">${cell.courseCode||""}</div>
          <div class="name">${cell.courseName||""}</div>
          ${instr?`<div class="meta">${instr.name}</div>`:""}
          ${room?`<div class="meta">${room.name}</div>`:""}
        </td>`;
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
    const slotLabel=slots.find(s=>s.id===a.timeId)?.label||a.timeId;
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
function ExportDropdown({state,filterGroup}) {
  const [open,setOpen]=useState(false);
  const ref=useRef();
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);
  const groups=state.groups;
  const targetGroup=filterGroup||null;
  const label=targetGroup?groups.find(g=>g.id===targetGroup)?.name:"Select a group first";

  return (
    <div ref={ref} style={{position:"relative"}}>
      <Btn variant="outline" onClick={()=>setOpen(v=>!v)}>
        ↓ Export {open?"▲":"▼"}
      </Btn>
      {open&&(
        <div style={{position:"absolute",top:"100%",right:0,marginTop:4,zIndex:50,
          background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:"var(--r2)",
          minWidth:220,boxShadow:"var(--shadow)",overflow:"hidden"}}>
          <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",
            fontSize:10,color:"var(--muted)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>
            Export Cohort Timetable
          </div>
          {!targetGroup&&(
            <div style={{padding:"10px 12px",fontSize:11,color:"var(--muted)"}}>
              Use the group filter to select a cohort first
            </div>
          )}
          {targetGroup&&(
            <>
              <div onClick={()=>{exportCohortHTML(state,targetGroup);setOpen(false);}}
                style={{padding:"10px 14px",cursor:"pointer",fontSize:12,
                  borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--bg4)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{fontSize:14}}>🌐</span>
                <div>
                  <div style={{fontWeight:500}}>Export as HTML</div>
                  <div style={{fontSize:10,color:"var(--muted)"}}>Full printable timetable · open in browser</div>
                </div>
              </div>
              <div onClick={()=>{exportCohortCSV(state,targetGroup);setOpen(false);}}
                style={{padding:"10px 14px",cursor:"pointer",fontSize:12,
                  display:"flex",alignItems:"center",gap:8}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--bg4)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{fontSize:14}}>📊</span>
                <div>
                  <div style={{fontWeight:500}}>Export as CSV</div>
                  <div style={{fontSize:10,color:"var(--muted)"}}>All sessions · open in Excel or Sheets</div>
                </div>
              </div>
            </>
          )}
          {/* Export all groups */}
          <div style={{borderTop:"1px solid var(--border)",padding:"6px 8px",display:"flex",flexWrap:"wrap",gap:4}}>
            {groups.map(g=>(
              <button key={g.id}
                onClick={()=>{exportCohortHTML(state,g.id);setOpen(false);}}
                style={{fontSize:10,padding:"3px 8px",borderRadius:99,cursor:"pointer",
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
function ScheduleTab({state,onApptClick,onCellClick,conflicts}) {
  const {appointments,courses,instructors,rooms,groups,week1Start,holidays,slots}=state;
  const [filterGroup,setFilterGroup]=useState("");
  const [selWeek,setSelWeek]=useState(1);
  const week=WEEKS.find(w=>w.n===selWeek)||WEEKS[1];
  const ws=getWeekStart(week1Start,selWeek);

  function isHoliday(di) {
    const d=slotDate(week1Start,selWeek,di);
    return holidays.some(h=>h.date===iso(d));
  }
  function getHolidayName(di) {
    const d=slotDate(week1Start,selWeek,di);
    return holidays.find(h=>h.date===iso(d))?.name||"";
  }

  const filteredAppts=useMemo(()=>{
    return Object.values(appointments).filter(a=>{
      if(a.weekNum!==selWeek) return false;
      if(filterGroup&&!(a.groupIds||[]).includes(filterGroup)) return false;
      return true;
    });
  },[appointments,selWeek,filterGroup]);

  const apptMap=useMemo(()=>{
    const m={};
    filteredAppts.forEach(a=>{
      const k=`${a.dayIdx}_${a.timeId}`;
      if(!m[k]) m[k]=[];
      m[k].push(a);
    });
    return m;
  },[filteredAppts]);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",minHeight:0}}>
      {/* Controls */}
      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",
        display:"flex",alignItems:"center",gap:10,flexShrink:0,flexWrap:"wrap"}}>
        {/* Week navigator */}
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <Btn variant="outline" onClick={()=>setSelWeek(v=>Math.max(0,v-1))}>◀</Btn>
          <div style={{position:"relative"}}>
            <select value={selWeek} onChange={e=>setSelWeek(+e.target.value)}
              style={{width:140,paddingRight:24}}>
              {WEEKS.map(w=><option key={w.n} value={w.n}>{w.label}</option>)}
            </select>
          </div>
          <Btn variant="outline" onClick={()=>setSelWeek(v=>Math.min(16,v+1))}>▶</Btn>
        </div>

        {/* Date range */}
        <span style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--mono)"}}>
          {fmt(ws)} — {fmt(addDays(ws,4))}
        </span>

        <div style={{flex:1}}/>

        {/* Group filter */}
        <select value={filterGroup} onChange={e=>setFilterGroup(e.target.value)}
          style={{width:140}}>
          <option value="">All groups</option>
          {state.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        {/* Cohort export */}
        <ExportDropdown state={state} filterGroup={filterGroup}/>
      </div>

      {/* Grid */}
      <div style={{flex:1,overflowY:"auto",overflowX:"auto",padding:12,minHeight:0,WebkitOverflowScrolling:"touch"}}>
        <table style={{width:"100%",borderCollapse:"separate",borderSpacing:3}}>
          <thead>
            <tr>
              <th style={{width:80,fontSize:10,color:"var(--muted)",fontWeight:600,
                textTransform:"uppercase",letterSpacing:"0.08em",textAlign:"left",
                padding:"6px 8px"}}>Slot</th>
              {DAYS.map((d,di)=>{
                const dt=slotDate(week1Start,selWeek,di);
                const hol=isHoliday(di);
                return (
                  <th key={di} style={{fontSize:11,padding:"6px 8px",textAlign:"left",
                    fontWeight:500,color:hol?"var(--warn)":"var(--text)"}}>
                    <div>{d}</div>
                    <div style={{fontFamily:"var(--mono)",fontSize:9,color:hol?"var(--warn)":"var(--muted)",fontWeight:400}}>
                      {hol?getHolidayName(di):fmt(dt)}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slots.map(slot=>(
              <tr key={slot.id}>
                <td style={{verticalAlign:"top",padding:"6px 8px"}}>
                  <div style={{fontSize:10,fontWeight:600,color:"var(--accent)",fontFamily:"var(--mono)"}}>
                    {slot.short.toUpperCase()}
                  </div>
                  <div style={{fontSize:9,color:"var(--muted2)",marginTop:1}}>{slot.label}</div>
                </td>
                {DAYS.map((_,di)=>{
                  const hol=isHoliday(di);
                  const key=`${di}_${slot.id}`;
                  const cells=apptMap[key]||[];
                  return (
                    <td key={di} style={{verticalAlign:"top",
                      background:hol?"rgba(251,191,36,0.04)":"var(--bg2)",
                      border:`1px solid ${hol?"rgba(251,191,36,0.15)":"var(--border)"}`,
                      borderRadius:"var(--r)",padding:4,minHeight:80,width:"18%",cursor:"pointer"}}
                      onClick={()=>{if(!hol&&cells.length===0)onCellClick(selWeek,di,slot.id);}}>
                      {hol?(
                        <div style={{padding:"4px 6px",color:"var(--warn)",fontSize:9,
                          textAlign:"center",marginTop:8}}>Holiday</div>
                      ):(
                        <>
                          {cells.map(a=>(
                            <ApptChip key={a.id} appt={a} courses={courses}
                              instructors={instructors} rooms={rooms}
                              onClick={onApptClick} conflicts={conflicts}/>
                          ))}
                          {cells.length===0&&(
                            <div style={{height:60,display:"flex",alignItems:"center",
                              justifyContent:"center",color:"var(--muted2)",fontSize:10,
                              opacity:0.4}}>+</div>
                          )}
                        </>
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
    pal:PALETTE.find(p=>p.id===c.colorId)||PALETTE[0],
  })).sort((a,b)=>b.count-a.count);

  // Load per instructor
  const byInstructor=instructors.map(i=>({
    ...i,
    count:apptList.filter(a=>a.instructorId===i.id).length,
    pal:PALETTE.find(p=>p.id===i.colorId)||PALETTE[0],
  })).sort((a,b)=>b.count-a.count);

  // Sessions by day
  const byDay=DAYS.map((d,i)=>({day:d,count:apptList.filter(a=>a.dayIdx===i).length}));
  const maxDay=Math.max(...byDay.map(d=>d.count),1);

  const StatCard=({label,value,sub,color="var(--text)"})=>(
    <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",
      padding:"14px 16px",flex:1,minWidth:120}}>
      <div style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",
        letterSpacing:"0.08em",fontWeight:600,marginBottom:6}}>{label}</div>
      <div style={{fontSize:24,fontWeight:700,color,fontFamily:"var(--mono)",letterSpacing:"-0.02em"}}>
        {value}
      </div>
      {sub&&<div style={{fontSize:10,color:"var(--muted)",marginTop:4}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{padding:16,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",height:"100%"}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>Overview</div>
        <div style={{color:"var(--muted)",fontSize:11}}>{state.settings.semester}</div>
      </div>

      {/* Stat cards */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <StatCard label="Total Sessions" value={totalSessions} sub={`across ${scheduledWeeks} weeks`}/>
        <StatCard label="Conflicts" value={conflictCount}
          color={conflictCount>0?"var(--danger)":"var(--accent)"}
          sub={conflictCount===0?"All clear ✓":"Need attention"}/>
        <StatCard label="Instructors" value={instructors.length} sub={`${instructors.filter(i=>i.available).length} available`}/>
        <StatCard label="Rooms" value={rooms.length} sub={`${rooms.length} venues`}/>
        <StatCard label="Courses" value={courses.length} sub={`${groups.length} student groups`}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
        {/* Sessions by day */}
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:14}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:12,color:"var(--muted)"}}>
            SESSIONS BY DAY
          </div>
          {byDay.map(({day,count})=>(
            <div key={day} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <span style={{width:28,fontSize:10,fontFamily:"var(--mono)",color:"var(--muted)",flexShrink:0}}>{day}</span>
              <div style={{flex:1,background:"var(--bg4)",borderRadius:3,height:6,overflow:"hidden"}}>
                <div style={{width:`${(count/maxDay)*100}%`,height:"100%",
                  background:"var(--accent)",borderRadius:3,transition:"width 0.5s"}}/>
              </div>
              <span style={{fontSize:10,fontFamily:"var(--mono)",color:"var(--text)",
                width:20,textAlign:"right"}}>{count}</span>
            </div>
          ))}
        </div>

        {/* Instructor load */}
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:14}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:12,color:"var(--muted)"}}>
            INSTRUCTOR LOAD
          </div>
          {byInstructor.map(i=>{
            const pct=i.maxLoad?Math.min((i.count/i.maxLoad)*100,100):0;
            return (
              <div key={i.id} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                  <span style={{fontSize:10,color:"var(--text)",
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"70%"}}>
                    {i.name.split(" ").slice(-1)[0]}
                  </span>
                  <span style={{fontSize:9,fontFamily:"var(--mono)",
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
        <div style={{fontSize:11,fontWeight:600,marginBottom:12,color:"var(--muted)"}}>
          COURSE BREAKDOWN
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
          {byCourse.map(c=>(
            <div key={c.id} style={{background:"var(--bg3)",borderRadius:"var(--r)",
              border:`1px solid ${c.pal.border}`,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:c.pal.accent,flexShrink:0}}/>
                <span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:c.pal.accent}}>{c.code}</span>
                <Badge color="muted" style={{marginLeft:"auto"}}>{c.category}</Badge>
              </div>
              <div style={{fontSize:11,fontWeight:500,marginBottom:3,color:"var(--text)",
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div>
              <div style={{fontSize:10,color:"var(--muted)"}}>
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
    courseName:"",courseCode:"",instructor:"",group:"",category:"",credits:""
  });
  const [parseResult,setParseResult]=useState(null);

  const TEMPLATE_CSV=[
    "Course Name,Course Code,Instructor,Student Group,Category,Credits",
    "Intro to Python,CS101,Dr. Alice Chen,CS-1A,Core,3",
    "Data Structures,CS201,Prof. Ben Okafor,CS-2A,Core,3",
    "Machine Learning,CS401,Prof. James Wright,Year 1,Elective,4",
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
      const groupName=get(row,mapping.group).trim();
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

      // Find or create group
      let groupId="";
      if(groupName){
        let grp=newGroups.find(g=>g.name.toLowerCase()===groupName.toLowerCase());
        if(!grp){
          grp={id:uid(),name:groupName,parentId:null,size:30};
          newGroups.push(grp);
          addedGroups++;
        }
        groupId=grp.id;
      }

      // Find or create course
      let course=newCourses.find(c=>
        c.code.toLowerCase()===courseCode.toLowerCase()||
        c.name.toLowerCase()===courseName.toLowerCase()
      );
      if(!course){
        course={
          id:uid(),name:courseName,code:courseCode||courseName.slice(0,6).toUpperCase(),
          colorId:COLORS[colorIdx%COLORS.length],
          defaultInstructorId:instrId,
          defaultGroupIds:groupId?[groupId]:[],
          category:CATEGORIES.includes(category)?category:"Core",
          credits,
        };
        newCourses.push(course);
        colorIdx++;
        addedCourses++;
      } else {
        // Update defaults if new info
        if(instrId&&!course.defaultInstructorId) course.defaultInstructorId=instrId;
        if(groupId&&!(course.defaultGroupIds||[]).includes(groupId))
          course.defaultGroupIds=[...course.defaultGroupIds,groupId];
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
              <div style={{fontSize:28,marginBottom:8}}>📄</div>
              <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>Drop your CSV file here or click to browse</div>
              <div style={{fontSize:11,color:"var(--muted)",marginBottom:14}}>
                Columns: Course Name, Course Code, Instructor, Student Group, Category, Credits
              </div>
              <input type="file" accept=".csv,.txt" onChange={e=>e.target.files[0]&&handleFile(e.target.files[0])}
                style={{display:"none"}} id="csv-upload"/>
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <label htmlFor="csv-upload">
                  <Btn variant="accent" as="span">Browse File</Btn>
                </label>
                <Btn variant="outline" onClick={downloadTemplate}>↓ Download Template</Btn>
              </div>
            </div>
            {error&&<div style={{color:"var(--danger)",fontSize:11,marginBottom:12}}>{error}</div>}
            <div style={{background:"var(--bg3)",borderRadius:"var(--r)",padding:12,
              border:"1px solid var(--border)"}}>
              <div style={{fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
                letterSpacing:"0.08em",marginBottom:8}}>Expected Format</div>
              <pre style={{fontSize:10,fontFamily:"var(--mono)",color:"var(--muted)",
                overflowX:"auto",lineHeight:1.6}}>
{`Course Name,Course Code,Instructor,Student Group,Category,Credits
Intro to Python,CS101,Dr. Alice Chen,CS-1A,Core,3
Data Structures,CS201,Prof. Ben Okafor,CS-2A,Core,3`}
              </pre>
            </div>
          </>
        )}

        {step==="preview"&&preview&&(
          <>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:600,marginBottom:10}}>
                Column Mapping — {preview.rows.length} rows detected
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                {[
                  ["courseName","Course Name *"],
                  ["courseCode","Course Code"],
                  ["instructor","Instructor"],
                  ["group","Student Group"],
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
              <div style={{fontSize:10,color:"var(--muted)",marginBottom:8,fontWeight:600,
                textTransform:"uppercase",letterSpacing:"0.08em"}}>
                Preview (first 5 rows)
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
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
              <Btn variant="outline" onClick={()=>setStep("upload")}>← Back</Btn>
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
            <div style={{fontSize:36,marginBottom:12}}>✓</div>
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
                  <div style={{fontSize:10,color:"var(--muted)",marginTop:2}}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:16}}>
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
  function remove(id) {
    setState(s=>({...s,courses:s.courses.filter(c=>c.id!==id)}));
    toast("Course removed","warn");
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
          <Btn variant="outline" onClick={()=>setShowImport(true)}>↑ CSV</Btn>
          <Btn variant="accent" onClick={()=>setEditing({...blank})}>+ Add</Btn>
        </div>
        <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch"}}>
          {filtered.map(c=>{
            const pal=PALETTE.find(p=>p.id===c.colorId)||PALETTE[0];
            const sessions=Object.values(state.appointments).filter(a=>a.courseId===c.id).length;
            return (
              <div key={c.id} onClick={()=>setEditing({...c})}
                style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",
                  cursor:"pointer",background:editing?.id===c.id?"var(--bg3)":"transparent",
                  borderLeft:`3px solid ${editing?.id===c.id?pal.accent:"transparent"}`,
                  transition:"all 0.12s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:pal.accent,flexShrink:0}}/>
                  <span style={{fontSize:10,fontFamily:"var(--mono)",fontWeight:600,color:pal.accent}}>{c.code}</span>
                  <Badge color="muted">{c.category}</Badge>
                  <span style={{marginLeft:"auto",fontSize:10,color:"var(--muted2)"}}>{sessions}×</span>
                </div>
                <div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{c.name}</div>
                <div style={{fontSize:10,color:"var(--muted)",marginTop:2}}>{c.credits} credits</div>
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
          color:"var(--muted2)",fontSize:12}}>
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
  const pal=PALETTE.find(p=>p.id===form.colorId)||PALETTE[0];
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
          <select value={form.defaultInstructorId} onChange={e=>set("defaultInstructorId",e.target.value)}>
            <option value="">— None —</option>
            {instructors.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Default Student Groups" hint="Pre-selected when scheduling this course">
        <MultiSelect
          options={groups.map(g=>({value:g.id,label:g.name}))}
          value={form.defaultGroupIds}
          onChange={v=>set("defaultGroupIds",v)}
          placeholder="Select default groups..."/>
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
          fontSize:11,color:pal.accent}}>
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
  function remove(id) {
    setState(s=>({...s,instructors:s.instructors.filter(i=>i.id!==id)}));
    toast("Instructor removed","warn");
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
            const pal=PALETTE.find(p=>p.id===i.colorId)||PALETTE[0];
            const sessions=Object.values(appointments).filter(a=>a.instructorId===i.id).length;
            return (
              <div key={i.id} onClick={()=>setEditing({...i})}
                style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",
                  cursor:"pointer",background:editing?.id===i.id?"var(--bg3)":"transparent",
                  borderLeft:`3px solid ${editing?.id===i.id?pal.accent:"transparent"}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:pal.bg,
                    border:`1px solid ${pal.border}`,display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:9,fontWeight:700,color:pal.accent,flexShrink:0}}>
                    {initials(i.name)}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:500,color:"var(--text)",
                      whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{i.name}</div>
                    <div style={{fontSize:9,color:"var(--muted)"}}>{i.dept}</div>
                  </div>
                  <Badge color={i.available?"green":"red"}>{i.available?"Active":"Away"}</Badge>
                </div>
                <div style={{fontSize:9,color:"var(--muted2)",display:"flex",gap:8}}>
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
            <div style={{fontSize:13,fontWeight:600}}>{editing.id?"Edit Instructor":"New Instructor"}</div>
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
      {!editing&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted2)",fontSize:12}}>Select an instructor to edit</div>}
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
  function remove(id) {
    setState(s=>({...s,rooms:s.rooms.filter(r=>r.id!==id)}));
    toast("Room removed","warn");
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
                  <span style={{fontSize:11,fontWeight:500}}>{r.name}</span>
                  <Badge color={tc} style={{marginLeft:"auto"}}>{r.type}</Badge>
                </div>
                <div style={{fontSize:10,color:"var(--muted)"}}>
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
            <div style={{fontSize:13,fontWeight:600}}>{editing.id?"Edit Room":"New Room"}</div>
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
      {!editing&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted2)",fontSize:12}}>Select a room to edit</div>}
    </div>
  );
}

function GroupsPanel({state,setState,toast}) {
  const {groups}=state;
  const [editing,setEditing]=useState(null);
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
  function remove(id) {
    setState(s=>({...s,groups:s.groups.filter(g=>g.id!==id&&g.parentId!==id)}));
    toast("Group removed","warn");
    setEditing(null);
  }

  function GroupNode({g,depth=0}) {
    const children=groups.filter(x=>x.parentId===g.id);
    return (
      <div>
        <div onClick={()=>setEditing({...g})}
          style={{padding:`8px 12px`,paddingLeft:12+depth*16,borderBottom:"1px solid var(--border)",
            cursor:"pointer",background:editing?.id===g.id?"var(--bg3)":"transparent",
            display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:10,color:"var(--muted2)"}}>{depth>0?"└":"●"}</span>
          <span style={{fontSize:11,fontWeight:depth===0?600:400}}>{g.name}</span>
          {g.size&&<span style={{fontSize:9,color:"var(--muted2)",marginLeft:"auto"}}>{g.size} students</span>}
        </div>
        {children.map(c=><GroupNode key={c.id} g={c} depth={depth+1}/>)}
      </div>
    );
  }

  const roots=groups.filter(g=>!g.parentId);

  return (
    <div style={{display:"flex",height:"100%"}}>
      <div style={{width:260,borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column"}}>
        <div style={{padding:10,borderBottom:"1px solid var(--border)"}}>
          <Btn variant="accent" style={{width:"100%",justifyContent:"center"}} onClick={()=>setEditing({...blank})}>+ Add Group</Btn>
        </div>
        <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch"}}>
          {roots.map(g=><GroupNode key={g.id} g={g}/>)}
        </div>
      </div>
      {editing&&(
        <div style={{flex:1,padding:20,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600}}>{editing.id?"Edit Group":"New Group"}</div>
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
              <select value={editing.parentId||""} onChange={e=>setEditing(f=>({...f,parentId:e.target.value||null}))}>
                <option value="">— Top level —</option>
                {groups.filter(g=>g.id!==editing.id).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Student Count">
              <input type="number" min={0} value={editing.size||""} onChange={e=>setEditing(f=>({...f,size:+e.target.value}))}/>
            </Field>
          </div>
        </div>
      )}
      {!editing&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted2)",fontSize:12}}>Select a group to edit</div>}
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
        slots.find(s=>s.id===a.timeId)?.label||a.timeId,a.courseName,a.courseCode,room,grps]);
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
        <select value={selInstructor} onChange={e=>setSelInstructor(e.target.value)} style={{width:200}}>
          {instructors.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select value={selWeek} onChange={e=>setSelWeek(+e.target.value)} style={{width:130}}>
          {WEEKS.map(w=><option key={w.n} value={w.n}>{w.label}</option>)}
        </select>
        {instr&&(
          <Badge color={instr.available?"green":"red"}>{instr.available?"Available":"Away"}</Badge>
        )}
        <div style={{flex:1}}/>
        <Btn variant="outline" onClick={downloadCSV}>↓ Export CSV</Btn>
      </div>
      {instr&&(
        <div style={{padding:"8px 14px",borderBottom:"1px solid var(--border)",flexShrink:0,
          display:"flex",alignItems:"center",gap:12,background:"var(--bg2)"}}>
          <div style={{width:32,height:32,borderRadius:"50%",
            background:PALETTE.find(p=>p.id===instr.colorId)?.bg||"var(--bg4)",
            border:`1px solid ${PALETTE.find(p=>p.id===instr.colorId)?.border||"var(--border)"}`,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:10,fontWeight:700,color:PALETTE.find(p=>p.id===instr.colorId)?.accent||"var(--muted)"}}>
            {initials(instr.name)}
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:600}}>{instr.name}</div>
            <div style={{fontSize:10,color:"var(--muted)"}}>{instr.dept} · {instr.email}</div>
          </div>
          <div style={{marginLeft:"auto",fontSize:10,color:"var(--muted)"}}>
            {Object.values(appointments).filter(a=>a.instructorId===selInstructor).length} total sessions · max {instr.maxLoad}/week
          </div>
        </div>
      )}
      <div style={{flex:1,overflowY:"auto",overflowX:"auto",padding:12,minHeight:0,WebkitOverflowScrolling:"touch"}}>
        <table style={{width:"100%",borderCollapse:"separate",borderSpacing:3}}>
          <thead>
            <tr>
              <th style={{width:80,textAlign:"left",padding:"6px 8px",fontSize:10,color:"var(--muted)",
                textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>Slot</th>
              {DAYS.map((d,di)=>(
                <th key={di} style={{textAlign:"left",padding:"6px 8px",fontSize:11,fontWeight:500}}>
                  <div>{d}</div>
                  <div style={{fontSize:9,color:"var(--muted)",fontFamily:"var(--mono)",fontWeight:400}}>
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
                  <div style={{fontSize:10,fontWeight:600,color:"var(--accent)",fontFamily:"var(--mono)"}}>{slot.short.toUpperCase()}</div>
                  <div style={{fontSize:9,color:"var(--muted2)"}}>{slot.label}</div>
                </td>
                {DAYS.map((_,di)=>{
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
                          justifyContent:"center",color:"var(--muted2)",fontSize:10,opacity:0.3}}>—</div>
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
function ConflictsTab({conflicts,state,onApptClick}) {
  const {instructors,rooms,courses}=state;
  if(!conflicts.length) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      height:"100%",gap:12}}>
      <div style={{fontSize:32}}>✓</div>
      <div style={{fontSize:14,fontWeight:600,color:"var(--accent)"}}>No conflicts detected</div>
      <div style={{fontSize:11,color:"var(--muted)"}}>Your schedule is clean and conflict-free</div>
    </div>
  );

  const grouped={instructor:[],room:[],group:[]};
  conflicts.forEach(c=>{ if(grouped[c.type]) grouped[c.type].push(c); });
  const typeLabel={instructor:"Instructor Conflicts",room:"Room Conflicts",group:"Group Conflicts"};
  const typeColor={instructor:"var(--danger)",room:"var(--warn)",group:"var(--accent2)"};

  return (
    <div style={{padding:16,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",height:"100%"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:700}}>Conflict Report</div>
        <Badge color="red">{conflicts.length} issue{conflicts.length!==1?"s":""}</Badge>
      </div>
      {Object.entries(grouped).filter(([,v])=>v.length).map(([type,items])=>(
        <div key={type} style={{marginBottom:16}}>
          <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",
            color:typeColor[type]||"var(--muted)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:typeColor[type],display:"inline-block"}}/>
            {typeLabel[type]} ({items.length})
          </div>
          {items.map((c,i)=>{
            const weekLabel=WEEKS.find(w=>w.n===c.a.weekNum)?.label||`Week ${c.a.weekNum}`;
            const dayLabel=DAYS_FULL[c.a.dayIdx];
            const slotLabel=c.a.timeId==="am"?"Morning":"Afternoon";
            return (
              <div key={i} style={{background:"var(--bg2)",border:`1px solid rgba(248,113,113,0.2)`,
                borderRadius:"var(--r2)",padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:10,color:"var(--muted)",marginBottom:6,fontFamily:"var(--mono)"}}>
                  {weekLabel} · {dayLabel} · {slotLabel}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {[c.a,c.b].map((appt,j)=>{
                    const pal=getPalette(appt.courseId,courses);
                    return (
                      <div key={j} onClick={()=>onApptClick(appt)}
                        style={{flex:1,minWidth:140,background:pal.bg,border:`1px solid ${pal.border}`,
                          borderRadius:"var(--r)",padding:"7px 10px",cursor:"pointer"}}>
                        <div style={{fontSize:9,fontFamily:"var(--mono)",color:pal.accent,fontWeight:600,marginBottom:2}}>
                          {appt.courseCode}
                        </div>
                        <div style={{fontSize:11,color:pal.accent}}>{appt.courseName}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CHANGELOG TAB
// ═══════════════════════════════════════════════════════════════════
function ChangelogTab({log}) {
  if(!log.length) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--muted2)",fontSize:12}}>
      No activity yet
    </div>
  );
  return (
    <div style={{padding:16,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",height:"100%"}}>
      <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>Activity Log</div>
      {[...log].reverse().map((e,i)=>(
        <div key={i} style={{display:"flex",gap:10,marginBottom:8,paddingBottom:8,
          borderBottom:"1px solid var(--border)"}}>
          <div style={{fontSize:9,color:"var(--muted2)",fontFamily:"var(--mono)",
            whiteSpace:"nowrap",paddingTop:1,minWidth:80}}>
            {new Date(e.at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}
          </div>
          <div style={{flex:1}}>
            <span style={{fontSize:10,fontWeight:500,color:"var(--text)"}}>{e.action}</span>
            {e.detail&&<span style={{fontSize:10,color:"var(--muted)"}}> — {e.detail}</span>}
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
  function removeHoliday(id) {
    setState(s=>({...s,holidays:s.holidays.filter(h=>h.id!==id)}));
  }

  function exportData() {
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="timetable-export.json";
    a.click();
  }
  function importData(e) {
    const file=e.target.files[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try {
        const data=JSON.parse(ev.target.result);
        setState(data);
        toast("Data imported successfully","ok");
      } catch { toast("Invalid file format","error"); }
    };
    reader.readAsText(file);
  }
  function resetData() {
    if(confirm("Reset all data to defaults? This cannot be undone.")) {
      setState(seed());
      toast("Data reset to defaults","warn");
    }
  }

  return (
    <div style={{padding:20,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",height:"100%",maxWidth:640}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:20}}>Settings</div>

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:16,marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
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
          <div style={{fontSize:11,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.08em"}}>
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
            <Btn variant="danger" size="xs" onClick={()=>removeSlot(s.id)}>✕</Btn>
          </div>
        ))}
      </div>

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:16,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Holidays</div>
          <Btn variant="outline" size="xs" onClick={addHoliday}>+ Add Holiday</Btn>
        </div>
        {state.holidays.map(h=>(
          <div key={h.id} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
            <input type="date" value={h.date} onChange={e=>updateHoliday(h.id,"date",e.target.value)} style={{width:140}}/>
            <input value={h.name} placeholder="Holiday name" onChange={e=>updateHoliday(h.id,"name",e.target.value)}/>
            <Btn variant="danger" size="xs" onClick={()=>removeHoliday(h.id)}>✕</Btn>
          </div>
        ))}
        {!state.holidays.length&&<div style={{fontSize:11,color:"var(--muted2)"}}>No holidays defined</div>}
      </div>

      <Btn variant="primary" onClick={save} style={{marginBottom:20}}>Save Settings</Btn>

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:16}}>
        <div style={{fontSize:11,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:12}}>Data Management</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Btn variant="outline" onClick={exportData}>↓ Export JSON</Btn>
          <label style={{cursor:"pointer"}}>
            <Btn variant="outline" as="span">↑ Import JSON</Btn>
            <input type="file" accept=".json" onChange={importData} style={{display:"none"}}/>
          </label>
          <Btn variant="danger" onClick={resetData}>⟳ Reset to Defaults</Btn>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  AUTO-SCHEDULE ENGINE
// ═══════════════════════════════════════════════════════════════════

// Returns true if a slot is free for an instructor on ALL specified weeks
function isInstructorFreeAllWeeks(appointments, instructorId, dayIdx, timeId, weeks) {
  return weeks.every(wn =>
    !Object.values(appointments).some(a =>
      a.weekNum===wn && a.dayIdx===dayIdx && a.timeId===timeId && a.instructorId===instructorId
    )
  );
}

// Returns true if ALL groupIds are free on ALL specified weeks
function areGroupsFreeAllWeeks(appointments, groupIds, dayIdx, timeId, weeks) {
  return weeks.every(wn =>
    !Object.values(appointments).some(a =>
      a.weekNum===wn && a.dayIdx===dayIdx && a.timeId===timeId &&
      (a.groupIds||[]).some(g => (groupIds||[]).includes(g))
    )
  );
}

// Returns first available room matching optional type filter
function findFreeRoom(appointments, rooms, dayIdx, timeId, weekNum, neededCapacity=0, preferType=null) {
  const sorted=[...rooms].sort((a,b)=>{
    const typeScore=(r)=>preferType&&r.type===preferType?-1:0;
    return typeScore(a)-typeScore(b) || a.capacity-b.capacity;
  });
  return sorted.find(r =>
    r.capacity>=neededCapacity &&
    !Object.values(appointments).some(a =>
      a.weekNum===weekNum && a.dayIdx===dayIdx && a.timeId===timeId && a.roomId===r.id
    )
  );
}

/**
 * runAutoSchedule: Core engine
 * jobs: array of { courseId, instructorId, groupIds, roomId?, weeks[], slotConstraints }
 * slotConstraints: array of { dayIdx, timeId } preferred slots (from instructor availability grid)
 * Returns { scheduled: [appt], skipped: [{ job, reason }] }
 */
function runAutoSchedule(state, jobs) {
  const { appointments, courses, rooms, instructors } = state;
  const working = { ...appointments }; // mutable copy for conflict tracking within run
  const scheduled = [];
  const skipped = [];

  for (const job of jobs) {
    const { courseId, instructorId, groupIds, preferredSlots, weeks, roomId, neededCapacity, preferRoomType } = job;
    const course = courses.find(c => c.id === courseId);
    if (!course) { skipped.push({ job, reason: "Course not found" }); continue; }

    // Try each preferred slot in order
    let placed = false;
    for (const { dayIdx, timeId } of preferredSlots) {
      // Check instructor free across ALL weeks
      const instrFree = !instructorId || isInstructorFreeAllWeeks(working, instructorId, dayIdx, timeId, weeks);
      if (!instrFree) continue;
      // Check all groups free across ALL weeks
      const grpFree = !(groupIds||[]).length || areGroupsFreeAllWeeks(working, groupIds, dayIdx, timeId, weeks);
      if (!grpFree) continue;

      // Find room for each week (may differ if roomId not locked)
      const weekAppts = [];
      let roomOk = true;
      for (const wn of weeks) {
        let rid = roomId;
        if (!rid) {
          // Estimate group size for capacity
          const grpSize = Math.max(neededCapacity || 0, 1);
          const room = findFreeRoom(working, rooms, dayIdx, timeId, wn, grpSize, preferRoomType);
          if (!room) { roomOk = false; break; }
          rid = room.id;
        } else {
          // Check locked room is free
          const roomBusy = Object.values(working).some(a =>
            a.weekNum===wn && a.dayIdx===dayIdx && a.timeId===timeId && a.roomId===rid
          );
          if (roomBusy) { roomOk = false; break; }
        }
        const id = uid();
        const appt = { id, weekNum:wn, dayIdx, timeId, courseId, courseName:course.name,
          courseCode:course.code, instructorId:instructorId||"", roomId:rid, groupIds:[...groupIds], notes:"" };
        weekAppts.push(appt);
        working[id] = appt; // lock into working copy
      }

      if (roomOk && weekAppts.length === weeks.length) {
        scheduled.push(...weekAppts);
        placed = true;
        break;
      } else {
        // Rollback this slot attempt
        weekAppts.forEach(a => delete working[a.id]);
      }
    }

    if (!placed) {
      skipped.push({ job, reason: "No conflict-free slot found for all selected weeks" });
    }
  }
  return { scheduled, skipped };
}

// ═══════════════════════════════════════════════════════════════════
//  AVAILABILITY GRID EDITOR
// Used inside InstructorEditor in Assets AND in AutoScheduleTab
// ═══════════════════════════════════════════════════════════════════
function AvailabilityGrid({ availability={}, onChange, slots, compact=false }) {
  function toggle(di, timeId) {
    const cur = availability[di] || [];
    const next = cur.includes(timeId) ? cur.filter(x=>x!==timeId) : [...cur, timeId];
    onChange({ ...availability, [di]: next });
  }
  function toggleDay(di) {
    const cur = availability[di] || [];
    const all = slots.map(s=>s.id);
    onChange({ ...availability, [di]: cur.length===all.length ? [] : [...all] });
  }
  function toggleSlot(timeId) {
    const next={};
    DAYS.forEach((_,di)=>{
      const cur=availability[di]||[];
      const allHave=DAYS.every((__,d)=>(availability[d]||[]).includes(timeId));
      next[di]=allHave?cur.filter(x=>x!==timeId):[...new Set([...cur,timeId])];
    });
    onChange(next);
  }

  return (
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"separate",borderSpacing:3,minWidth:compact?280:340}}>
        <thead>
          <tr>
            <th style={{width:compact?70:90,fontSize:9,color:"var(--muted)",fontWeight:600,
              textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"left",paddingBottom:4}}/>
            {DAYS.map((d,di)=>(
              <th key={di} style={{textAlign:"center",padding:"2px 4px"}}>
                <div onClick={()=>toggleDay(di)}
                  style={{fontSize:9,fontWeight:600,color:"var(--muted)",cursor:"pointer",
                    padding:"3px 6px",borderRadius:"var(--r)",
                    background:(availability[di]||[]).length===slots.length?"var(--bg4)":"transparent",
                    userSelect:"none"}}
                  title={`Toggle all ${DAYS_FULL[di]}`}>
                  {compact?d.slice(0,1):d}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map(slot=>(
            <tr key={slot.id}>
              <td style={{paddingRight:6}}>
                <div onClick={()=>toggleSlot(slot.id)}
                  style={{fontSize:9,color:"var(--muted)",cursor:"pointer",
                    fontFamily:"var(--mono)",userSelect:"none",whiteSpace:"nowrap"}}>
                  {compact?slot.short.slice(0,3):slot.short}
                </div>
              </td>
              {DAYS.map((_,di)=>{
                const on=(availability[di]||[]).includes(slot.id);
                return (
                  <td key={di} style={{textAlign:"center"}}>
                    <div onClick={()=>toggle(di,slot.id)}
                      style={{width:compact?24:30,height:compact?22:26,borderRadius:4,cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",
                        background:on?"rgba(5,150,105,0.15)":"var(--bg3)",
                        border:`1px solid ${on?"rgba(110,231,183,0.5)":"var(--border)"}`,
                        transition:"all 0.1s",userSelect:"none"}}>
                      {on&&<span style={{fontSize:8,color:"var(--accent)",fontWeight:700}}>✓</span>}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  AUTO-SCHEDULE TAB
// ═══════════════════════════════════════════════════════════════════
function AutoScheduleTab({ state, setState, toast }) {
  const { courses, instructors, groups, rooms, appointments, slots } = state;

  // ── Step state ──────────────────────────────────────────────────
  const [step, setStep] = useState(0); // 0=setup, 1=review, 2=done
  const STEPS = ["Configure Jobs", "Review & Confirm", "Results"];

  // ── Job builder state ────────────────────────────────────────────
  const blankJob = () => ({
    id: uid(), courseId:"", instructorId:"", groupIds:[], roomId:"",
    neededCapacity:0, preferRoomType:"",
    weeksMode:"all",  // "all" | "range" | "custom"
    weekStart:1, weekEnd:16, customWeeks:[],
    useInstructorAvailability:true,
    customSlots:[],   // [{dayIdx,timeId}] extra overrides
    _open:true,
  });
  const [jobs, setJobs] = useState([blankJob()]);
  const [result, setResult] = useState(null);  // {scheduled, skipped}
  const [running, setRunning] = useState(false);

  function updateJob(id, patch) {
    // Intercept instructor availability updates and forward to global state
    if(patch._instrAvailUpdate) {
      const {instrId,avail}=patch._instrAvailUpdate;
      setState(s=>({...s,
        instructors:s.instructors.map(i=>i.id===instrId?{...i,availability:avail}:i)
      }));
      const {_instrAvailUpdate,...rest}=patch;
      if(Object.keys(rest).length) setJobs(j=>j.map(job=>job.id===id?{...job,...rest}:job));
      return;
    }
    setJobs(j => j.map(job => job.id===id ? {...job,...patch} : job));
  }
  function addJob() { setJobs(j=>[...j, blankJob()]); }
  function removeJob(id) { setJobs(j=>j.filter(x=>x.id!==id)); }
  function toggleJob(id) { updateJob(id,{_open:!jobs.find(j=>j.id===id)?._open}); }

  // Derive weeks array for a job
  function getJobWeeks(job) {
    if(job.weeksMode==="all") return Array.from({length:16},(_,i)=>i+1);
    if(job.weeksMode==="range") {
      const arr=[];
      for(let w=job.weekStart;w<=job.weekEnd;w++) arr.push(w);
      return arr;
    }
    return job.customWeeks.length?job.customWeeks:Array.from({length:16},(_,i)=>i+1);
  }

  // Derive preferred slots for a job
  function getJobSlots(job) {
    const instr = instructors.find(i=>i.id===job.instructorId);
    const avail = instr?.availability || {};
    const instrSlots = [];
    if(job.useInstructorAvailability && instr) {
      DAYS.forEach((_,di)=>{
        (avail[di]||[]).forEach(timeId=>instrSlots.push({dayIdx:di,timeId}));
      });
    } else {
      // All slots if not using availability filter
      DAYS.forEach((_,di)=>slots.forEach(s=>instrSlots.push({dayIdx:di,timeId:s.id})));
    }
    // Merge custom slots (union)
    const extra = job.customSlots.filter(cs =>
      !instrSlots.some(s=>s.dayIdx===cs.dayIdx&&s.timeId===cs.timeId)
    );
    return [...instrSlots,...extra];
  }

  function buildPreview() {
    return jobs.map(job=>{
      const course=courses.find(c=>c.id===job.courseId);
      const instr=instructors.find(i=>i.id===job.instructorId);
      const weeks=getJobWeeks(job);
      const slots_=getJobSlots(job);
      return {job,course,instr,weeks,slots_};
    });
  }

  function handleRun() {
    setRunning(true);
    setTimeout(()=>{
      const engineJobs=jobs.map(job=>({
        ...job,
        weeks:getJobWeeks(job),
        preferredSlots:getJobSlots(job),
      }));
      const res=runAutoSchedule(state,engineJobs);
      setResult(res);
      setStep(2);
      setRunning(false);
    },400);
  }

  function handleCommit() {
    if(!result?.scheduled?.length) return;
    setState(s=>{
      const next={...s.appointments};
      result.scheduled.forEach(a=>{next[a.id]=a;});
      return {...s,
        appointments:next,
        changelog:[...s.changelog.slice(-199),{
          at:Date.now(),
          action:"Auto-scheduled",
          detail:`${result.scheduled.length} sessions across ${[...new Set(result.scheduled.map(a=>a.courseId))].length} course(s)`,
        }],
      };
    });
    toast(`${result.scheduled.length} sessions auto-scheduled!`,"ok");
    setStep(0);
    setJobs([blankJob()]);
    setResult(null);
  }

  // ── Render helpers ───────────────────────────────────────────────
  const preview=useMemo(()=>buildPreview(),[jobs,instructors,courses]);

  // Count conflict-free slots for a job (for preview badge)
  function countFeasible(job) {
    const weeks=getJobWeeks(job);
    const slts=getJobSlots(job);
    const instr=instructors.find(i=>i.id===job.instructorId);
    const grps=job.groupIds||[];
    return slts.filter(({dayIdx,timeId})=>{
      const instrOk=!instr||isInstructorFreeAllWeeks(appointments,instr.id,dayIdx,timeId,weeks);
      const grpOk=!grps.length||areGroupsFreeAllWeeks(appointments,grps,dayIdx,timeId,weeks);
      return instrOk&&grpOk;
    }).length;
  }

  // ── Step: Setup ──────────────────────────────────────────────────
  if(step===0) return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {/* Header */}
      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",flexShrink:0,
        display:"flex",alignItems:"center",gap:10}}>
        <div>
          <div style={{fontSize:14,fontWeight:700}}>Auto-Schedule</div>
          <div style={{fontSize:11,color:"var(--muted)",marginTop:1}}>
            Define scheduling jobs — the engine finds conflict-free slots automatically
          </div>
        </div>
        <div style={{flex:1}}/>
        <Btn variant="outline" onClick={addJob}>+ Add Job</Btn>
        <Btn variant="accent" onClick={()=>setStep(1)}
          disabled={jobs.every(j=>!j.courseId)}>
          Review →
        </Btn>
      </div>

      {/* Steps indicator */}
      <div style={{padding:"8px 16px",borderBottom:"1px solid var(--border)",flexShrink:0,
        display:"flex",gap:6,alignItems:"center"}}>
        {STEPS.map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",
              justifyContent:"center",fontSize:9,fontWeight:700,
              background:step===i?"var(--accent)":step>i?"rgba(5,150,105,0.15)":"var(--bg4)",
              color:step===i?"#ffffff":step>i?"var(--accent)":"var(--muted)"}}>
              {step>i?"✓":i+1}
            </div>
            <span style={{fontSize:10,color:step===i?"var(--text)":"var(--muted)",fontWeight:step===i?600:400}}>
              {s}
            </span>
            {i<STEPS.length-1&&<span style={{color:"var(--muted2)",fontSize:10}}>›</span>}
          </div>
        ))}
      </div>

      {/* Job list */}
      <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",padding:12,display:"flex",flexDirection:"column",gap:10}}>
        {jobs.map((job,ji)=>(
          <JobCard key={job.id} job={job} ji={ji}
            courses={courses} instructors={instructors} groups={groups}
            rooms={rooms} slots={slots} state={state}
            onUpdate={(patch)=>updateJob(job.id,patch)}
            onRemove={()=>removeJob(job.id)}
            onToggle={()=>toggleJob(job.id)}
            feasible={job.courseId?countFeasible(job):null}
            appointments={appointments}
          />
        ))}
        <button onClick={addJob}
          style={{border:"1px dashed var(--border2)",borderRadius:"var(--r2)",padding:"14px",
            background:"transparent",color:"var(--muted)",fontSize:11,cursor:"pointer",
            fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          + Add Another Scheduling Job
        </button>
      </div>
    </div>
  );

  // ── Step: Review ─────────────────────────────────────────────────
  if(step===1) return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",flexShrink:0,
        display:"flex",alignItems:"center",gap:10}}>
        <Btn variant="outline" onClick={()=>setStep(0)}>← Back</Btn>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:700}}>Review Jobs</div>
          <div style={{fontSize:11,color:"var(--muted)"}}>Confirm before running the scheduler</div>
        </div>
        <Btn variant="primary" onClick={handleRun} disabled={running}
          style={{minWidth:120,justifyContent:"center"}}>
          {running?<span style={{animation:"pulse 1s infinite"}}>Running…</span>:"⚡ Run Scheduler"}
        </Btn>
      </div>
      <div style={{flex:1,overflowY:"auto",minHeight:0,WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",padding:16,display:"flex",flexDirection:"column",gap:10}}>
        {preview.map(({job,course,instr,weeks,slots_},i)=>{
          if(!course) return null;
          const pal=PALETTE.find(p=>p.id===course.colorId)||PALETTE[0];
          const grpNames=(job.groupIds||[]).map(g=>groups.find(x=>x.id===g)?.name).filter(Boolean);
          const feasible=countFeasible(job);
          return (
            <div key={job.id} style={{background:"var(--bg2)",border:`1px solid ${pal.border}`,
              borderRadius:"var(--r2)",padding:"14px 16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:pal.accent}}/>
                <span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:700,color:pal.accent}}>{course.code}</span>
                <span style={{fontSize:12,fontWeight:600}}>{course.name}</span>
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  <Badge color={feasible>0?"green":"red"}>{feasible} feasible slot{feasible!==1?"s":""}</Badge>
                  <Badge color="muted">{weeks.length} week{weeks.length!==1?"s":""}</Badge>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:6}}>
                {[
                  ["Instructor", instr?.name||"—"],
                  ["Groups", grpNames.join(", ")||"—"],
                  ["Preferred slots", slots_.length+" options"],
                  ["Weeks", weeks.length===16?"All 16":weeks.length===1?`Week ${weeks[0]}`:`W${weeks[0]}–W${weeks[weeks.length-1]}`],
                ].map(([k,v])=>(
                  <div key={k} style={{background:"var(--bg3)",borderRadius:"var(--r)",padding:"7px 10px"}}>
                    <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",
                      letterSpacing:"0.08em",fontWeight:600,marginBottom:2}}>{k}</div>
                    <div style={{fontSize:11,color:"var(--text)",fontWeight:500}}>{v}</div>
                  </div>
                ))}
              </div>
              {/* Slot preview */}
              {slots_.length>0&&(
                <div style={{marginTop:10}}>
                  <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",
                    letterSpacing:"0.08em",fontWeight:600,marginBottom:6}}>Preferred Slots</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {slots_.slice(0,20).map((s,si)=>(
                      <span key={si} style={{fontSize:9,fontFamily:"var(--mono)",
                        padding:"2px 7px",borderRadius:99,
                        background:"var(--bg4)",color:"var(--muted)",
                        border:"1px solid var(--border)"}}>
                        {DAYS[s.dayIdx]} {s.timeId.toUpperCase()}
                      </span>
                    ))}
                    {slots_.length>20&&<span style={{fontSize:9,color:"var(--muted2)"}}>+{slots_.length-20} more</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Step: Results ─────────────────────────────────────────────────
  if(step===2) return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",flexShrink:0,
        display:"flex",alignItems:"center",gap:10}}>
        <Btn variant="outline" onClick={()=>{setStep(0);setResult(null);}}>← Start Over</Btn>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:700}}>Scheduler Results</div>
          <div style={{fontSize:11,color:"var(--muted)"}}>
            {result?.scheduled?.length||0} sessions ready · {result?.skipped?.length||0} skipped
          </div>
        </div>
        {result?.scheduled?.length>0&&(
          <Btn variant="primary" onClick={handleCommit} style={{minWidth:130,justifyContent:"center"}}>
            ✓ Commit to Schedule
          </Btn>
        )}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16,minHeight:0,WebkitOverflowScrolling:"touch"}}>
        {/* Summary */}
        <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
          {[
            {label:"Scheduled",value:result?.scheduled?.length||0,color:"green"},
            {label:"Skipped",value:result?.skipped?.length||0,color:result?.skipped?.length?"red":"muted"},
            {label:"Unique Courses",value:[...new Set((result?.scheduled||[]).map(a=>a.courseId))].length,color:"muted"},
            {label:"Weeks Covered",value:[...new Set((result?.scheduled||[]).map(a=>a.weekNum))].length,color:"muted"},
          ].map(({label,value,color})=>(
            <div key={label} style={{background:"var(--bg2)",border:"1px solid var(--border)",
              borderRadius:"var(--r2)",padding:"12px 16px",flex:1,minWidth:100}}>
              <div style={{fontSize:9,color:"var(--muted)",textTransform:"uppercase",
                letterSpacing:"0.08em",fontWeight:600,marginBottom:4}}>{label}</div>
              <div style={{fontSize:22,fontWeight:700,fontFamily:"var(--mono)",
                color:color==="green"?"var(--accent)":color==="red"?"var(--danger)":"var(--text)"}}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Scheduled sessions grouped by course */}
        {result?.scheduled?.length>0&&(
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
              letterSpacing:"0.08em",color:"var(--accent)",marginBottom:10}}>
              ✓ Sessions to be Added
            </div>
            {Object.entries(
              (result.scheduled||[]).reduce((acc,a)=>{
                if(!acc[a.courseId]) acc[a.courseId]=[];
                acc[a.courseId].push(a); return acc;
              },{})
            ).map(([courseId,appts])=>{
              const course=courses.find(c=>c.id===courseId);
              const pal=PALETTE.find(p=>p.id===course?.colorId)||PALETTE[0];
              return (
                <div key={courseId} style={{background:"var(--bg2)",border:`1px solid ${pal.border}`,
                  borderRadius:"var(--r2)",padding:"12px 14px",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:pal.accent}}/>
                    <span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:700,color:pal.accent}}>{course?.code}</span>
                    <span style={{fontSize:12,fontWeight:600}}>{course?.name}</span>
                    <Badge color="green" style={{marginLeft:"auto"}}>{appts.length} session{appts.length!==1?"s":""}</Badge>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {appts.sort((a,b)=>a.weekNum-b.weekNum||a.dayIdx-b.dayIdx).map(a=>{
                      const room=rooms.find(r=>r.id===a.roomId);
                      return (
                        <div key={a.id} style={{fontSize:9,fontFamily:"var(--mono)",
                          padding:"3px 8px",borderRadius:4,background:"var(--bg3)",
                          border:"1px solid var(--border)",color:"var(--muted)"}}>
                          W{a.weekNum} {DAYS[a.dayIdx]} {a.timeId.toUpperCase()}
                          {room?` · ${room.name}`:""}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Skipped */}
        {result?.skipped?.length>0&&(
          <div>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
              letterSpacing:"0.08em",color:"var(--danger)",marginBottom:10}}>
              ✗ Skipped Jobs
            </div>
            {result.skipped.map(({job,reason},i)=>{
              const course=courses.find(c=>c.id===job.courseId);
              const pal=PALETTE.find(p=>p.id===course?.colorId)||PALETTE[0];
              return (
                <div key={i} style={{background:"rgba(248,113,113,0.06)",
                  border:"1px solid rgba(248,113,113,0.2)",borderRadius:"var(--r2)",
                  padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,fontWeight:500,color:"var(--text)"}}>
                      {course?.name||"Unknown course"}
                    </div>
                    <div style={{fontSize:10,color:"var(--danger)",marginTop:2}}>{reason}</div>
                  </div>
                  <Badge color="red">Skipped</Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Job Card (single scheduling job editor) ───────────────────────
function JobCard({ job, ji, courses, instructors, groups, rooms, slots, state, onUpdate, onRemove, onToggle, feasible, appointments }) {
  const course=courses.find(c=>c.id===job.courseId);
  const instr=instructors.find(i=>i.id===job.instructorId);
  const pal=course?PALETTE.find(p=>p.id===course.colorId)||PALETTE[0]:null;

  // When course changes, auto-fill instructor and groups from defaults
  function handleCourseChange(courseId) {
    const c=courses.find(x=>x.id===courseId);
    onUpdate({
      courseId,
      instructorId:c?.defaultInstructorId||"",
      groupIds:c?.defaultGroupIds||[],
    });
  }

  // Custom weeks multi-select
  const allWeeks=Array.from({length:16},(_,i)=>i+1);

  // Compute which slots are free right now (for the availability grid highlight)
  const weeks_=useMemo(()=>{
    if(job.weeksMode==="all") return allWeeks;
    if(job.weeksMode==="range"){const a=[];for(let w=job.weekStart;w<=job.weekEnd;w++)a.push(w);return a;}
    return job.customWeeks.length?job.customWeeks:allWeeks;
  },[job.weeksMode,job.weekStart,job.weekEnd,job.customWeeks]);

  // Slot conflict matrix: for each {dayIdx,timeId}, is it free?
  const slotMatrix=useMemo(()=>{
    const m={};
    DAYS.forEach((_,di)=>{
      slots.forEach(s=>{
        const instrOk=!instr||isInstructorFreeAllWeeks(appointments,instr.id,di,s.id,weeks_);
        const grpOk=!(job.groupIds||[]).length||areGroupsFreeAllWeeks(appointments,job.groupIds,di,s.id,weeks_);
        m[`${di}_${s.id}`]={instrOk,grpOk,free:instrOk&&grpOk};
      });
    });
    return m;
  },[instr,job.groupIds,appointments,weeks_,slots]);

  return (
    <div style={{background:"var(--bg2)",border:`1px solid ${pal?pal.border:"var(--border2)"}`,
      borderRadius:"var(--r2)",overflow:"hidden"}}>
      {/* Header row */}
      <div onClick={onToggle}
        style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,
          borderBottom:job._open?"1px solid var(--border)":"none",
          background:job._open?"var(--bg3)":"transparent"}}>
        <span style={{fontSize:11,fontWeight:700,color:"var(--muted2)",fontFamily:"var(--mono)",width:18}}>
          {ji+1}.
        </span>
        {pal&&<span style={{width:7,height:7,borderRadius:"50%",background:pal.accent,flexShrink:0}}/>}
        <span style={{fontSize:12,fontWeight:600,flex:1,color:"var(--text)"}}>
          {course?`[${course.code}] ${course.name}`:"New Job — select a course"}
        </span>
        {feasible!==null&&(
          <Badge color={feasible>0?"green":"red"}>{feasible} slot{feasible!==1?"s":""}</Badge>
        )}
        <Btn variant="ghost" size="xs" onClick={e=>{e.stopPropagation();onRemove();}}
          style={{color:"var(--muted2)"}}>✕</Btn>
        <span style={{color:"var(--muted2)",fontSize:10}}>{job._open?"▲":"▼"}</span>
      </div>

      {!job._open&&<div style={{height:4}}/>}

      {job._open&&(
        <div style={{padding:"14px 14px 16px"}}>
          {/* Course */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <Field label="Course" required>
              <select value={job.courseId} onChange={e=>handleCourseChange(e.target.value)}>
                <option value="">— Select course —</option>
                {courses.map(c=><option key={c.id} value={c.id}>[{c.code}] {c.name}</option>)}
              </select>
            </Field>
            <Field label="Instructor">
              <select value={job.instructorId} onChange={e=>onUpdate({instructorId:e.target.value})}>
                <option value="">— None —</option>
                {instructors.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
          </div>

          {/* Groups */}
          <Field label="Student Groups" hint="Scheduler checks these groups have no clashes">
            <MultiSelect
              options={groups.map(g=>({value:g.id,label:g.name}))}
              value={job.groupIds}
              onChange={v=>onUpdate({groupIds:v})}
              placeholder="Select groups to check availability..."/>
          </Field>

          {/* Room */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <Field label="Lock Room (optional)" hint="Leave blank for auto-assign">
              <select value={job.roomId} onChange={e=>onUpdate({roomId:e.target.value})}>
                <option value="">— Auto-assign —</option>
                {rooms.map(r=><option key={r.id} value={r.id}>{r.name} ({r.capacity})</option>)}
              </select>
            </Field>
            <Field label="Prefer Room Type">
              <select value={job.preferRoomType} onChange={e=>onUpdate({preferRoomType:e.target.value})}>
                <option value="">— Any —</option>
                {["lecture","seminar","lab","studio","online"].map(t=><option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          {/* Weeks */}
          <Field label="Weeks to Schedule">
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              {[["all","All 16 Weeks"],["range","Date Range"],["custom","Pick Weeks"]].map(([v,l])=>(
                <Btn key={v} variant={job.weeksMode===v?"accent":"outline"} size="xs"
                  onClick={()=>onUpdate({weeksMode:v})}>
                  {l}
                </Btn>
              ))}
            </div>
            {job.weeksMode==="range"&&(
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <select value={job.weekStart} onChange={e=>onUpdate({weekStart:+e.target.value})} style={{width:110}}>
                  {allWeeks.map(w=><option key={w} value={w}>Week {w}</option>)}
                </select>
                <span style={{color:"var(--muted)",fontSize:11}}>to</span>
                <select value={job.weekEnd} onChange={e=>onUpdate({weekEnd:+e.target.value})} style={{width:110}}>
                  {allWeeks.filter(w=>w>=job.weekStart).map(w=><option key={w} value={w}>Week {w}</option>)}
                </select>
              </div>
            )}
            {job.weeksMode==="custom"&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {allWeeks.map(w=>{
                  const on=job.customWeeks.includes(w);
                  return (
                    <button key={w} onClick={()=>onUpdate({customWeeks:on?job.customWeeks.filter(x=>x!==w):[...job.customWeeks,w].sort((a,b)=>a-b)})}
                      style={{width:36,height:28,borderRadius:"var(--r)",fontSize:10,
                        fontFamily:"var(--mono)",cursor:"pointer",border:"none",fontWeight:500,
                        background:on?"rgba(5,150,105,0.15)":"var(--bg4)",
                        color:on?"var(--accent)":"var(--muted)",
                        outline:on?"1px solid rgba(110,231,183,0.4)":"none"}}>
                      W{w}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {/* Availability section */}
          <div style={{marginTop:4}}>
            <div style={{fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
              letterSpacing:"0.08em",marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
              Slot Availability
              {instr&&(
                <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",
                  fontWeight:400,textTransform:"none",letterSpacing:"normal",color:"var(--text)"}}>
                  <input type="checkbox" checked={job.useInstructorAvailability}
                    onChange={e=>onUpdate({useInstructorAvailability:e.target.checked})}/>
                  Use {instr.name.split(" ").slice(-1)[0]}'s availability
                </label>
              )}
            </div>

            {/* Slot conflict matrix */}
            <div style={{background:"var(--bg3)",borderRadius:"var(--r)",padding:10,
              border:"1px solid var(--border)",marginBottom:8}}>
              <div style={{fontSize:9,color:"var(--muted)",marginBottom:6}}>
                Slot availability across weeks {weeks_.length===16?"1–16":`(${weeks_.length} selected)`} · 
                green = free for instructor + groups · red = conflict
              </div>
              <table style={{borderCollapse:"separate",borderSpacing:3,width:"100%"}}>
                <thead>
                  <tr>
                    <th style={{width:70,textAlign:"left",fontSize:9,color:"var(--muted2)",fontWeight:400}}/>
                    {DAYS.map((d,di)=>(
                      <th key={di} style={{textAlign:"center",fontSize:9,color:"var(--muted)",fontWeight:600,paddingBottom:4}}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map(slot=>(
                    <tr key={slot.id}>
                      <td style={{fontSize:9,color:"var(--muted)",fontFamily:"var(--mono)",paddingRight:6}}>
                        {slot.short}
                      </td>
                      {DAYS.map((_,di)=>{
                        const key=`${di}_${slot.id}`;
                        const info=slotMatrix[key]||{free:true,instrOk:true,grpOk:true};
                        const instrAvail=instr?(instr.availability?.[di]||[]).includes(slot.id):true;
                        const used=job.useInstructorAvailability&&instr&&!instrAvail;
                        return (
                          <td key={di} style={{textAlign:"center"}}>
                            <div title={
                              used?"Not in instructor availability":
                              !info.instrOk?"Instructor has class":
                              !info.grpOk?"Group has class":"Available"
                            } style={{width:28,height:22,borderRadius:4,margin:"0 auto",
                              display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,
                              background:used?"var(--bg4)":info.free?"rgba(5,150,105,0.10)":"rgba(248,113,113,0.12)",
                              border:`1px solid ${used?"var(--border)":info.free?"rgba(5,150,105,0.30)":"rgba(248,113,113,0.3)"}`,
                              color:used?"var(--muted2)":info.free?"var(--accent)":"var(--danger)"}}>
                              {used?"—":info.free?"✓":(!info.instrOk&&!info.grpOk?"✗I+G":!info.instrOk?"✗I":"✗G")}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{display:"flex",gap:12,marginTop:8,fontSize:9,color:"var(--muted)"}}>
                <span>✓ Free &nbsp;</span>
                <span style={{color:"var(--danger)"}}>✗I Instructor busy &nbsp;</span>
                <span style={{color:"var(--danger)"}}>✗G Group busy &nbsp;</span>
                <span>— Not available</span>
              </div>
            </div>

            {/* Instructor availability editor shortcut */}
            {instr&&(
              <div style={{background:"var(--bg3)",borderRadius:"var(--r)",padding:10,
                border:"1px solid var(--border)"}}>
                <div style={{fontSize:9,color:"var(--muted)",fontWeight:600,
                  textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,
                  display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span>{instr.name} — Weekly Availability</span>
                  <span style={{fontWeight:400,textTransform:"none",letterSpacing:"normal",
                    color:"var(--muted2)"}}>Click to edit · used by scheduler</span>
                </div>
                <AvailabilityGrid
                  availability={instr.availability||{}}
                  onChange={(avail)=>{
                    // Update the instructor availability in global state
                    // We receive setState via props in AutoScheduleTab, pass it up via onUpdate
                    onUpdate({_instrAvailUpdate:{instrId:instr.id,avail}});
                  }}
                  slots={slots}
                  compact={true}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  COLLABORATION HOOK
// ═══════════════════════════════════════════════════════════════════
function useCollaboration(localState, setLocalState, toast) {
  const [session, setSession] = useState(null);
  const [presence, setPresence] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const pollRef = useRef(null);
  const presencePollRef = useRef(null);
  const lastHashRef = useRef(null);
  const sessionRef = useRef(null);

  function hashState(s) {
    const str = JSON.stringify({a:Object.keys(s.appointments||{}).sort().join(","),c:(s.courses||[]).map(x=>x.id).join(",")});
    let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h)+str.charCodeAt(i); return h;
  }

  async function joinRoom(code, userName, isOwner) {
    const colorIdx = Math.floor(Math.random()*USER_COLORS.length);
    const sess = { roomCode:code, userId:uid(), userName, userColor:userColor(colorIdx), isOwner };
    setSession(sess); sessionRef.current=sess;
    if (!isOwner) {
      setSyncing(true);
      const remote = await colLoad(code);
      if (remote) { const clean=sanitizeState(remote); setLocalState(clean); saveLocal(clean); lastHashRef.current=hashState(clean); }
      setSyncing(false);
    } else {
      const safeLocalState=sanitizeState(localState)||localState; await colSave(code, safeLocalState); lastHashRef.current=hashState(safeLocalState);
    }
    await _updatePresence(sess, "schedule");
    _startPolling(sess);
    return sess;
  }

  async function leaveRoom() {
    const sess=sessionRef.current; if(!sess) return;
    clearInterval(pollRef.current); clearInterval(presencePollRef.current);
    try { const p=await colGetPresence(sess.roomCode); delete p[sess.userId]; await colSetPresence(sess.roomCode,p); } catch {}
    setSession(null); sessionRef.current=null; setPresence({});
  }

  async function _updatePresence(sess, tab) {
    if(!sess?.roomCode) return;
    try { const p=await colGetPresence(sess.roomCode); p[sess.userId]={name:sess.userName,color:sess.userColor,tab,at:Date.now()}; await colSetPresence(sess.roomCode,p); } catch {}
  }

  async function pushState(newState, opType, opDetail) {
    const sess=sessionRef.current; if(!sess) return;
    setSyncing(true);
    try {
      await colSave(sess.roomCode, newState); lastHashRef.current=hashState(newState);
      await colPushOp(sess.roomCode, {id:uid(),userId:sess.userId,userName:sess.userName,at:Date.now(),type:opType||"update",detail:opDetail||""});
    } catch {}
    setSyncing(false); setLastSyncAt(Date.now());
  }

  function _startPolling(sess) {
    clearInterval(pollRef.current); clearInterval(presencePollRef.current);
    pollRef.current = setInterval(async () => {
      const s=sessionRef.current; if(!s) return;
      try {
        const remote=await colLoad(s.roomCode); if(!remote) return;
        const rh=hashState(remote);
        if(rh!==lastHashRef.current) {
          lastHashRef.current=rh;
          setLocalState(prev=>{ const raw={...remote,appointments:{...(prev.appointments||{}),...(remote.appointments||{})}}; const merged=sanitizeState(raw); saveLocal(merged); return merged; });
          setLastSyncAt(Date.now());
          toast("Schedule updated by collaborator","info");
        }
      } catch {}
    }, 2500);
    presencePollRef.current = setInterval(async () => {
      const s=sessionRef.current; if(!s) return;
      try {
        const p=await colGetPresence(s.roomCode);
        const now=Date.now();
        Object.keys(p).forEach(k=>{ if(now-p[k].at>20000) delete p[k]; });
        setPresence({...p});
        await _updatePresence(s,"active");
      } catch {}
    }, 4000);
  }

  useEffect(()=>()=>{ clearInterval(pollRef.current); clearInterval(presencePollRef.current); },[]);
  return { session, presence, syncing, lastSyncAt, joinRoom, leaveRoom, pushState };
}

// ═══════════════════════════════════════════════════════════════════
//  COLLAB MODAL
// ═══════════════════════════════════════════════════════════════════
function CollabModal({ onJoin, onClose, defaultName }) {
  const [mode, setMode] = useState("pick");
  const [roomName, setRoomName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [userName, setUserName] = useState(auth.currentUser?.displayName||defaultName||"");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [knownRooms, setKnownRooms] = useState([]);
  useEffect(()=>{ listRooms().then(r=>setKnownRooms(r.slice(-5).reverse())); },[]);

  async function handleCreate() {
    if(!userName.trim()){setError("Enter your name");return;}
    if(!roomName.trim()){setError("Enter a room name");return;}
    setLoading(true); setError("");
    const code=genRoomCode();
    await registerRoom(code,roomName.trim(),auth.currentUser?.uid||"anonymous");
    await onJoin(code,userName.trim(),true);
    setLoading(false);
  }
  async function handleJoin() {
    if(!userName.trim()){setError("Enter your name");return;}
    const code=joinCode.trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
    if(code.length!==6){setError("Room code must be 6 characters");return;}
    setLoading(true); setError("");
    const remote=await colLoad(code);
    if(!remote){setError("Room not found — check the code and try again");setLoading(false);return;}
    await onJoin(code,userName.trim(),false);
    setLoading(false);
  }

  return (
    <Modal title="Collaborate" subtitle="Real-time shared timetable editing" onClose={onClose} width={460}>
      <div style={{padding:20}}>
        <Field label="Your Display Name" required>
          <input value={userName} onChange={e=>setUserName(e.target.value)} placeholder="e.g. Dr. Alice Chen" autoFocus/>
        </Field>

        {mode==="pick"&&(
          <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:4}}>
            <button onClick={()=>setMode("create")}
              style={{background:"rgba(5,150,105,0.08)",border:"1px solid rgba(110,231,183,0.25)",
                borderRadius:"var(--r2)",padding:"14px 16px",cursor:"pointer",textAlign:"left",color:"var(--text)",fontFamily:"inherit"}}>
              <div style={{fontSize:13,fontWeight:600,color:"var(--accent)",marginBottom:3}}>⊕ Create a Room</div>
              <div style={{fontSize:11,color:"var(--muted)"}}>Start a new session · share the code with your team</div>
            </button>
            <button onClick={()=>setMode("join")}
              style={{background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.25)",
                borderRadius:"var(--r2)",padding:"14px 16px",cursor:"pointer",textAlign:"left",color:"var(--text)",fontFamily:"inherit"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#60a5fa",marginBottom:3}}>→ Join a Room</div>
              <div style={{fontSize:11,color:"var(--muted)"}}>Enter a 6-character room code to join a session</div>
            </button>
            {knownRooms.length>0&&(
              <div style={{marginTop:4}}>
                <div style={{fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Recent Rooms</div>
                {knownRooms.map(r=>(
                  <div key={r.code} onClick={()=>{setJoinCode(r.code);setMode("join");}}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:"var(--r)",
                      border:"1px solid var(--border)",marginBottom:5,cursor:"pointer",background:"var(--bg3)"}}>
                    <span style={{fontSize:11,fontFamily:"var(--mono)",fontWeight:700,color:"var(--accent)",letterSpacing:"0.1em"}}>{r.code}</span>
                    <span style={{fontSize:11,color:"var(--text)",flex:1}}>{r.name}</span>
                    <span style={{fontSize:9,color:"var(--muted2)"}}>{new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode==="create"&&(
          <div style={{marginTop:4}}>
            <Field label="Room Name" required>
              <input value={roomName} onChange={e=>setRoomName(e.target.value)}
                placeholder="e.g. CS Dept — Semester 1 2026" onKeyDown={e=>e.key==="Enter"&&handleCreate()}/>
            </Field>
            {error&&<div style={{color:"var(--danger)",fontSize:11,marginBottom:10}}>{error}</div>}
            <div style={{display:"flex",gap:8}}>
              <Btn variant="outline" onClick={()=>setMode("pick")}>← Back</Btn>
              <Btn variant="primary" onClick={handleCreate} disabled={loading} style={{flex:1,justifyContent:"center"}}>
                {loading?"Creating…":"Create Room"}
              </Btn>
            </div>
          </div>
        )}

        {mode==="join"&&(
          <div style={{marginTop:4}}>
            <Field label="Room Code" required>
              <input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""))}
                placeholder="XXXXXX" maxLength={6}
                style={{fontFamily:"var(--mono)",fontSize:18,letterSpacing:"0.3em",textAlign:"center"}}
                onKeyDown={e=>e.key==="Enter"&&handleJoin()}/>
            </Field>
            {error&&<div style={{color:"var(--danger)",fontSize:11,marginBottom:10}}>{error}</div>}
            <div style={{display:"flex",gap:8}}>
              <Btn variant="outline" onClick={()=>setMode("pick")}>← Back</Btn>
              <Btn variant="primary" onClick={handleJoin} disabled={loading} style={{flex:1,justifyContent:"center"}}>
                {loading?"Joining…":"Join Room"}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PRESENCE BAR
// ═══════════════════════════════════════════════════════════════════
function PresenceBar({ session, presence, syncing, lastSyncAt, onLeave, onCopyCode }) {
  const [copied, setCopied] = useState(false);
  const [ago, setAgo] = useState("");
  useEffect(()=>{
    const t=setInterval(()=>{
      if(lastSyncAt) setAgo(Math.round((Date.now()-lastSyncAt)/1000)+"s ago");
    },1000);
    return ()=>clearInterval(t);
  },[lastSyncAt]);

  function copy() {
    navigator.clipboard?.writeText(session.roomCode).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false),1800);
    onCopyCode?.();
  }

  const others=Object.entries(presence).filter(([id])=>id!==session.userId);

  return (
    <div style={{height:36,display:"flex",alignItems:"center",gap:10,padding:"0 14px",flexShrink:0,
      background:"rgba(5,150,105,0.05)",borderBottom:"1px solid rgba(110,231,183,0.12)"}}>
      {/* Room pill */}
      <button onClick={copy}
        style={{display:"flex",alignItems:"center",gap:6,background:"rgba(5,150,105,0.08)",
          border:"1px solid rgba(110,231,183,0.25)",borderRadius:99,padding:"3px 10px",
          cursor:"pointer",fontFamily:"var(--mono)",fontSize:11,fontWeight:700,
          color:"var(--accent)",letterSpacing:"0.1em"}}>
        {session.roomCode}
        <span style={{fontSize:8,fontFamily:"'Outfit',sans-serif",fontWeight:400,
          color:copied?"var(--accent)":"var(--muted)",letterSpacing:"normal"}}>
          {copied?"✓ copied":"copy"}
        </span>
      </button>

      {/* Avatars */}
      <div style={{display:"flex",alignItems:"center"}}>
        <div title={session.userName+" (you)"}
          style={{width:22,height:22,borderRadius:"50%",background:session.userColor+"22",
            border:"2px solid "+session.userColor,display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:8,fontWeight:700,color:session.userColor,
            zIndex:20,marginRight:others.length?-5:0}}>
          {initials(session.userName)}
        </div>
        {others.slice(0,7).map(([id,p],i)=>(
          <div key={id} title={p.name}
            style={{width:22,height:22,borderRadius:"50%",background:p.color+"22",
              border:"2px solid "+p.color,display:"flex",alignItems:"center",
              justifyContent:"center",fontSize:8,fontWeight:700,color:p.color,
              zIndex:19-i,marginRight:i<Math.min(others.length-1,6)?-5:0}}>
            {initials(p.name)}
          </div>
        ))}
        {others.length>7&&(
          <div style={{width:22,height:22,borderRadius:"50%",background:"var(--bg4)",
            border:"1px solid var(--border2)",display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:8,color:"var(--muted)",marginLeft:3}}>
            +{others.length-7}
          </div>
        )}
      </div>

      <span style={{fontSize:10,color:"var(--muted)"}}>
        {Object.keys(presence).length<=1?"Just you":`${Object.keys(presence).length} online`}
      </span>

      <div style={{flex:1}}/>

      {syncing&&(
        <div style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:"var(--accent)"}}>
          <span style={{width:5,height:5,borderRadius:"50%",background:"var(--accent)",animation:"pulse 0.7s infinite"}}/>
          Syncing
        </div>
      )}
      {!syncing&&lastSyncAt&&(
        <span style={{fontSize:9,color:"var(--muted2)"}}>✓ {ago}</span>
      )}

      <Btn variant="danger" size="xs" onClick={onLeave} style={{marginLeft:4}}>Leave</Btn>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  LIVE ACTIVITY FEED (ops log viewer)
// ═══════════════════════════════════════════════════════════════════
function ActivityFeed({ roomCode, presence, selfId }) {
  const [ops, setOps] = useState([]);
  useEffect(()=>{
    if(!roomCode) return;
    colGetOps(roomCode).then(setOps);
    const t=setInterval(()=>colGetOps(roomCode).then(setOps),3000);
    return ()=>clearInterval(t);
  },[roomCode]);

  const recent=[...ops].reverse().slice(0,30);
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",flexShrink:0}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>Live Activity</div>
        <div style={{fontSize:11,color:"var(--muted)"}}>Real-time log of all changes in this room</div>
      </div>

      {/* Who's online */}
      <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",flexShrink:0}}>
        <div style={{fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:8}}>Online Now</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {Object.entries(presence).map(([id,p])=>(
            <div key={id} style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0,
                boxShadow:"0 0 6px "+p.color}}/>
              <span style={{fontSize:11,color:"var(--text)",fontWeight:id===selfId?600:400}}>
                {p.name}{id===selfId?" (you)":""}
              </span>
              <span style={{fontSize:9,color:"var(--muted2)",marginLeft:"auto"}}>
                {Math.round((Date.now()-p.at)/1000)}s ago
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Ops */}
      <div style={{flex:1,overflowY:"auto",padding:14,minHeight:0,WebkitOverflowScrolling:"touch"}}>
        <div style={{fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:10}}>Recent Changes</div>
        {recent.length===0&&(
          <div style={{color:"var(--muted2)",fontSize:11,textAlign:"center",paddingTop:20}}>
            No activity yet
          </div>
        )}
        {recent.map((op,i)=>{
          const isMe=op.userId===selfId;
          return (
            <div key={op.id||i} style={{display:"flex",gap:8,marginBottom:10,alignItems:"flex-start"}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:isMe?"var(--accent)":"var(--muted)",
                flexShrink:0,marginTop:4}}/>
              <div style={{flex:1}}>
                <span style={{fontSize:11,fontWeight:600,color:isMe?"var(--accent)":"var(--text)"}}>
                  {op.userName||"Someone"}
                </span>
                <span style={{fontSize:11,color:"var(--muted)"}}> {op.type||"made a change"}</span>
                {op.detail&&<div style={{fontSize:10,color:"var(--muted2)",marginTop:1}}>{op.detail}</div>}
                <div style={{fontSize:9,color:"var(--muted2)",marginTop:2,fontFamily:"var(--mono)"}}>
                  {new Date(op.at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  ROOT APP

// ═══════════════════════════════════════════════════════════════════
//  AUTH HOOK
// ═══════════════════════════════════════════════════════════════════
function useAuth() {
  const [user, setUser]       = useState(undefined); // undefined = loading
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthChange(u => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { user, loading };
}

// ═══════════════════════════════════════════════════════════════════
//  LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════
function LoginScreen({ onSkip }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  async function handleGoogle() {
    setLoading(true); setError("");
    try {
      await signInWithGoogle();
    } catch(e) {
      setError(e.message || "Sign-in failed. Check your Firebase config.");
    }
    setLoading(false);
  }

  return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"var(--bg)",fontFamily:"'Outfit',sans-serif"}}>
      <div style={{width:380,padding:36,background:"var(--bg2)",borderRadius:"var(--r3)",
        border:"1px solid var(--border2)",boxShadow:"var(--shadow)",textAlign:"center"}}>

        {/* Logo */}
        <div style={{width:48,height:48,borderRadius:12,background:"var(--accent)",
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:22,fontWeight:800,color:"#fff",margin:"0 auto 16px"}}>K</div>

        <div style={{fontSize:22,fontWeight:700,marginBottom:6}}>Welcome to Kronos</div>
        <div style={{fontSize:13,color:"var(--muted)",marginBottom:28}}>
          Sign in to save your timetable and collaborate with your team
        </div>

        {/* Google sign-in */}
        <button onClick={handleGoogle} disabled={loading}
          style={{width:"100%",padding:"11px 16px",borderRadius:"var(--r2)",
            background:loading?"var(--bg4)":"var(--text)",color:loading?"var(--muted)":"var(--bg2)",
            border:"1px solid var(--border2)",fontSize:14,fontWeight:600,
            cursor:loading?"not-allowed":"pointer",fontFamily:"inherit",
            display:"flex",alignItems:"center",justifyContent:"center",gap:10,
            marginBottom:12,transition:"all 0.15s"}}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
          </svg>
          {loading ? "Signing in…" : "Continue with Google"}
        </button>

        {error && (
          <div style={{fontSize:11,color:"var(--danger)",marginBottom:12,
            padding:"8px 10px",background:"rgba(220,38,38,0.08)",borderRadius:"var(--r)"}}>
            {error}
          </div>
        )}

        {/* Skip option */}
        <button onClick={onSkip}
          style={{width:"100%",padding:"9px",borderRadius:"var(--r2)",
            background:"transparent",color:"var(--muted)",border:"1px solid var(--border)",
            fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
          Continue without account
        </button>

        <div style={{fontSize:11,color:"var(--muted2)",marginTop:16,lineHeight:1.5}}>
          Signing in saves your timetable to the cloud so you can access it from any device.
          Without an account, data is only saved in this browser.
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
export default function TimetableBuilder() {
  const { user, loading: authLoading } = useAuth();
  const [skipAuth, setSkipAuth]         = useState(false);
  const [state,    setStateRaw]         = useState(()=>sanitizeState(loadLocal())||seed());
  const [tab,      setTab]              = useState("schedule");
  const [modal,    setModal]            = useState(null);
  const [showCollab,setShowCollab]      = useState(false);
  const [userName, setUserName]         = useState(()=>localStorage.getItem("kronos_user")||"");
  const [cloudSaving, setCloudSaving]   = useState(false);
  const [lastCloudSave, setLastCloudSave] = useState(null);
  const saveTimerRef                    = useRef(null);
  const toast                           = useToasts();

  // ── Load user's cloud state when they sign in ─────────────────────
  useEffect(()=>{
    if(!user) return;
    setUserName(user.displayName||user.email||"");
    localStorage.setItem("kronos_user", user.displayName||user.email||"");
    (async()=>{
      const remote = await loadUserState(user.uid);
      if(remote) {
        const { _savedAt, ...appState } = remote;
        const clean = sanitizeState(appState);
        setStateRaw(clean);
        saveLocal(clean);
        toast.push("Timetable loaded from cloud ✓","ok");
      }
    })();
  },[user?.uid]);

  // ── Wrap setState to also push to collab room ─────────────────────
  const collab=useCollaboration(state,
    (newState)=>setStateRaw(typeof newState==="function"?(prev=>sanitizeState(newState(prev))||newState(prev)):sanitizeState(newState)||newState),
    toast.push
  );

  const setState=useCallback((updater,opType,opDetail)=>{
    setStateRaw(prev=>{
      const next=typeof updater==="function"?updater(prev):updater;
      saveLocal(next);
      if(collab.session) collab.pushState(next,opType,opDetail);
      // Debounced cloud save (2s after last change)
      if(user) {
        clearTimeout(saveTimerRef.current);
        setCloudSaving(true);
        saveTimerRef.current = setTimeout(async()=>{
          await saveUserState(user.uid, next);
          setCloudSaving(false);
          setLastCloudSave(Date.now());
        }, 2000);
      }
      return next;
    });
  },[collab.session,collab.pushState,user]);

  const conflicts=useMemo(()=>getAllConflicts(state.appointments||{}),[state.appointments]);

  function log(action,detail="") {
    setStateRaw(prev=>{
      const next={...prev,changelog:[...prev.changelog.slice(-199),{at:Date.now(),action,detail}]};
      saveLocal(next);
      if(collab.session) collab.pushState(next,action,detail);
      return next;
    });
  }

  function handleApptClick(appt) { setModal({appt}); }
  function handleCellClick(weekNum,dayIdx,timeId) { setModal({weekNum,dayIdx,timeId}); }

  function handleApptSave(appts,isEdit) {
    const opDetail=appts.map(a=>`W${a.weekNum} ${DAYS[a.dayIdx]} ${a.timeId}`).join(", ");
    setState(s=>{
      const next={...s.appointments};
      appts.forEach(a=>{next[a.id]=a;});
      return {...s,appointments:next,
        changelog:[...s.changelog.slice(-199),{at:Date.now(),
          action:isEdit?"Session updated":"Session scheduled",detail:appts[0]?.courseName}]};
    }, isEdit?"updated session":"scheduled session", opDetail);
    toast.push(isEdit?"Session updated":`${appts.length} session${appts.length!==1?"s":""} scheduled`,"ok");
    setModal(null);
  }

  function handleApptDelete(id) {
    const appt=state.appointments[id];
    setState(s=>{const a={...s.appointments};delete a[id];return{...s,appointments:a,
      changelog:[...s.changelog.slice(-199),{at:Date.now(),action:"Session deleted",detail:appt?.courseName}]};
    },"deleted session",appt?.courseName);
    toast.push("Session deleted","warn");
  }

  async function handleJoinRoom(code,name,isOwner) {
    const displayName = user?.displayName || name;
    if(displayName) { setUserName(displayName); localStorage.setItem("kronos_user",displayName); }
    await collab.joinRoom(code,displayName||name,isOwner);
    setShowCollab(false);
    toast.push(isOwner?`Room ${code} created — share this code!`:`Joined room ${code}`,"ok");
  }

  useEffect(()=>{
    const el=document.createElement("style");
    el.textContent=GLOBAL_CSS;
    document.head.appendChild(el);
    return ()=>el.remove();
  },[]);

  // Show login screen while auth loading or if not signed in and not skipped
  if(authLoading) return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"var(--bg)",fontFamily:"'Outfit',sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,borderRadius:10,background:"var(--accent)",
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:18,fontWeight:800,color:"#fff",margin:"0 auto 12px"}}>K</div>
        <div style={{color:"var(--muted)",fontSize:13}}>Loading…</div>
      </div>
    </div>
  );
  if(!user && !skipAuth) return <LoginScreen onSkip={()=>setSkipAuth(true)}/>;

  const conflictCount=conflicts.length;
  const TABS_WITH_ACTIVITY = collab.session
    ? [...TABS,{id:"activity",icon:"◉",label:"Activity"}]
    : TABS;

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"var(--bg)",fontFamily:"'Outfit',sans-serif",overflow:"hidden",position:"fixed",inset:0}}>

      {/* Top bar */}
      <div style={{height:48,display:"flex",alignItems:"center",padding:"0 16px",
        borderBottom:"1px solid var(--border)",background:"var(--bg2)",flexShrink:0,gap:10,boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:26,height:26,borderRadius:7,background:"var(--accent)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:12,fontWeight:800,color:"#fff",flexShrink:0}}>K</div>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:"-0.01em"}}>Kronos</span>
          <span style={{fontSize:12,color:"var(--muted)",marginLeft:2}}>{state.settings.semester}</span>
        </div>
        <div style={{flex:1}}/>
        {/* Cloud save indicator */}
        {user&&(
          <div style={{fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:4}}>
            {cloudSaving
              ? <><span style={{width:6,height:6,borderRadius:"50%",background:"var(--warn)",animation:"pulse 0.8s infinite",display:"inline-block"}}/>Saving…</>
              : lastCloudSave
                ? <><span style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",display:"inline-block"}}/>Saved</>
                : null
            }
          </div>
        )}
        {conflictCount>0&&(
          <div onClick={()=>setTab("conflicts")}
            style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",
              padding:"3px 10px",borderRadius:99,
              background:"rgba(248,113,113,0.12)",border:"1px solid rgba(248,113,113,0.25)"}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:"var(--danger)",animation:"pulse 1.5s infinite"}}/>
            <span style={{fontSize:10,color:"var(--danger)",fontWeight:600}}>
              {conflictCount} conflict{conflictCount!==1?"s":""}
            </span>
          </div>
        )}
        {/* Collab button */}
        {!collab.session?(
          <Btn variant="outline" onClick={()=>setShowCollab(true)} style={{gap:5}}>
            <span style={{fontSize:12}}>⬡</span> Collaborate
          </Btn>
        ):(
          <div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:99,
            background:"rgba(5,150,105,0.08)",border:"1px solid rgba(110,231,183,0.25)"}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:"var(--accent)",animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:10,color:"var(--accent)",fontWeight:600,fontFamily:"var(--mono)",
              letterSpacing:"0.08em"}}>{collab.session.roomCode}</span>
          </div>
        )}
        {/* User avatar */}
        {user ? (
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {user.photoURL
              ? <img src={user.photoURL} alt="" style={{width:28,height:28,borderRadius:"50%",border:"2px solid var(--border2)"}}/>
              : <div style={{width:28,height:28,borderRadius:"50%",background:"var(--bg4)",
                  border:"1px solid var(--border2)",display:"flex",alignItems:"center",
                  justifyContent:"center",fontSize:11,fontWeight:600,color:"var(--muted)"}}>
                  {initials(user.displayName||user.email||"?")}
                </div>
            }
            <Btn variant="ghost" size="xs" onClick={()=>signOutUser()} title="Sign out">Sign out</Btn>
          </div>
        ) : (
          <Btn variant="outline" size="xs" onClick={()=>signInWithGoogle()}>Sign in</Btn>
        )}
        <Btn variant="accent" onClick={()=>setModal({weekNum:1,dayIdx:0,timeId:state.slots[0]?.id})}>
          + Schedule
        </Btn>
      </div>

      {/* Presence bar (when in a room) */}
      {collab.session&&(
        <PresenceBar
          session={collab.session}
          presence={collab.presence}
          syncing={collab.syncing}
          lastSyncAt={collab.lastSyncAt}
          onLeave={()=>{ collab.leaveRoom(); toast.push("Left the room","warn"); }}
          onCopyCode={()=>toast.push("Room code copied!","ok")}
        />
      )}

      {/* Main layout */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>
        {/* Icon nav */}
        <nav style={{width:52,background:"var(--bg2)",borderRight:"1px solid var(--border)",
          display:"flex",flexDirection:"column",alignItems:"center",padding:"8px 0",gap:2,flexShrink:0,boxShadow:"1px 0 0 var(--border)"}}>
          {TABS_WITH_ACTIVITY.map(t=>{
            const active=tab===t.id;
            const isCon=t.id==="conflicts"&&conflictCount>0;
            return (
              <button key={t.id} onClick={()=>setTab(t.id)} title={t.label}
                style={{width:38,height:38,borderRadius:"var(--r)",display:"flex",alignItems:"center",
                  justifyContent:"center",fontSize:14,cursor:"pointer",border:"none",position:"relative",
                  background:active?"var(--bg4)":"transparent",
                  color:active?"var(--accent)":isCon?"var(--danger)":"var(--muted2)",
                  transition:"all 0.12s",outline:"none"}}>
                {t.icon}
                {isCon&&<span style={{position:"absolute",top:5,right:5,width:6,height:6,borderRadius:"50%",background:"var(--danger)"}}/>}
              </button>
            );
          })}
        </nav>

        {/* Label nav */}
        <div style={{width:110,background:"var(--bg2)",borderRight:"1px solid var(--border)",
          display:"flex",flexDirection:"column",padding:"8px 0",gap:2,flexShrink:0}}>
          {TABS_WITH_ACTIVITY.map(t=>{
            const active=tab===t.id;
            const isCon=t.id==="conflicts"&&conflictCount>0;
            return (
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{padding:"9px 10px",borderRadius:"var(--r)",display:"flex",alignItems:"center",
                  gap:6,cursor:"pointer",border:"none",margin:"0 4px",
                  background:active?"var(--bg4)":"transparent",
                  color:active?"var(--accent)":isCon?"var(--danger)":"var(--muted)",
                  fontSize:11,fontWeight:active?600:400,fontFamily:"inherit",
                  transition:"all 0.12s",outline:"none",textAlign:"left"}}>
                <span style={{fontSize:12}}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <main style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",minHeight:0,position:"relative"}}>
          {tab==="schedule"&&<ScheduleTab state={state} onApptClick={handleApptClick} onCellClick={handleCellClick} conflicts={conflicts}/>}
          {tab==="dashboard"&&<DashboardTab state={state} conflicts={conflicts}/>}
          {tab==="autoschedule"&&<AutoScheduleTab state={state} setState={setState} toast={toast.push}/>}
          {tab==="courses"&&<CoursesTab state={state} setState={setState} toast={toast.push}/>}
          {tab==="assets"&&<AssetsTab state={state} setState={setState} toast={toast.push}/>}
          {tab==="instructor"&&<InstructorTab state={state} onApptClick={handleApptClick}/>}
          {tab==="conflicts"&&<ConflictsTab conflicts={conflicts} state={state} onApptClick={handleApptClick}/>}
          {tab==="changelog"&&<ChangelogTab log={state.changelog}/>}
          {tab==="settings"&&<SettingsTab state={state} setState={setState} toast={toast.push}/>}
          {tab==="activity"&&collab.session&&(
            <ActivityFeed
              roomCode={collab.session.roomCode}
              presence={collab.presence}
              selfId={collab.session.userId}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      {modal&&(
        <ApptModal appt={modal.appt||null} weekNum={modal.weekNum} dayIdx={modal.dayIdx}
          timeId={modal.timeId} state={state} onSave={handleApptSave}
          onClose={()=>setModal(null)} onDelete={handleApptDelete}/>
      )}
      {showCollab&&(
        <CollabModal onJoin={handleJoinRoom} onClose={()=>setShowCollab(false)} defaultName={userName}/>
      )}

      <Toasts list={toast.list} dismiss={toast.dismiss}/>
    </div>
  );
}
