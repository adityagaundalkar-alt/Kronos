// Auto-scheduler (pure, no React / Firebase). Places the sessions of "jobs" into the
// timetable without creating clashes, and explains clearly when it cannot.
//
// A job is: { courseId, instructorId, groupIds[], roomId?, preferRoomType?, weeks[],
//   sessionsPerWeek?, mode?, useInstructorAvailability?, customSlots?[{dayIdx,timeId}],
//   neededCapacity?, ignoreCapacity?, preferDays?[], preferSlots?[], avoidDays?[], avoidSlots?[],
//   requireAll?, replaceExisting? }
//
// mode:  "strict" - the same slot every week; weeks where it is blocked are skipped.
//        "prefer" - the same slot every week; blocked weeks are moved to another time that week. (default)
//        "free"   - every week is placed on its own, favouring the most-used slot for consistency.
//
// Hard rules (never broken): holidays, instructor / group / room clashes (real time overlap,
// including custom session times), room capacity (from group sizes), instructor weekly maximum,
// instructor availability. Soft preferences (preferred / avoided days and slots, spreading load across
// days, keeping to a consistent slot and room) only influence which valid option wins.
// Sessions with `locked: true` are never removed or moved.
import { iso, slotDate, parseISO } from "./dates.js";
import { sessionsOverlap } from "./timeslots.js";

export const DAY_COUNT = 5;
export const ALL_WEEKS = Array.from({ length: 16 }, (_, i) => i + 1);

const randomId = () => Math.random().toString(36).slice(2, 9);

/** Weeks a job covers, from its "weeksMode" fields (or an explicit `weeks` array). */
export function jobWeeks(job) {
  if (Array.isArray(job.weeks) && job.weeks.length) return [...new Set(job.weeks)].sort((a, b) => a - b);
  if (job.weeksMode === "range") {
    const out = [];
    for (let w = job.weekStart; w <= job.weekEnd; w++) out.push(w);
    return out;
  }
  if (job.weeksMode === "custom" && job.customWeeks?.length) return [...job.customWeeks].sort((a, b) => a - b);
  return ALL_WEEKS;
}

/**
 * Seats a set of groups needs. Selecting a group together with one of its parents counts
 * only the parent (a parent's size already includes its sub-groups).
 */
export function groupDemand(groupIds, groups) {
  const sel = new Set((groupIds || []).filter(Boolean));
  const byId = new Map((groups || []).map(g => [g.id, g]));
  let total = 0;
  for (const id of sel) {
    const g = byId.get(id);
    if (!g) continue;
    let p = g.parentId, covered = false, guard = 0;
    while (p && guard++ < 25) {
      if (sel.has(p)) { covered = true; break; }
      p = byId.get(p)?.parentId;
    }
    if (!covered) total += Number(g.size) || 0;
  }
  return total;
}

/** Seats a job needs: the larger of its manual figure and what its groups add up to. */
export function seatsNeeded(job, groups) {
  if (job.ignoreCapacity) return 0;
  return Math.max(Number(job.neededCapacity) || 0, groupDemand(job.groupIds, groups));
}

/** Every weekly time the job may use, flagged with whether the instructor is available then. */
export function candidateSlots(job, instructor, slots) {
  const avail = instructor?.availability || {};
  const hasAvailability = Object.values(avail).some(v => Array.isArray(v) && v.length);
  const useAvail = job.useInstructorAvailability !== false && instructor && hasAvailability;
  const extra = job.customSlots || [];
  const out = [];
  for (let d = 0; d < DAY_COUNT; d++) {
    for (const s of slots) {
      const forced = extra.some(x => x.dayIdx === d && x.timeId === s.id);
      out.push({ dayIdx: d, timeId: s.id, available: forced || !useAvail || (avail[d] || []).includes(s.id) });
    }
  }
  return out;
}

// A session of another section of the same course is meant to run alongside this one (the cohort is split), so it never blocks the student groups.
const siblingSection = (job, a) => !job.custom && !!job.sectionId && !!job.courseId && a.courseId === job.courseId && !!a.sectionId && a.sectionId !== job.sectionId;

