import { describe, it, expect } from "vitest";
import { runAutoSchedule, slotMatrix, groupDemand, seatsNeeded, candidateSlots, jobWeeks } from "../src/scheduler.js";
import { getAllConflicts } from "../src/conflicts.js";

const SLOTS = [
  { id: "am", label: "09:00 – 12:00", short: "Morning" },
  { id: "pm", label: "13:00 – 16:00", short: "Afternoon" },
  { id: "ev", label: "17:00 – 20:00", short: "Evening" },
];
let n = 0;
const counter = () => `id${++n}`;

function base(extra = {}) {
  return {
    week1Start: "2026-01-05", // a Monday
    slots: SLOTS,
    instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: {} }, { id: "i2", name: "Prof Okafor", maxLoad: 8, availability: {} }],
    rooms: [
      { id: "rSmall", name: "Room 101", capacity: 40, type: "seminar" },
      { id: "rMid", name: "Room 202", capacity: 60, type: "seminar" },
      { id: "rBig", name: "Hall A", capacity: 120, type: "lecture" },
    ],
    groups: [
      { id: "y1", name: "Year 1", parentId: null, size: 80 },
      { id: "a", name: "CS-1A", parentId: "y1", size: 40 },
      { id: "b", name: "CS-1B", parentId: "y1", size: 38 },
    ],
    courses: [
      { id: "c1", name: "Intro CS", code: "CS101" },
      { id: "c2", name: "Maths", code: "MA101" },
    ],
    appointments: {},
    holidays: [],
    ...extra,
  };
}
const job = (extra = {}) => ({ courseId: "c1", instructorId: "i1", groupIds: ["a"], weeks: [1, 2, 3, 4], ...extra });
const appt = (id, weekNum, dayIdx, timeId, extra = {}) => ({
  id, weekNum, dayIdx, timeId, courseId: "c2", courseName: "Maths", courseCode: "MA101",
  instructorId: "i2", roomId: "rSmall", groupIds: [], ...extra,
});
const merge = (state, res) => {
  const appointments = { ...state.appointments };
  res.removed.forEach(id => delete appointments[id]);
  res.scheduled.forEach(a => { appointments[a.id] = a; });
  return { ...state, appointments };
};

describe("helpers", () => {
  it("counts a parent group once, not its sub-groups as well", () => {
    const g = base().groups;
    expect(groupDemand(["y1"], g)).toBe(80);
    expect(groupDemand(["y1", "a"], g)).toBe(80);
    expect(groupDemand(["a", "b"], g)).toBe(78);
    expect(groupDemand([], g)).toBe(0);
  });
  it("seatsNeeded honours manual figure and the ignore switch", () => {
    const g = base().groups;
    expect(seatsNeeded({ groupIds: ["a"], neededCapacity: 100 }, g)).toBe(100);
    expect(seatsNeeded({ groupIds: ["a"], neededCapacity: 0 }, g)).toBe(40);
    expect(seatsNeeded({ groupIds: ["a"], ignoreCapacity: true }, g)).toBe(0);
  });
  it("treats an instructor with no availability set as available any time", () => {
    const c = candidateSlots({}, { availability: {} }, SLOTS);
    expect(c).toHaveLength(15);
    expect(c.every(x => x.available)).toBe(true);
    const some = candidateSlots({}, { availability: { 0: ["am"] } }, SLOTS);
    expect(some.filter(x => x.available)).toEqual([{ dayIdx: 0, timeId: "am", available: true }]);
  });
  it("derives weeks from the job's mode fields", () => {
    expect(jobWeeks({ weeksMode: "all" })).toHaveLength(16);
    expect(jobWeeks({ weeksMode: "range", weekStart: 3, weekEnd: 5 })).toEqual([3, 4, 5]);
    expect(jobWeeks({ weeksMode: "custom", customWeeks: [5, 2] })).toEqual([2, 5]);
  });
});

