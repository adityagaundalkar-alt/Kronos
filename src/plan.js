// Course plan: which courses run this term, how many lectures each needs (15 unless set otherwise), how many are
// scheduled, and the session numbers S1, S2 … (lectures) and E1, E2 … (extra classes) in date order.
import { startKey } from "./timeslots.js";
import { sectionsOf } from "./sections.js";
import { iso, slotDate, parseISO } from "./dates.js";
import { slotOptions, ALL_WEEKS } from "./scheduler.js";

export const DEFAULT_TARGET = 15;
export const isExtra = a => a?.kind === "extra";
export const sessionLabel = a => (a && Number.isFinite(a.num) && a.num > 0 && a.courseId ? (isExtra(a) ? "E" : "S") + a.num : "");

/** Sessions are numbered within one course, one section (or none) and one kind. */
export const numberKey = a => `${a.courseId}|${a.sectionId || ""}|${isExtra(a) ? "extra" : "lecture"}`;

/** Timeline order: week, day, slot, then a custom start time. */
export function byTimeline(slots) {
  const pos = new Map((slots || []).map((s, i) => [s.id, i]));
  return (a, b) => (a.weekNum - b.weekNum) || (a.dayIdx - b.dayIdx)
    || ((pos.get(a.timeId) ?? 99) - (pos.get(b.timeId) ?? 99))
    || (startKey(a, slots) - startKey(b, slots)) || String(a.id).localeCompare(String(b.id));
}

function groups(appointments) {
  const m = new Map();
  Object.values(appointments || {}).forEach(a => {
    if (!a || !a.courseId) return;
    const k = numberKey(a);
    (m.get(k) || m.set(k, []).get(k)).push(a);
  });
  return m;
}

const hasNum = a => Number.isFinite(a.num) && a.num > 0;
/** Stored numbers go up with the timeline (gaps are allowed: a deleted lecture leaves one). */
const inOrder = sorted => sorted.every((a, i) => i === 0 || (hasNum(a) && hasNum(sorted[i - 1]) && a.num > sorted[i - 1].num));

/** Keys of numbered groups whose numbers no longer follow the dates. */
export function outOfOrder(appointments, slots) {
  const cmp = byTimeline(slots), out = new Set();
  groups(appointments).forEach((list, k) => {
    if (!list.every(hasNum)) return;
    if (!inOrder([...list].sort(cmp))) out.add(k);
  });
  return out;
}

/** Renumber the given groups (or all) 1, 2, 3 … by date. Returns the same state when nothing changes. */
export function renumber(state, keys) {
  const cmp = byTimeline(state.slots);
  let apps = null;
  groups(state.appointments).forEach((list, k) => {
    if (keys && !keys.has(k)) return;
    [...list].sort(cmp).forEach((a, i) => {
      if (a.num === i + 1) return;
      apps = apps || { ...state.appointments };
      apps[a.id] = { ...a, num: i + 1 };
    });
  });
  return apps ? { ...state, appointments: apps } : state;
}

/**
 * Give numbers to sessions that have none (new or older sessions). A group still in date order is renumbered by date,
 * so a lecture added in the middle takes its place; a group someone chose to keep out of order only gets new numbers
 * after its highest one.
 */
export function numberSessions(state) {
  const cmp = byTimeline(state.slots);
  let apps = null;
  const set = (a, n) => { if (a.num !== n) { apps = apps || { ...state.appointments }; apps[a.id] = { ...a, num: n }; } };
  groups(state.appointments).forEach(list => {
    if (list.every(hasNum)) return;
    const sorted = [...list].sort(cmp);
    const numbered = sorted.filter(hasNum);
    if (inOrder(numbered)) sorted.forEach((a, i) => set(a, i + 1));
    else {
      let n = Math.max(...numbered.map(a => a.num));
      sorted.filter(a => !hasNum(a)).forEach(a => set(a, ++n));
    }
  });
  return apps ? { ...state, appointments: apps } : state;
}

const whenKey = a => `${a.weekNum}|${a.dayIdx}|${a.timeId}|${a.start || ""}`;
/** Groups that a change put out of order by moving a session (manual number edits don't count). */
export function newlyOutOfOrder(prev, next) {
  const before = outOfOrder(prev.appointments, prev.slots), after = outOfOrder(next.appointments, next.slots);
  const out = new Set();
  after.forEach(k => {
    if (before.has(k)) return;
    const moved = Object.values(next.appointments).some(a => a && a.courseId && numberKey(a) === k
      && (!prev.appointments[a.id] || whenKey(prev.appointments[a.id]) !== whenKey(a) || numberKey(prev.appointments[a.id]) !== k));
    if (moved) out.add(k);
  });
  return out;
}

// ── The plan ────────────────────────────────────────────────────────────────
/** Courses marked as running this term; until any is marked, every course counts. */
export function runningCourses(courses) {
  const list = (courses || []).filter(Boolean);
  return list.some(c => c.running) ? list.filter(c => c.running) : list;
}
export const planStarted = courses => (courses || []).some(c => c && c.running);

export const targetOf = (course, section) => {
  const t = Number(section?.target) || Number(course?.targetSessions);
  return t > 0 ? t : DEFAULT_TARGET;
};

/** What a unit (a course, or one of its sections) uses when new sessions are placed. */
export function unitDefaults(course, section) {
  return {
    courseId: course.id, sectionId: section?.id || "", sectionName: section?.name || "",
    instructorId: section?.instructorId || course.defaultInstructorId || "",
    groupIds: section?.groupIds?.length ? section.groupIds : (course.defaultGroupIds || []),
    roomId: section?.roomId || "", preferRoomType: section?.roomType || "",
  };
}

