// Moving sessions around the timetable (drag and drop, "shift these by a day", "move to week 7").
import { getAllConflicts } from "./conflicts.js";
import { parseISO, iso, slotDate } from "./dates.js";

const key = c => `${c.type}|${[c.a.id, c.b.id].sort().join("|")}`;
export const openClashes = (appointments, slots) => getAllConflicts(appointments, slots).filter(c => !c.overridden);

/**
 * moves: [{ id, weekNum?, dayIdx?, timeId? }]  (only the fields that change).
 * → { appointments, moved: ids[], blocked: [{ id, reason }], newClashes: number }
 * Targets that don't exist (before week 0, after week 16, off the grid) or fall on a holiday are blocked and left alone.
 */
export function planMoves(state, moves, { maxDay = 4 } = {}) {
  const apps = { ...(state.appointments || {}) };
  const slotIds = new Set((state.slots || []).map(s => s.id));
  const hol = new Set((state.holidays || []).map(h => h.date).filter(Boolean));
  const w1 = state.week1Start;
  const moved = [], blocked = [];
  moves.forEach(m => {
    const a = apps[m.id];
    if (!a) return;
    const t = { weekNum: m.weekNum ?? a.weekNum, dayIdx: m.dayIdx ?? a.dayIdx, timeId: m.timeId ?? a.timeId };
    if (t.weekNum < 0 || t.weekNum > 16) { blocked.push({ id: m.id, reason: "outside the term's weeks" }); return; }
    if (t.dayIdx < 0 || t.dayIdx > Math.max(maxDay, a.dayIdx)) { blocked.push({ id: m.id, reason: "outside the week" }); return; }
    if (!slotIds.has(t.timeId)) { blocked.push({ id: m.id, reason: "no such time slot" }); return; }
    if (t.weekNum > 0 && w1 && hol.size && hol.has(iso(slotDate(parseISO(w1), t.weekNum, t.dayIdx)))) { blocked.push({ id: m.id, reason: "falls on a holiday" }); return; }
    if (t.weekNum === a.weekNum && t.dayIdx === a.dayIdx && t.timeId === a.timeId) return;
    const next = { ...a, ...t };
    if (t.timeId !== a.timeId) { delete next.start; delete next.end; } // a custom time belongs to its slot
    apps[m.id] = next; moved.push(m.id);
  });
  const before = new Set(openClashes(state.appointments, state.slots).map(key));
  const newClashes = openClashes(apps, state.slots).filter(c => !before.has(key(c))).length;
  return { appointments: apps, moved, blocked, newClashes };
}

/** Shift a group of sessions by whole days / slots / weeks. */
export const shiftMoves = (state, ids, { days = 0, slots = 0, weeks = 0 }) => {
  const order = (state.slots || []).map(s => s.id);
  return ids.map(id => {
    const a = (state.appointments || {})[id];
    if (!a) return { id };
    const si = order.indexOf(a.timeId) + slots;
    return { id, weekNum: a.weekNum + weeks, dayIdx: a.dayIdx + days, timeId: order[si] ?? "" };
  });
};