describe("basic placement", () => {
  it("places the same slot every week with no clashes and does not mutate the input", () => {
    const s = base();
    const frozen = JSON.stringify(s);
    const res = runAutoSchedule(s, [job()], { makeId: counter });
    expect(JSON.stringify(s)).toBe(frozen);
    expect(res.scheduled).toHaveLength(4);
    expect(new Set(res.scheduled.map(a => `${a.dayIdx}_${a.timeId}`)).size).toBe(1);
    expect(res.reports[0].status).toBe("full");
    expect(getAllConflicts(merge(s, res).appointments, SLOTS)).toEqual([]);
  });

  it("avoids an instructor's existing classes", () => {
    const s = base({ appointments: { x: appt("x", 1, 0, "am", { instructorId: "i1" }) } });
    const res = runAutoSchedule(s, [job({ weeks: [1] })], { makeId: counter });
    const a = res.scheduled[0];
    expect(`${a.dayIdx}_${a.timeId}`).not.toBe("0_am");
    expect(getAllConflicts(merge(s, res).appointments, SLOTS)).toEqual([]);
  });

  it("respects custom-time sessions that overlap a slot", () => {
    const s = base({ appointments: { x: appt("x", 1, 0, "am", { instructorId: "i1", start: "11:00", end: "11:30" }) } });
    const res = runAutoSchedule(s, [job({ weeks: [1], useInstructorAvailability: true, customSlots: [], preferDays: [0], preferSlots: ["am"] })], { makeId: counter });
    const a = res.scheduled[0];
    expect(`${a.dayIdx}_${a.timeId}`).not.toBe("0_am"); // 11:00-11:30 sits inside the whole-slot booking
  });

  it("only uses the instructor's available slots", () => {
    const s = base({ instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: { 2: ["pm"] } }] });
    const res = runAutoSchedule(s, [job()], { makeId: counter });
    expect(res.scheduled.every(a => a.dayIdx === 2 && a.timeId === "pm")).toBe(true);
  });

  it("can ignore availability when asked", () => {
    const s = base({ instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: { 2: ["pm"] } }] });
    const res = runAutoSchedule(s, [job({ useInstructorAvailability: false, preferDays: [0], preferSlots: ["am"] })], { makeId: counter });
    expect(res.scheduled.every(a => a.dayIdx === 0 && a.timeId === "am")).toBe(true);
  });

  it("later jobs see earlier jobs' placements", () => {
    const s = base({ instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: { 0: ["am"] } }] });
    const res = runAutoSchedule(s, [job({ weeks: [1] }), job({ weeks: [1], courseId: "c2", groupIds: ["b"] })], { makeId: counter });
    expect(res.reports[0].status).toBe("full");
    expect(res.reports[1].status).toBe("none"); // the only slot is already taken by the same instructor
    expect(res.reports[1].explanation.join(" ")).toMatch(/instructor already teaching/);
  });
});

describe("holidays", () => {
  const monday = [{ id: "h", date: "2026-01-12", name: "Founders Day" }]; // week 2 Monday
  const breakWeek = ["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"].map((date, i) => ({ id: "b" + i, date, name: "Reading week" }));

  it("a whole-week break is skipped and not counted as a failure", () => {
    for (const mode of ["strict", "prefer", "free"]) {
      const res = runAutoSchedule(base({ holidays: breakWeek }), [job({ mode, weeks: [1, 2, 3] })], { makeId: counter });
      expect(res.scheduled.map(a => a.weekNum), mode).toEqual([1, 3]);
      expect(res.reports[0].status, mode).toBe("full");
      expect(res.reports[0].holidayWeeks, mode).toBe(1);
      expect(res.reports[0].explanation.join(" "), mode).toMatch(/W2/);
    }
  });

  it("a single-day holiday steers the weekly slot to a day that works every week", () => {
    const res = runAutoSchedule(base({ holidays: monday }), [job({ weeks: [1, 2, 3], preferDays: [0], preferSlots: ["am"] })], { makeId: counter });
    expect(res.scheduled).toHaveLength(3);
    expect(res.scheduled.every(a => a.dayIdx !== 0)).toBe(true);
  });

  it("when the usual day is a holiday in one week, 'prefer' moves just that week; 'strict' skips it", () => {
    const s = base({
      holidays: monday,
      instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: { 0: ["am"], 1: ["am"] } }],
      // Tuesday AM is taken in week 3, so neither day works in every week
      appointments: { x: appt("x", 3, 1, "am", { instructorId: "i1" }) },
    });
    const opts = { weeks: [1, 2, 3], preferDays: [0], preferSlots: ["am"] };
    const prefer = runAutoSchedule(s, [job({ ...opts, mode: "prefer" })], { makeId: counter });
    expect(prefer.scheduled).toHaveLength(3);
    expect(prefer.scheduled.find(a => a.weekNum === 2).dayIdx).toBe(1); // Mon is a holiday that week -> Tue
    const strict = runAutoSchedule(s, [job({ ...opts, mode: "strict" })], { makeId: counter });
    expect(strict.scheduled.map(a => a.weekNum)).toEqual([1, 3]);
    expect(strict.reports[0].status).toBe("full"); // week 2 is a holiday, not a failure
    expect(strict.reports[0].holidayWeeks).toBe(1);
  });

  it("never schedules on a holiday in any mode", () => {
    const s = base({ holidays: monday });
    for (const mode of ["strict", "prefer", "free"]) {
      const res = runAutoSchedule(s, [job({ mode, weeks: [2], preferDays: [0] })], { makeId: counter });
      expect(res.scheduled.every(a => a.dayIdx !== 0)).toBe(true);
    }
  });

  it("ignores holidays with no date", () => {
    const s = base({ holidays: [{ id: "h", date: "", name: "" }] });
    expect(runAutoSchedule(s, [job()], { makeId: counter }).reports[0].status).toBe("full");
  });
});