function makeIndex(appointments) {
  const byDay = new Map(), byWeek = new Map();
  const norm = a => ({ ...a, groupIds: Array.isArray(a.groupIds) ? a.groupIds : [] });
  const push = (m, k, a) => (m.get(k) || m.set(k, []).get(k)).push(a);
  const idx = {
    add(a) { push(byDay, `${a.weekNum}_${a.dayIdx}`, a); push(byWeek, a.weekNum, a); },
    remove(a) {
      const k = `${a.weekNum}_${a.dayIdx}`;
      byDay.set(k, (byDay.get(k) || []).filter(x => x.id !== a.id));
      byWeek.set(a.weekNum, (byWeek.get(a.weekNum) || []).filter(x => x.id !== a.id));
    },
    day: (w, d) => byDay.get(`${w}_${d}`) || [],
    weekLoad: (w, instructorId) => (byWeek.get(w) || []).filter(a => a.instructorId === instructorId).length,
  };
  Object.values(appointments || {}).filter(Boolean).forEach(a => idx.add(norm(a)));
  return idx;
}

function makeContext(state, job, index) {
  const holidays = new Set((state.holidays || []).map(h => h.date).filter(Boolean));
  const holidayNames = new Map((state.holidays || []).filter(h => h.date).map(h => [h.date, h.name || "holiday"]));
  const w1 = state.week1Start;
  return {
    state, job, index,
    slots: state.slots || [],
    rooms: state.rooms || [],
    groups: state.groups || [],
    instructor: (state.instructors || []).find(i => i.id === job.instructorId) || null,
    needed: seatsNeeded(job, state.groups),
    holidayOn(week, dayIdx) {
      if (!holidays.size || !w1) return "";
      const d = iso(slotDate(parseISO(w1), week, dayIdx));
      return holidays.has(d) ? (holidayNames.get(d) || "holiday") : "";
    },
  };
}

/** Can this job's session go at (week, day, slot)? Returns { ok, reasons[], freeRooms[] }. */
function evaluate(ctx, week, dayIdx, timeId) {
  const { job, index, slots, rooms, groups, instructor, needed } = ctx;
  const hol = ctx.holidayOn(week, dayIdx);
  if (hol) return { ok: false, reasons: [{ code: "holiday", detail: hol }], freeRooms: [] };

  const probe = { weekNum: week, dayIdx, timeId };
  const here = index.day(week, dayIdx).filter(a => sessionsOverlap(a, probe, slots));
  const reasons = [];

  if (job.instructorId) {
    const c = here.find(a => a.instructorId === job.instructorId);
    if (c) reasons.push({ code: "instructor-busy", detail: `${instructor?.name || "The instructor"} is teaching ${c.courseCode || c.courseName || "another session"}` });
    if (instructor?.maxLoad && index.weekLoad(week, job.instructorId) >= instructor.maxLoad)
      reasons.push({ code: "load", detail: `${instructor.name} is already at ${instructor.maxLoad} sessions this week` });
  }

  const wanted = (job.groupIds || []).filter(Boolean);
  if (wanted.length) {
    const c = here.find(a => !siblingSection(job, a) && (a.groupIds || []).some(g => wanted.includes(g)));
    if (c) {
      const gid = (c.groupIds || []).find(g => wanted.includes(g));
      reasons.push({ code: "group-busy", detail: `${groups.find(g => g.id === gid)?.name || "A student group"} has ${c.courseCode || c.courseName || "a session"}` });
    }
  }

  let freeRooms = [];
  if (job.roomId) {
    const room = rooms.find(r => r.id === job.roomId);
    if (!room) reasons.push({ code: "room-missing", detail: "the chosen room no longer exists" });
    else if (here.some(a => a.roomId === room.id)) reasons.push({ code: "room-busy", detail: `${room.name} is occupied` });
    else if (room.capacity < needed) reasons.push({ code: "room-too-small", detail: `${room.name} seats ${room.capacity}, needs ${needed}` });
    else freeRooms = [room];
  } else {
    const fit = rooms.filter(r => (Number(r.capacity) || 0) >= needed);
    if (!rooms.length) reasons.push({ code: "room-too-small", detail: "no rooms are defined" });
    else if (!fit.length) {
      const biggest = Math.max(...rooms.map(r => Number(r.capacity) || 0));
      reasons.push({ code: "room-too-small", detail: `needs ${needed} seats, the largest room has ${biggest}` });
    } else {
      freeRooms = fit.filter(r => !here.some(a => a.roomId === r.id));
      if (!freeRooms.length) reasons.push({ code: "room-busy", detail: "every large-enough room is occupied" });
    }
  }
  return { ok: reasons.length === 0, reasons, freeRooms };
}

