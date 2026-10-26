// App state: seed data, sanitising loaded data, and the browser-local storage helpers.
import { iso, mondayOf } from "./dates.js";
import { DEFAULT_SLOTS, uid } from "./constants.js";

// ═══════════════════════════════════════════════════════════════════
//  LOCAL STORAGE (solo fallback)
// ═══════════════════════════════════════════════════════════════════
export const LOCAL_KEY = "kronos_v5";
export const loadLocal = () => { try{ const s=localStorage.getItem(LOCAL_KEY); return s?JSON.parse(s):null; }catch{ return null; } };
export const saveLocal = s  => { try{ localStorage.setItem(LOCAL_KEY,JSON.stringify(s)); }catch{} };

// ═══════════════════════════════════════════════════════════════════
//  SEED DATA
// ═══════════════════════════════════════════════════════════════════
export function seed() {
  const w1=iso(mondayOf(new Date()));
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
export function sanitizeAppt(a) {
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
export function sanitizeState(s) {
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

// Rooms this browser has joined before (kept only on this device, never listed from the server).
// The code is whatever this person joined with, so reopening a room restores the same role.
const RECENT_ROOMS_KEY="kronos_recent_rooms";
export function loadRecentRooms() {
  try { const r=JSON.parse(localStorage.getItem(RECENT_ROOMS_KEY)||"[]"); return Array.isArray(r)?r:[]; } catch { return []; }
}
export function rememberRoom(code,name,role) {
  try {
    const all=loadRecentRooms(), prev=all.find(r=>r.code===code);
    const rest=all.filter(r=>r.code!==code);
    localStorage.setItem(RECENT_ROOMS_KEY,JSON.stringify([{code,name:name||prev?.name||"",role:role||prev?.role||"",at:Date.now()},...rest].slice(0,6)));
  } catch {}
}
export function forgetRoom(code) {
  try { localStorage.setItem(RECENT_ROOMS_KEY,JSON.stringify(loadRecentRooms().filter(r=>r.code!==code))); } catch {}
}

export const BACKUP_PREFIX = "kronos_backup_";

// Keep a safety copy of local data before it is replaced (joining a room, adopting the cloud copy).
export function backupLocalState(state, reason) {
  try {
    localStorage.setItem(BACKUP_PREFIX + Date.now(), JSON.stringify({ reason, state }));
    Object.keys(localStorage).filter(k => k.startsWith(BACKUP_PREFIX)).sort().slice(0, -3)
      .forEach(k => localStorage.removeItem(k)); // keep the 3 most recent
  } catch {}
}