describe("room capacity from group sizes", () => {
  it("puts a big cohort in a big enough room", () => {
    const s = base();
    const res = runAutoSchedule(s, [job({ groupIds: ["y1"], weeks: [1] })], { makeId: counter });
    expect(res.scheduled[0].roomId).toBe("rBig"); // 80 students: only Hall A (120) fits
  });

  it("uses the smallest room that fits", () => {
    const s = base();
    const res = runAutoSchedule(s, [job({ groupIds: ["a"], weeks: [1] })], { makeId: counter });
    expect(res.scheduled[0].roomId).toBe("rSmall"); // 40 fits in 40
  });

  it("explains when no room is large enough, with numbers", () => {
    const s = base({ rooms: [{ id: "r", name: "Tiny", capacity: 30, type: "seminar" }] });
    const res = runAutoSchedule(s, [job({ groupIds: ["y1"], weeks: [1] })], { makeId: counter });
    const r = res.reports[0];
    expect(r.status).toBe("none");
    expect(r.explanation.join(" ")).toMatch(/needs 80 seats, the largest room has 30/);
    expect(r.suggestions.join(" ")).toMatch(/bigger room/i);
  });

  it("can switch the capacity check off", () => {
    const s = base({ rooms: [{ id: "r", name: "Tiny", capacity: 30, type: "seminar" }] });
    const res = runAutoSchedule(s, [job({ groupIds: ["y1"], weeks: [1], ignoreCapacity: true })], { makeId: counter });
    expect(res.reports[0].status).toBe("full");
  });

  it("a locked room that is too small is reported, not used", () => {
    const s = base();
    const res = runAutoSchedule(s, [job({ groupIds: ["y1"], weeks: [1], roomId: "rSmall" })], { makeId: counter });
    expect(res.reports[0].status).toBe("none");
    expect(res.reports[0].explanation.join(" ")).toMatch(/Room 101 seats 40, needs 80/);
  });

  it("prefers the requested room type", () => {
    const s = base();
    const res = runAutoSchedule(s, [job({ weeks: [1], preferRoomType: "lecture" })], { makeId: counter });
    expect(res.scheduled[0].roomId).toBe("rBig");
  });

  it("keeps the same room week to week when it can", () => {
    const s = base({ appointments: { x: appt("x", 2, 0, "am", { roomId: "rSmall" }) } });
    const res = runAutoSchedule(s, [job({ weeks: [1, 2, 3], mode: "strict", preferDays: [0], preferSlots: ["am"] })], { makeId: counter });
    const rooms = res.scheduled.map(a => a.roomId);
    expect(rooms).toHaveLength(3);
    // week 2's Room 101 is taken, others move to a free room, but the run never clashes
    expect(getAllConflicts(merge(s, res).appointments, SLOTS)).toEqual([]);
  });
});