/** Higher = better. Only used to choose between options that are all valid. */
function softScore(ctx, week, dayIdx, timeId, anchor) {
  const { job, index } = ctx;
  let s = 0;
  if (job.preferDays?.length) s += job.preferDays.includes(dayIdx) ? 2 : -0.5;
  if (job.preferSlots?.length) s += job.preferSlots.includes(timeId) ? 2 : -0.5;
  if (job.avoidDays?.includes(dayIdx)) s -= 3;
  if (job.avoidSlots?.includes(timeId)) s -= 3;
  const day = index.day(week, dayIdx);
  if (job.instructorId) s -= 0.5 * day.filter(a => a.instructorId === job.instructorId).length; // spread the instructor's load
  const wanted = job.groupIds || [];
  if (wanted.length) s -= 0.4 * day.filter(a => !siblingSection(job, a) && (a.groupIds || []).some(g => wanted.includes(g))).length; // lighter days for students
  if (job.sectionId && day.some(a => siblingSection(job, a) && a.timeId === timeId)) s += 2.5; // run alongside the other sections
  if (anchor && anchor.dayIdx === dayIdx && anchor.timeId === timeId) s += 1.5;
  return s;
}

function pickRoom(ctx, freeRooms, lastRoomId) {
  const pref = ctx.job.preferRoomType;
  return [...freeRooms].sort((a, b) =>
    (pref ? (b.type === pref) - (a.type === pref) : 0) ||
    ((b.id === lastRoomId) - (a.id === lastRoomId)) ||
    (a.capacity - b.capacity) || String(a.name).localeCompare(String(b.name)))[0];
}

const mostUsed = placed => {
  const tally = new Map();
  placed.forEach(a => { const k = `${a.dayIdx}_${a.timeId}`; tally.set(k, (tally.get(k) || 0) + 1); });
  let best = null, n = 0;
  tally.forEach((c, k) => { if (c > n) { n = c; const [d, t] = k.split("_"); best = { dayIdx: Number(d), timeId: t }; } });
  return best;
};

const REASON_TEXT = {
  holiday: "falls on a holiday",
  "instructor-busy": "instructor already teaching",
  load: "instructor at their weekly maximum",
  "group-busy": "student group already has a class",
  "room-busy": "no suitable room free",
  "room-too-small": "no room large enough",
  "room-missing": "locked room missing",
  unavailable: "outside the instructor's availability",
};
export const reasonText = code => REASON_TEXT[code] || code;

/** Why can't (week, any allowed slot) take this session? Aggregated over every candidate time. */
function diagnoseWeek(ctx, week, candidates, usedDays) {
  const tally = new Map();
  let tried = 0;
  const bump = (code, detail) => {
    const t = tally.get(code) || { code, count: 0, examples: [] };
    t.count++;
    if (detail && t.examples.length < 2 && !t.examples.includes(detail)) t.examples.push(detail);
    tally.set(code, t);
  };
  for (const c of candidates) {
    if (usedDays.has(c.dayIdx)) continue;
    tried++;
    if (!c.available) { bump("unavailable"); continue; }
    const ev = evaluate(ctx, week, c.dayIdx, c.timeId);
    ev.reasons.forEach(r => bump(r.code, r.detail));
  }
  return { tried, reasons: [...tally.values()].sort((a, b) => b.count - a.count) };
}

