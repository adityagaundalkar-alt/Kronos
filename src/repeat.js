// Repeating a session (an extra class every week, a workshop every second week...).
import { checkConflicts } from "./conflicts.js";
import { parseISO, iso, slotDate } from "./dates.js";

/** Weeks a repeat covers: start, start+every, ... up to `until` (week numbers, 1-based; week 0 is orientation). */
export function repeatWeeks(start, every, until) {
  const out = [];
  if (!(every >= 1)) return [start];
  for (let w = start; w <= until; w += every) out.push(w);
  return out;
}

/** Work out which repeats can be saved. Weeks with a holiday or a clash are skipped and reported. */
export function planRepeat(state, base, { every, until, newId }) {
  const weeks = repeatWeeks(base.weekNum, every, until);
  const holidays = new Set((state.holidays || []).map(h => h.date).filter(Boolean));
  const w1 = state.week1Start;
  const toSave = [], clash = [], holiday = [];
  // sessions we are adding must not clash with each other either (they are in different weeks, so they can't)
  weeks.forEach(w => {
    if (holidays.size && w1 && w > 0 && holidays.has(iso(slotDate(parseISO(w1), w, base.dayIdx)))) { holiday.push(w); return; }
    if (checkConflicts(state.appointments, { ...base, weekNum: w }, state.slots).filter(c => !(base.overrides || []).includes(c.type)).length) { clash.push(w); return; }
    toSave.push({ ...base, id: newId(), weekNum: w });
  });
  return { toSave, clash, holiday, weeks };
}