function holidayChecker(state) {
  const hol = new Map((state.holidays || []).filter(h => h.date).map(h => [h.date, h.name || "Holiday"]));
  if (!hol.size || !state.week1Start) return () => "";
  const w1 = parseISO(state.week1Start);
  return (w, d) => hol.get(iso(slotDate(w1, w, d))) || "";
}

/** Gaps (weeks with no lecture between the first and the last), crowded weeks (3 or more) and lectures on holidays. */
export function paceOf(lectures, holidayOn) {
  const perWeek = new Map();
  lectures.forEach(a => perWeek.set(a.weekNum, (perWeek.get(a.weekNum) || 0) + 1));
  const weeks = [...perWeek.keys()].filter(w => w >= 1).sort((a, b) => a - b);
  const gaps = [];
  if (weeks.length) for (let w = weeks[0]; w <= weeks[weeks.length - 1]; w++) if (!perWeek.has(w)) gaps.push(w);
  const crowded = [...perWeek.entries()].filter(([, n]) => n >= 3).map(([w, n]) => ({ weekNum: w, count: n })).sort((a, b) => a.weekNum - b.weekNum);
  const onHoliday = lectures.map(a => ({ a, name: holidayOn(a.weekNum, a.dayIdx) })).filter(x => x.name);
  return { gaps, crowded, onHoliday, issues: gaps.length + crowded.length + onHoliday.length };
}

/**
 * One row per unit of every running course: { key, course, section, target, lectures[], extras[], missing, over, pace }.
 * Also `stray`: courses not running this term that still have sessions.
 */
export function buildPlan(state) {
  const cmp = byTimeline(state.slots);
  const holidayOn = holidayChecker(state);
  const byCourse = new Map();
  Object.values(state.appointments || {}).forEach(a => { if (a && a.courseId) (byCourse.get(a.courseId) || byCourse.set(a.courseId, []).get(a.courseId)).push(a); });
  const rows = [];
  runningCourses(state.courses).forEach(course => {
    const all = (byCourse.get(course.id) || []).sort(cmp);
    const secs = sectionsOf(course);
    const units = secs.length ? secs.map(s => s) : [null];
    // sessions of a sectioned course that have no section get their own row, so they're not lost
    if (secs.length && all.some(a => !a.sectionId || !secs.some(s => s.id === a.sectionId))) units.push(undefined);
    units.forEach(section => {
      const mine = all.filter(a => section ? a.sectionId === section.id : section === null ? true : (!a.sectionId || !secs.some(s => s.id === a.sectionId)));
      const lectures = mine.filter(a => !isExtra(a)), extras = mine.filter(isExtra);
      const target = section === undefined ? lectures.length : targetOf(course, section); // sessions without a section aren't counted
      rows.push({
        key: `${course.id}|${section ? section.id : section === null ? "" : "none"}`,
        course, section: section || null, noSection: section === undefined,
        target, lectures, extras,
        missing: Math.max(0, target - lectures.length), over: Math.max(0, lectures.length - target),
        pace: paceOf(lectures, holidayOn),
      });
    });
  });
  const running = new Set(runningCourses(state.courses).map(c => c.id));
  const stray = (state.courses || []).filter(c => !running.has(c.id) && (byCourse.get(c.id) || []).length)
    .map(c => ({ course: c, count: byCourse.get(c.id).length }));
  return { rows, stray };
}

/**
 * Where the missing lectures of a unit could go: for each week without a lecture of it, the free times
 * (instructor, groups and room all free), the usual time first. `fill` = the sessions to add for the first `count` weeks.
 */
export function suggestPlacements(state, row, { weeks = ALL_WEEKS, count = row.missing, makeId } = {}) {
  const d = unitDefaults(row.course, row.section);
  const job = { ...d, weeks, sessionsPerWeek: 1 };
  const { options } = slotOptions(state, job);
  const usual = mostCommon(row.lectures.map(a => `${a.dayIdx}_${a.timeId}`));
  const taken = new Set(row.lectures.map(a => a.weekNum));
  const perWeek = [];
  weeks.forEach(w => {
    if (taken.has(w)) return;
    const free = options.filter(o => o.byWeek[w]?.ok).map(o => ({
      weekNum: w, dayIdx: o.dayIdx, timeId: o.timeId, rooms: o.byWeek[w].rooms, roomIds: o.byWeek[w].roomIds, load: o.byWeek[w].load,
      usual: `${o.dayIdx}_${o.timeId}` === usual,
    })).sort((a, b) => (b.usual - a.usual) || (a.load - b.load) || (a.dayIdx - b.dayIdx));
    if (free.length) perWeek.push({ weekNum: w, options: free });
  });
  const id = makeId || (() => Math.random().toString(36).slice(2, 9));
  const fill = perWeek.slice(0, Math.max(0, count)).map(({ options: [o] }) => sessionAt(row, d, o, id()));
  return { perWeek, fill, short: Math.max(0, count - perWeek.length) };
}

/** A new lecture of this unit at a suggested time. */
export function sessionAt(row, d, o, id) {
  const roomId = d.roomId && o.roomIds.includes(d.roomId) ? d.roomId : (o.roomIds[0] || "");
  return {
    id, weekNum: o.weekNum, dayIdx: o.dayIdx, timeId: o.timeId,
    courseId: row.course.id, courseName: row.course.name, courseCode: row.course.code,
    instructorId: d.instructorId, groupIds: [...d.groupIds], roomId, notes: "", kind: "lecture",
    ...(row.section ? { sectionId: row.section.id, section: row.section.name } : {}),
  };
}

function mostCommon(xs) {
  const n = new Map(); let best = null, c = 0;
  xs.forEach(x => { const v = (n.get(x) || 0) + 1; n.set(x, v); if (v > c) { c = v; best = x; } });
  return best;
}