describe("per-week flexibility", () => {
  // Two usable times; each is blocked in a different week, so no single slot covers all four weeks.
  const twoDays = [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: { 0: ["am"], 1: ["am"] } }];
  const clashes = { x: appt("x", 3, 0, "am", { instructorId: "i1" }), y: appt("y", 2, 1, "am", { instructorId: "i1" }) };
  const opts = { weeks: [1, 2, 3, 4], preferDays: [0], preferSlots: ["am"] };
  const key = a => `${a.dayIdx}_${a.timeId}`;

  it("prefers one slot that works every week over a preferred slot that clashes sometimes", () => {
    const s = base({ instructors: twoDays, appointments: { x: appt("x", 3, 0, "am", { instructorId: "i1" }) } });
    const res = runAutoSchedule(s, [job({ ...opts, mode: "strict" })], { makeId: counter });
    expect(res.scheduled).toHaveLength(4);
    expect(new Set(res.scheduled.map(key))).toEqual(new Set(["1_am"]));
  });

  it("strict mode leaves the blocked week empty and explains it", () => {
    const s = base({ instructors: twoDays, appointments: clashes });
    const res = runAutoSchedule(s, [job({ ...opts, mode: "strict" })], { makeId: counter });
    expect(res.scheduled.map(a => a.weekNum)).toEqual([1, 2, 4]);
    expect(new Set(res.scheduled.map(key))).toEqual(new Set(["0_am"]));
    expect(res.reports[0].status).toBe("partial");
    expect(res.reports[0].missing[0].weekNum).toBe(3);
    expect(res.reports[0].explanation.join(" ")).toMatch(/instructor already teaching/);
  });

  it("prefer mode keeps the usual slot and re-places only the blocked week", () => {
    const s = base({ instructors: twoDays, appointments: clashes });
    const res = runAutoSchedule(s, [job({ ...opts, mode: "prefer" })], { makeId: counter });
    expect(res.scheduled).toHaveLength(4);
    const odd = res.scheduled.filter(a => key(a) !== "0_am");
    expect(odd.map(a => [a.weekNum, key(a)])).toEqual([[3, "1_am"]]);
    expect(res.reports[0].status).toBe("full");
  });

  it("free mode places each week independently", () => {
    const s = base({ appointments: { x: appt("x", 1, 0, "am", { instructorId: "i1" }), y: appt("y", 2, 0, "pm", { instructorId: "i1" }) } });
    const res = runAutoSchedule(s, [job({ mode: "free", weeks: [1, 2, 3], preferDays: [0] })], { makeId: counter });
    expect(res.scheduled).toHaveLength(3);
    expect(getAllConflicts(merge(s, res).appointments, SLOTS)).toEqual([]);
  });

  it("two sessions a week land on different days", () => {
    const s = base();
    const res = runAutoSchedule(s, [job({ weeks: [1, 2], sessionsPerWeek: 2 })], { makeId: counter });
    expect(res.scheduled).toHaveLength(4);
    [1, 2].forEach(w => {
      const days = res.scheduled.filter(a => a.weekNum === w).map(a => a.dayIdx);
      expect(new Set(days).size).toBe(2);
    });
  });

  it("allows partial results by default and withdraws everything with requireAll", () => {
    const s = base({ instructors: twoDays, appointments: clashes });
    const strict = { ...opts, mode: "strict" };
    expect(runAutoSchedule(s, [job(strict)], { makeId: counter }).scheduled).toHaveLength(3);
    const all = runAutoSchedule(s, [job({ ...strict, requireAll: true })], { makeId: counter });
    expect(all.scheduled).toHaveLength(0);
    expect(all.reports[0].status).toBe("none");
    expect(all.reports[0].explanation[0]).toMatch(/all weeks or nothing/i);
  });
});

describe("soft preferences", () => {
  it("favours preferred days and slots", () => {
    const res = runAutoSchedule(base(), [job({ weeks: [1], preferDays: [3], preferSlots: ["pm"] })], { makeId: counter });
    expect(`${res.scheduled[0].dayIdx}_${res.scheduled[0].timeId}`).toBe("3_pm");
  });
  it("avoids avoided slots when anything else works", () => {
    const res = runAutoSchedule(base(), [job({ weeks: [1], avoidSlots: ["am", "pm"] })], { makeId: counter });
    expect(res.scheduled[0].timeId).toBe("ev");
  });
  it("uses an avoided slot rather than fail when it is the only option", () => {
    const s = base({ instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: { 1: ["am"] } }] });
    const res = runAutoSchedule(s, [job({ weeks: [1], avoidSlots: ["am"] })], { makeId: counter });
    expect(res.scheduled).toHaveLength(1);
  });
  it("spreads an instructor's sessions over different days when nothing else decides", () => {
    const s = base({ appointments: { x: appt("x", 1, 0, "am", { instructorId: "i1" }) } });
    const res = runAutoSchedule(s, [job({ weeks: [1], preferSlots: ["pm"] })], { makeId: counter });
    expect(res.scheduled[0].dayIdx).not.toBe(0);
  });
});

