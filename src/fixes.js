// "How do I fix this clash?" For a session in a clash, find other places it could go that clash with nothing:
// another time in the same week, or (for a room clash) another room that is free and big enough.
import { checkConflicts } from "./conflicts.js";
import { groupDemand } from "./scheduler.js";
import { parseISO, iso, slotDate } from "./dates.js";

const holidayOn = (state, week, dayIdx) => {
  const w1 = state.week1Start;
  if (!w1 || !(state.holidays || []).length) return "";
  const d = iso(slotDate(parseISO(w1), week, dayIdx));
  const h = state.holidays.find(x => x.date === d);
  return h ? (h.name || "holiday") : "";
};

const instructorFree = (state, appt, dayIdx, timeId) => {
  const i = (state.instructors || []).find(x => x.id === appt.instructorId);
  const av = i?.availability || {};
  const any = Object.values(av).some(v => Array.isArray(v) && v.length);
  return !i || !any || (Array.isArray(av[dayIdx]) && av[dayIdx].includes(timeId));
};

/** → [{ kind: "move"|"room", label, changes }] best first (at most `limit`). */
export function suggestFixes(state, appt, { limit = 6 } = {}) {
  const slots = state.slots || [];
  const apps = state.appointments || {};
  const out = [];
  const days = Object.values(apps).some(a => a && a.dayIdx >= 5) ? 6 : 5;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const stripCustom = a => { const { start, end, ...rest } = a; return rest; };

  // Other times that week.
  for (let d = 0; d < days; d++) {
    for (const s of slots) {
      if (d === appt.dayIdx && s.id === appt.timeId && !appt.start) continue;
      if (holidayOn(state, appt.weekNum, d)) continue;
      if (!instructorFree(state, appt, d, s.id)) continue;
      const cand = { ...stripCustom(appt), dayIdx: d, timeId: s.id };
      if (checkConflicts(apps, cand, slots, appt.id).length) continue;
      out.push({ kind: "move", label: `${dayNames[d]} ${s.short || s.label}`, changes: { dayIdx: d, timeId: s.id, start: undefined, end: undefined },
        score: Math.abs(d - appt.dayIdx) * 3 + (s.id === appt.timeId ? 0 : 1) });
    }
  }
  out.sort((a, b) => a.score - b.score);
  const moves = out.slice(0, limit);

  // Other rooms at the same time.
  const rooms = [];
  const need = groupDemand(appt.groupIds || [], state.groups || []);
  (state.rooms || []).forEach(r => {
    if (r.id === appt.roomId) return;
    if (need && (Number(r.capacity) || 0) < need) return;
    if (checkConflicts(apps, { ...appt, roomId: r.id }, slots, appt.id).length) return;
    rooms.push({ kind: "room", label: `${r.name} (${r.capacity} seats)`, changes: { roomId: r.id }, score: (Number(r.capacity) || 0) });
  });
  rooms.sort((a, b) => a.score - b.score);
  return { moves, rooms: rooms.slice(0, 4) };
}