const SUGGESTION = {
  "instructor-busy": name => `Move or shorten some of ${name}'s other classes, or let this one run at more times.`,
  load: name => `Raise ${name}'s weekly maximum, or spread their sessions across fewer courses.`,
  "group-busy": () => "The student groups are fully booked at those times: move another class, or split the groups.",
  "room-busy": () => "Add another room, or allow a different room type.",
  "room-too-small": () => "Add a bigger room, split the cohort into sub-groups, or switch off the capacity check for this job.",
  unavailable: name => `Open up more of ${name}'s availability.`,
  holiday: () => "Use the \"Move blocked weeks\" mode so holiday weeks are re-placed at another time.",
};

function explain(ctx, missing, weeksCount) {
  const lines = [], tips = [];
  const instrName = ctx.instructor?.name || "the instructor";
  const holidayWeeks = missing.filter(m => m.holiday).map(m => `W${m.weekNum}`);
  if (holidayWeeks.length) lines.push(`${[...new Set(holidayWeeks)].join(", ")} fall on a holiday at the chosen time.`);
  const agg = new Map();
  missing.filter(m => !m.holiday).forEach(m => m.reasons.forEach(r => {
    const t = agg.get(r.code) || { code: r.code, count: 0, tried: 0, examples: [], weeks: new Set() };
    t.count += r.count; t.weeks.add(m.weekNum);
    r.examples.forEach(e => { if (t.examples.length < 2 && !t.examples.includes(e)) t.examples.push(e); });
    agg.set(r.code, t);
  }));
  const totalTried = missing.filter(m => !m.holiday).reduce((n, m) => n + m.tried, 0);
  [...agg.values()].sort((a, b) => b.count - a.count).forEach(t => {
    const eg = t.examples.length ? ` (e.g. ${t.examples.join("; ")})` : "";
    lines.push(`${t.count} of ${totalTried} candidate times ruled out: ${reasonText(t.code)}${eg}.`);
    const tip = SUGGESTION[t.code]?.(instrName);
    if (tip && tips.length < 2 && !tips.includes(tip)) tips.push(tip);
  });
  if (weeksCount && !lines.length) lines.push("No valid time was found.");
  return { lines, tips };
}

/** Place one session of the job in `week` at the best flexible option. Returns the new appointment or null. */
function placeFlexible(ctx, week, candidates, usedDays, anchor, lastRoomId, makeId, course) {
  let best = null;
  for (const c of candidates) {
    if (!c.available || usedDays.has(c.dayIdx)) continue;
    const ev = evaluate(ctx, week, c.dayIdx, c.timeId);
    if (!ev.ok) continue;
    const score = softScore(ctx, week, c.dayIdx, c.timeId, anchor);
    if (!best || score > best.score) best = { c, ev, score };
  }
  if (!best) return null;
  return commitSession(ctx, week, best.c.dayIdx, best.c.timeId, best.ev.freeRooms, lastRoomId, makeId, course);
}

function commitSession(ctx, week, dayIdx, timeId, freeRooms, lastRoomId, makeId, course) {
  const { job } = ctx;
  const room = pickRoom(ctx, freeRooms, lastRoomId);
  const appt = {
    id: makeId(), weekNum: week, dayIdx, timeId,
    courseId: job.custom ? "" : job.courseId, courseName: course.name, courseCode: course.code,
    instructorId: job.instructorId || "", roomId: room.id,
    groupIds: [...(job.groupIds || [])], notes: "",
    ...(job.sectionId && !job.custom ? { sectionId: job.sectionId, section: job.sectionName || "" } : {}),
  };
  ctx.index.add(appt);
  return appt;
}

/**
 * Run the scheduler. Pure: nothing in `state` is modified.
 * Returns { scheduled: appt[], removed: id[], reports: [...], skipped: [{job, reason}] } where each report is
 * { job, course, status: "full"|"partial"|"none", placed: appt[], missing: [...], holidayWeeks: n,
 *   removed: id[], explanation: string[], suggestions: string[] }.
 */