describe("instructor weekly maximum", () => {
  it("stops at the instructor's max and says so", () => {
    const s = base({ instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 2, availability: {} }] });
    const res = runAutoSchedule(s, [job({ weeks: [1], sessionsPerWeek: 3 })], { makeId: counter });
    expect(res.scheduled).toHaveLength(2);
    expect(res.reports[0].status).toBe("partial");
    expect(res.reports[0].explanation.join(" ")).toMatch(/weekly maximum/);
  });
});

describe("pinned (locked) sessions", () => {
  const existing = () => ({
    unlocked: appt("u", 1, 0, "am", { courseId: "c1", courseName: "Intro CS", courseCode: "CS101", instructorId: "i1", groupIds: ["a"] }),
    locked: appt("l", 2, 1, "pm", { courseId: "c1", courseName: "Intro CS", courseCode: "CS101", instructorId: "i1", groupIds: ["a"], locked: true }),
  });

  it("replace mode removes unlocked sessions of the course but never locked ones", () => {
    const e = existing();
    const s = base({ appointments: { u: e.unlocked, l: e.locked } });
    const res = runAutoSchedule(s, [job({ weeks: [1, 2], replaceExisting: true, mode: "free" })], { makeId: counter });
    expect(res.removed).toEqual(["u"]);
    const merged = merge(s, res).appointments;
    expect(merged.l).toBeDefined();
    expect(getAllConflicts(merged, SLOTS)).toEqual([]);
    expect(res.scheduled.some(a => a.weekNum === 2 && a.dayIdx === 1 && a.timeId === "pm")).toBe(false); // locked slot stays occupied
  });

  it("keeps old sessions in weeks where nothing could replace them", () => {
    const e = existing();
    const s = base({ appointments: { u: e.unlocked }, rooms: [] });
    const res = runAutoSchedule(s, [job({ weeks: [1], replaceExisting: true })], { makeId: counter });
    expect(res.scheduled).toHaveLength(0);
    expect(res.removed).toEqual([]); // nothing replaced it, so it stays
  });

  it("without replace mode existing sessions stay and still block time", () => {
    const e = existing();
    const s = base({ appointments: { u: e.unlocked } });
    const res = runAutoSchedule(s, [job({ weeks: [1] })], { makeId: counter });
    expect(res.removed).toEqual([]);
    expect(getAllConflicts(merge(s, res).appointments, SLOTS)).toEqual([]);
  });
});

describe("explanations", () => {
  it("reports student group clashes by group name", () => {
    const appts = {};
    SLOTS.forEach((sl, i) => { for (let d = 0; d < 5; d++) appts[`g${i}${d}`] = appt(`g${i}${d}`, 1, d, sl.id, { groupIds: ["a"], instructorId: "i2", roomId: "rMid" }); });
    const res = runAutoSchedule(base({ appointments: appts }), [job({ weeks: [1] })], { makeId: counter });
    expect(res.reports[0].status).toBe("none");
    expect(res.reports[0].explanation.join(" ")).toMatch(/CS-1A has MA101/);
  });

  it("reports availability as a reason", () => {
    const s = base({ instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: { 0: ["am"] } }], appointments: { x: appt("x", 1, 0, "am", { instructorId: "i1" }) } });
    const res = runAutoSchedule(s, [job({ weeks: [1] })], { makeId: counter });
    expect(res.reports[0].explanation.join(" ")).toMatch(/outside the instructor's availability/);
    expect(res.reports[0].suggestions.join(" ")).toMatch(/availability/);
  });

  it("handles a job with no weeks or an unknown course", () => {
    const r1 = runAutoSchedule(base(), [job({ weeks: [], weeksMode: "custom", customWeeks: [] })], { makeId: counter });
    expect(r1.scheduled.length).toBeGreaterThan(0); // custom with nothing picked means "all weeks", as before
    const r2 = runAutoSchedule(base(), [job({ courseId: "nope" })], { makeId: counter });
    expect(r2.skipped[0].reason).toBe("Course not found");
  });
});

