// App state: seed data, sanitising loaded data, and the browser-local storage helpers.
import { iso, mondayOf } from "./dates.js";
import { DEFAULT_SLOTS } from "./constants.js";

// ═══════════════════════════════════════════════════════════════════
//  LOCAL STORAGE (solo fallback)
// ═══════════════════════════════════════════════════════════════════
export const LOCAL_KEY = "kronos_v6";
const OLD_LOCAL_KEYS = ["kronos_v5"]; // earlier terms' demo data: cleared once, never read again
try { OLD_LOCAL_KEYS.forEach(k => localStorage.removeItem(k)); } catch { /* private mode */ }
export const loadLocal = () => { try{ const s=localStorage.getItem(LOCAL_KEY); return s?JSON.parse(s):null; }catch{ return null; } };
export const saveLocal = s  => { try{ localStorage.setItem(LOCAL_KEY,JSON.stringify(s)); }catch{} };

// ═══════════════════════════════════════════════════════════════════
//  STARTING POINT FOR A NEW TERM
// ═══════════════════════════════════════════════════════════════════
/** A term with nothing in it. `name` is shown as the term's name (e.g. "Term 1 – 2026"). */
export function emptyState(name="") {
  return {
    week1Start:iso(mondayOf(new Date())),
    instructors:[],rooms:[],groups:[],courses:[],appointments:{},
    holidays:[],changelog:[],
    settings:{institution:"",semester:name,logo:""},
    slots:DEFAULT_SLOTS.map(s=>({...s})),
  };
}

/** A new term that keeps the people and places of an earlier one (instructors, rooms, student groups, time slots) but none of its classes. */
export function termFrom(earlier, name="") {
  const base=emptyState(name), e=earlier||{};
  return {
    ...base,
    instructors:(e.instructors||[]).map(i=>({...i})),
    rooms:(e.rooms||[]).map(r=>({...r})),
    groups:(e.groups||[]).map(g=>({...g})),
    slots:(e.slots&&e.slots.length?e.slots:base.slots).map(s=>({...s})),
    settings:{...base.settings,institution:e.settings?.institution||"",logo:e.settings?.logo||""},
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

// Terms this browser has opened before (kept on this device, and for signed-in people also in their account).
// The code is whatever this person joined with, so reopening a term restores the same role.
const RECENT_ROOMS_KEY="kronos_recent_rooms";
export function loadRecentRooms() {
  try { const r=JSON.parse(localStorage.getItem(RECENT_ROOMS_KEY)||"[]"); return Array.isArray(r)?r:[]; } catch { return []; }
}
export function rememberRoom(code,name,role,archived) {
  try {
    const all=loadRecentRooms(), prev=all.find(r=>r.code===code);
    const rest=all.filter(r=>r.code!==code);
    localStorage.setItem(RECENT_ROOMS_KEY,JSON.stringify([{code,name:name||prev?.name||"",role:role||prev?.role||"",archived:archived??prev?.archived??false,at:Date.now()},...rest].slice(0,40)));
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