export function runAutoSchedule(state, jobs, { makeId = randomId } = {}) {
  const index = makeIndex(state.appointments);
  const scheduled = [], removed = [], reports = [], skipped = [];

  for (const job of jobs) {
    // A custom event (extra class, workshop...) has no course: it carries its own title.
    const course = job.custom ? { id: "", name: (job.customTitle || "").trim() || "Extra session", code: (job.customCode || "").trim() || "EXTRA" } : (state.courses || []).find(c => c.id === job.courseId);
    const report = { job, course, status: "none", placed: [], missing: [], holidayWeeks: 0, removed: [], explanation: [], suggestions: [] };
    reports.push(report);
    if (!course) { report.explanation = ["Course not found."]; skipped.push({ job, reason: "Course not found" }); continue; }

    const ctx = makeContext(state, job, index);
    const weeks = jobWeeks(job);
    const perWeek = Math.min(Math.max(Number(job.sessionsPerWeek) || 1, 1), DAY_COUNT);
    const mode = job.mode || "prefer";
    const candidates = candidateSlots(job, ctx.instructor, ctx.slots);
    if (!weeks.length) { report.explanation = ["No weeks selected."]; skipped.push({ job, reason: "No weeks selected" }); continue; }

    // Replace mode: lift this course's unlocked sessions out of the way first (restored per week if nothing replaces them).
    const lifted = [];
    if (job.replaceExisting) {
      Object.values(state.appointments || {}).filter(a => a && (job.custom ? (!a.courseId && a.courseName === course.name) : (a.courseId === job.courseId && (a.sectionId || "") === (job.sectionId || ""))) && !a.locked && weeks.includes(a.weekNum))
        .forEach(a => { lifted.push(a); index.remove(a); });
    }

    const placed = [];
    const missing = [];
    const usedDaysByWeek = new Map(weeks.map(w => [w, new Set()]));
    let lastRoom = null;

    const record = (week, k, holiday, usedDays) => {
      const d = diagnoseWeek(ctx, week, candidates, usedDays);
      missing.push({ weekNum: week, sessionIndex: k, holiday, tried: d.tried, reasons: d.reasons });
    };

    for (let k = 0; k < perWeek; k++) {
      let pattern = null;
      if (mode !== "free") {
        // Choose the weekly slot that works in the most weeks, then by soft preference.
        let best = null;
        for (const c of candidates) {
          if (!c.available) continue;
          let okWeeks = 0, score = 0;
          for (const w of weeks) {
            if (usedDaysByWeek.get(w).has(c.dayIdx)) continue;
            const ev = evaluate(ctx, w, c.dayIdx, c.timeId);
            if (ev.ok) { okWeeks++; score += softScore(ctx, w, c.dayIdx, c.timeId, null); }
          }
          if (okWeeks && (!best || okWeeks > best.okWeeks || (okWeeks === best.okWeeks && score > best.score))) best = { c, okWeeks, score };
        }
        pattern = best?.c || null;
      }
      const sessionsHere = [];
      for (const w of weeks) {
        const used = usedDaysByWeek.get(w);
        let appt = null;
        if (pattern && !used.has(pattern.dayIdx)) {
          const ev = evaluate(ctx, w, pattern.dayIdx, pattern.timeId);
          if (ev.ok) appt = commitSession(ctx, w, pattern.dayIdx, pattern.timeId, ev.freeRooms, lastRoom, makeId, course);
          else if (mode === "strict") {
            record(w, k, ev.reasons.length === 1 && ev.reasons[0].code === "holiday", used);
            continue;
          }
        } else if (mode === "strict") { // no workable pattern slot at all
          record(w, k, false, used);
          continue;
        }
        if (!appt) { // "prefer" fallback, or "free" mode
          const anchor = pattern || mostUsed(placed.concat(sessionsHere));
          appt = placeFlexible(ctx, w, candidates, used, anchor, lastRoom, makeId, course);
        }
        if (appt) { used.add(appt.dayIdx); lastRoom = appt.roomId; sessionsHere.push(appt); }
        else {
          // A week is a "holiday skip" (not a failure) when the only thing stopping every allowed time is a holiday.
          const why = diagnoseWeek(ctx, w, candidates, used).reasons;
          const holidayOnly = why.some(r => r.code === "holiday") && why.every(r => r.code === "holiday" || r.code === "unavailable");
          record(w, k, holidayOnly, used);
        }
      }
      placed.push(...sessionsHere);
    }

    const nonHolidayMissing = missing.filter(m => !m.holiday);
    if (job.requireAll && nonHolidayMissing.length) { // all-or-nothing: undo everything placed for this job
      placed.forEach(a => index.remove(a));
      report.placed = [];
      report.explanation = [`Everything was withdrawn because "all weeks or nothing" is on and ${nonHolidayMissing.length} session${nonHolidayMissing.length === 1 ? "" : "s"} could not be placed.`];
      const ex = explain(ctx, missing, weeks.length);
      report.explanation.push(...ex.lines); report.suggestions = ex.tips;
      lifted.forEach(a => index.add(a));
      report.missing = missing;
      skipped.push({ job, reason: report.explanation[0] });
      continue;
    }

    // Restore lifted sessions for weeks where nothing new replaced them.
    const weeksWithNew = new Set(placed.map(a => a.weekNum));
    const keep = lifted.filter(a => !weeksWithNew.has(a.weekNum));
    keep.forEach(a => index.add(a));
    const gone = lifted.filter(a => weeksWithNew.has(a.weekNum));
    report.removed = gone.map(a => a.id);
    removed.push(...report.removed);

    report.placed = placed;
    report.missing = missing;
    report.holidayWeeks = missing.filter(m => m.holiday).length;
    const expected = weeks.length * perWeek;
    report.status = !placed.length ? "none" : placed.length + report.holidayWeeks >= expected ? "full" : "partial";
    if (report.status !== "full") {
      const ex = explain(ctx, missing, weeks.length);
      report.explanation = ex.lines; report.suggestions = ex.tips;
    } else if (report.holidayWeeks) {
      report.explanation = [`${[...new Set(missing.filter(m => m.holiday).map(m => `W${m.weekNum}`))].join(", ")} were left empty because they are holidays.`];
    }
    scheduled.push(...placed);
    if (report.status === "none") skipped.push({ job, reason: report.explanation[0] || "No conflict-free time found" });
  }
  return { scheduled, removed, reports, skipped };
}

