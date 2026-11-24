// Conflict engine (pure). A clash is two sessions that overlap in time AND share
// an instructor, a room, or a student group. "Overlap in time" is defined in
// timeslots.js, so custom session times are respected everywhere.
import { sessionsOverlap } from "./timeslots.js";
import { groupRelations, groupClash } from "./groups.js";

// Student groups meet when they are the same group, or one is inside the other (Cohort 6 and Cohort 6 TH): a clash.
// Sub-groups of one parent that may share students (Cohort 6 TH and Cohort 6 CS) give a softer "possible overlap".
// Without the group list only identical groups are compared.
const relationsFor = groups => (groups && groups.length ? groupRelations(groups) : (a, b) => (a && a === b ? "same" : "none"));
const nameOf = (groups, id) => (groups || []).find(g => g.id === id)?.name || "a group";
function groupIssue(rel, groups, a, b) {
  const m = groupClash(rel, a.groupIds, b.groupIds);
  if (!m) return null;
  if (m.kind === "group") return { type: "group", label: m.relation === "same" ? "Student group clash" : `Student group clash: ${nameOf(groups, m.a)} and ${nameOf(groups, m.b)} share students` };
  return { type: "overlap", label: `Possible student overlap: ${nameOf(groups, m.a)} and ${nameOf(groups, m.b)}` };
}

// Two sessions of the same course that are different sections (e.g. "Group 1" and "Group 2") are meant to
// run at the same time: the cohort is split between them, so they don't clash on student groups.
const parallelSections = (a, b) => !!a.courseId && a.courseId === b.courseId && !!a.section && !!b.section && a.section !== b.section;

const norm = a => ({
  ...a,
  courseId: a.courseId || "",
  section: a.section || "",
  groupIds: Array.isArray(a.groupIds) ? a.groupIds : [],
  instructorId: a.instructorId || "",
  roomId: a.roomId || "",
  weekNum: a.weekNum ?? 0,
  dayIdx: a.dayIdx ?? 0,
  timeId: a.timeId || "",
});

/** Conflicts a (possibly unsaved) session would have with the existing ones. */
export function checkConflicts(appointments, appt, slots, excludeId = null, groups = null) {
  const out = [];
  const rel = relationsFor(groups);
  const cand = norm(appt);
  Object.values(appointments || {}).filter(Boolean).forEach(raw => {
    const a = norm(raw);
    if (a.id === excludeId || !sessionsOverlap(a, cand, slots)) return;
    const clash = a.courseName || a.courseCode;
    if (cand.instructorId && a.instructorId === cand.instructorId)
      out.push({ type: "instructor", label: "Instructor double-booked", clash });
    if (cand.roomId && a.roomId === cand.roomId)
      out.push({ type: "room", label: "Room already occupied", clash });
    const g = !parallelSections(a, cand) && groupIssue(rel, groups, cand, a);
    if (g) out.push({ ...g, clash });
  });
  return out;
}

/** Every clash in the timetable, as { type, a, b, label }. Sessions are bucketed by week+day first, so this stays fast. */
export function getAllConflicts(appointments, slots, groups = null) {
  const all = [];
  const rel = relationsFor(groups);
  // A clash is "overridden" when either session was saved with an override for that kind of clash.
  const ov = (a, b, t) => (Array.isArray(a.overrides) && a.overrides.includes(t)) || (Array.isArray(b.overrides) && b.overrides.includes(t));
  if (!appointments || typeof appointments !== "object") return all;
  const buckets = new Map();
  Object.values(appointments).filter(Boolean).map(norm).forEach(a => {
    const k = `${a.weekNum}_${a.dayIdx}`;
    (buckets.get(k) || buckets.set(k, []).get(k)).push(a);
  });
  buckets.forEach(list => {
    list.forEach((a, i) => {
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!sessionsOverlap(a, b, slots)) continue;
        if (a.instructorId && a.instructorId === b.instructorId)
          all.push({ type: "instructor", a, b, label: "Instructor double-booked", overridden: ov(a, b, "instructor") });
        if (a.roomId && a.roomId === b.roomId)
          all.push({ type: "room", a, b, label: "Room double-booked", overridden: ov(a, b, "room") });
        const g = !parallelSections(a, b) && groupIssue(rel, groups, a, b);
        if (g) all.push({ ...g, a, b, overridden: ov(a, b, g.type) });
      }
    });
  });
  return all;
}

// ── Helpers for the auto-scheduler: "is this whole slot free?" ───────────────
// A candidate placement occupies the whole slot (default times), so it is busy
// if anything overlapping that slot - including custom-time sessions - matches.
const probe = (weekNum, dayIdx, timeId) => ({ weekNum, dayIdx, timeId });
const busyWith = (appointments, weekNum, dayIdx, timeId, slots, matches) =>
  Object.values(appointments || {}).some(
    a => a && sessionsOverlap(a, probe(weekNum, dayIdx, timeId), slots) && matches(norm(a)));

export const isInstructorFreeAllWeeks = (appointments, instructorId, dayIdx, timeId, weeks, slots) =>
  weeks.every(wn => !busyWith(appointments, wn, dayIdx, timeId, slots, a => a.instructorId === instructorId));

export const areGroupsFreeAllWeeks = (appointments, groupIds, dayIdx, timeId, weeks, slots, groups = null) => {
  const rel = relationsFor(groups);
  return weeks.every(wn => !busyWith(appointments, wn, dayIdx, timeId, slots, a => groupClash(rel, a.groupIds, groupIds || [])?.kind === "group"));
};

export const isRoomFree = (appointments, roomId, weekNum, dayIdx, timeId, slots) =>
  !busyWith(appointments, weekNum, dayIdx, timeId, slots, a => a.roomId === roomId);