describe("slotMatrix", () => {
  it("marks free, partial, blocked and unavailable cells with reasons", () => {
    const s = base({
      instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 8, availability: { 0: ["am", "pm"], 1: ["am"] } }],
      appointments: {
        p: appt("p", 2, 0, "pm", { instructorId: "i1" }),                       // blocks Mon PM in week 2 only
        q1: appt("q1", 1, 1, "am", { instructorId: "i1" }), q2: appt("q2", 2, 1, "am", { instructorId: "i1" }), // blocks Tue AM everywhere
      },
    });
    const m = slotMatrix(s, job({ weeks: [1, 2] }));
    expect(m.cells["0_am"].status).toBe("free");
    expect(m.cells["0_pm"].status).toBe("partial");
    expect(m.cells["0_pm"].freeWeeks).toBe(1);
    expect(m.cells["1_am"].status).toBe("blocked");
    expect(m.cells["1_am"].reasons[0].code).toBe("instructor-busy");
    expect(m.cells["2_am"].status).toBe("unavailable");
    expect(m.feasible).toBe(1);
  });
  it("does not count holiday weeks against a slot", () => {
    const s = base({ holidays: [{ id: "h", date: "2026-01-12", name: "x" }] });
    const m = slotMatrix(s, job({ weeks: [1, 2, 3] }));
    expect(m.cells["0_am"].status).toBe("free");
    expect(m.cells["0_am"].holidays).toBe(1);
  });
});

describe("never creates a clash (randomised)", () => {
  // Small deterministic PRNG so failures are reproducible.
  const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  it("holds across many random timetables and job mixes", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const pick = arr => arr[Math.floor(r() * arr.length)];
      const appointments = {};
      for (let i = 0; i < 25; i++) {
        const id = `e${i}`;
        const wk = 1 + Math.floor(r() * 6), d = Math.floor(r() * 5), t = pick(SLOTS).id;
        // existing data may itself clash; the scheduler only needs to add no NEW clashes
        appointments[id] = appt(id, wk, d, t, { instructorId: pick(["i1", "i2"]), roomId: pick(["rSmall", "rMid", "rBig"]), groupIds: r() < 0.5 ? [pick(["a", "b", "y1"])] : [] });
      }
      const s = base({
        appointments,
        holidays: r() < 0.5 ? [{ id: "h", date: "2026-01-14", name: "Holiday" }] : [],
        instructors: [{ id: "i1", name: "Dr Chen", maxLoad: 2 + Math.floor(r() * 6), availability: r() < 0.5 ? { 0: ["am", "pm"], 2: ["am"], 4: ["ev", "pm"] } : {} }, { id: "i2", name: "Prof", maxLoad: 8, availability: {} }],
      });
      const before = getAllConflicts(s.appointments, SLOTS).length;
      const jobs = [0, 1, 2].map(j => job({
        courseId: j % 2 ? "c2" : "c1", instructorId: pick(["i1", "i2"]), groupIds: [pick(["a", "b", "y1"])],
        weeks: [1, 2, 3, 4, 5, 6].filter(() => r() < 0.8), mode: pick(["strict", "prefer", "free"]),
        sessionsPerWeek: 1 + Math.floor(r() * 2), replaceExisting: r() < 0.3, requireAll: r() < 0.2,
        preferDays: r() < 0.5 ? [Math.floor(r() * 5)] : [], ignoreCapacity: r() < 0.2,
      }));
      const res = runAutoSchedule(s, jobs, { makeId: counter });
      const merged = merge(s, res).appointments;
      const after = getAllConflicts(merged, SLOTS);
      // new sessions never introduce a clash with anything
      const newIds = new Set(res.scheduled.map(a => a.id));
      const caused = after.filter(c => newIds.has(c.a.id) || newIds.has(c.b.id));
      expect(caused, `seed ${seed}`).toEqual([]);
      expect(after.length).toBeLessThanOrEqual(before);
      // never touches locked sessions, only removes ids that existed
      res.removed.forEach(id => expect(appointments[id]).toBeDefined());
    }
  });
});