/**
 * For the job editor: how does each weekly time look right now (before running)?
 * Cell status: "unavailable" | "free" (works in every non-holiday week) | "partial" | "blocked".
 */
export function slotMatrix(state, job) {
  const index = makeIndex(state.appointments);
  const ctx = makeContext(state, job, index);
  const weeks = jobWeeks(job);
  const candidates = candidateSlots(job, ctx.instructor, ctx.slots);
  const cells = {};
  let feasible = 0;
  for (const c of candidates) {
    const key = `${c.dayIdx}_${c.timeId}`;
    if (!c.available) { cells[key] = { status: "unavailable", freeWeeks: 0, weeks: weeks.length, reasons: [] }; continue; }
    let free = 0, holidays = 0;
    const tally = new Map();
    for (const w of weeks) {
      const ev = evaluate(ctx, w, c.dayIdx, c.timeId);
      if (ev.ok) free++;
      else if (ev.reasons.length === 1 && ev.reasons[0].code === "holiday") holidays++;
      else ev.reasons.forEach(r => tally.set(r.code, (tally.get(r.code) || 0) + 1));
    }
    const usable = weeks.length - holidays;
    const status = free === usable && usable > 0 ? "free" : free > 0 ? "partial" : "blocked";
    if (status === "free") feasible++;
    cells[key] = { status, freeWeeks: free, weeks: weeks.length, holidays, reasons: [...tally].sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, count: n })) };
  }
  return { cells, feasible, needed: ctx.needed };
}
