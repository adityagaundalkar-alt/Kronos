import { describe, it, expect } from "vitest";
import { numberSessions, renumber, outOfOrder, newlyOutOfOrder, sessionLabel, buildPlan, suggestPlacements, runningCourses, targetOf, numberKey } from "../src/plan.js";

const SLOTS = [{ id: "am", label: "09:00-12:00" }, { id: "pm", label: "13:00-16:00" }];
const A = (id, weekNum, dayIdx = 0, timeId = "am", o = {}) => ({ id, weekNum, dayIdx, timeId, courseId: "c1", courseName: "English", courseCode: "E1", instructorId: "i1", groupIds: ["g"], roomId: "", ...o });
const S = (apps, o = {}) => ({ slots: SLOTS, courses: [{ id: "c1", name: "English", code: "E1", defaultInstructorId: "i1", defaultGroupIds: ["g"] }], instructors: [{ id: "i1", name: "Pete" }, { id: "i2", name: "Ann" }], groups: [{ id: "g", name: "G", size: 0 }], rooms: [{ id: "r1", name: "R1", capacity: 40, type: "lecture" }], holidays: [], appointments: Object.fromEntries(apps.map(a => [a.id, a])), ...o });

describe("session numbers", () => {
  it("numbers lectures and extra classes separately, by date, per section", () => {
    const s = numberSessions(S([A("b", 2), A("a", 1, 3), A("c", 1, 0, "pm"), A("x", 1, 1, "am", { kind: "extra" }), A("g2", 1, 0, "am", { sectionId: "s2" })]));
    const n = id => sessionLabel(s.appointments[id]);
    expect([n("c"), n("a"), n("b")]).toEqual(["S1", "S2", "S3"]);
    expect(n("x")).toBe("E1");
    expect(n("g2")).toBe("S1");
  });
  it("leaves custom events and numbered groups alone", () => {
    const s0 = S([A("a", 1, 0, "am", { num: 1 }), { id: "ev", weekNum: 1, dayIdx: 0, timeId: "am", courseId: "" }]);
    expect(numberSessions(s0)).toBe(s0);
    expect(sessionLabel(s0.appointments.ev)).toBe("");
  });
  it("a lecture added in the middle takes its place; a kept order only gets numbers at the end", () => {
    const s = numberSessions(S([A("a", 1, 0, "am", { num: 1 }), A("b", 3, 0, "am", { num: 2 }), A("new", 2)]));
    expect(["a", "new", "b"].map(i => s.appointments[i].num)).toEqual([1, 2, 3]);
    const kept = numberSessions(S([A("a", 1, 0, "am", { num: 2 }), A("b", 3, 0, "am", { num: 1 }), A("new", 2)]));
    expect(["a", "b", "new"].map(i => kept.appointments[i].num)).toEqual([2, 1, 3]);
  });
  it("finds groups a move put out of order, and renumbers them", () => {
    const prev = S([A("a", 1, 0, "am", { num: 1 }), A("b", 2, 0, "am", { num: 2 })]);
    const next = { ...prev, appointments: { ...prev.appointments, a: { ...prev.appointments.a, weekNum: 3 } } };
    const keys = newlyOutOfOrder(prev, next);
    expect([...keys]).toEqual([numberKey(prev.appointments.a)]);
    const fixed = renumber(next, keys);
    expect([fixed.appointments.b.num, fixed.appointments.a.num]).toEqual([1, 2]);
    expect(outOfOrder(fixed.appointments, SLOTS).size).toBe(0);
  });
  it("editing a number by hand is not a move, and a gap is not out of order", () => {
    const prev = S([A("a", 1, 0, "am", { num: 1 }), A("b", 2, 0, "am", { num: 2 })]);
    const next = { ...prev, appointments: { ...prev.appointments, a: { ...prev.appointments.a, num: 5 } } };
    expect(newlyOutOfOrder(prev, next).size).toBe(0);
    expect(outOfOrder({ a: A("a", 1, 0, "am", { num: 1 }), b: A("b", 2, 0, "am", { num: 3 }) }, SLOTS).size).toBe(0);
  });
});

describe("plan", () => {
  it("every course runs until some are chosen", () => {
    expect(runningCourses([{ id: "a" }, { id: "b" }])).toHaveLength(2);
    expect(runningCourses([{ id: "a", running: true }, { id: "b" }]).map(c => c.id)).toEqual(["a"]);
  });
  it("targets: section, then course, then 15", () => {
    expect(targetOf({}, null)).toBe(15);
    expect(targetOf({ targetSessions: 18 }, null)).toBe(18);
    expect(targetOf({ targetSessions: 18 }, { target: 16 })).toBe(16);
  });
  it("counts lectures per section, extra classes apart, and flags pace", () => {
    const courses = [{ id: "c1", name: "English", code: "E1", running: true, sections: [{ id: "s1", name: "G1", groupIds: ["g"] }, { id: "s2", name: "G2", groupIds: ["g"], target: 2 }] }, { id: "c2", name: "Maths", code: "M", sections: [] }];
    const apps = [
      A("a", 1, 0, "am", { sectionId: "s1" }), A("b", 4, 0, "am", { sectionId: "s1" }), A("c", 4, 1, "am", { sectionId: "s1" }), A("d", 4, 2, "am", { sectionId: "s1" }),
      A("e", 1, 0, "pm", { sectionId: "s2" }), A("f", 2, 0, "pm", { sectionId: "s2" }), A("g", 3, 0, "pm", { sectionId: "s2" }), A("h", 3, 1, "pm", { sectionId: "s2", kind: "extra" }),
      A("m", 1, 0, "am", { courseId: "c2" }),
    ];
    const { rows, stray } = buildPlan(S(apps, { courses }));
    const [g1, g2] = rows;
    expect(rows).toHaveLength(2);
    expect([g1.lectures.length, g1.missing, g1.pace.gaps, g1.pace.crowded]).toEqual([4, 11, [2, 3], [{ weekNum: 4, count: 3 }]]);
    expect([g2.lectures.length, g2.extras.length, g2.over, g2.missing]).toEqual([3, 1, 1, 0]);
    expect(stray.map(s => [s.course.id, s.count])).toEqual([["c2", 1]]);
  });
  it("lectures on a holiday are flagged", () => {
    const { rows } = buildPlan(S([A("a", 1, 2)], { week1Start: "2026-09-07", holidays: [{ date: "2026-09-09", name: "Founders Day" }] }));
    expect(rows[0].pace.onHoliday[0].name).toBe("Founders Day");
  });
  it("suggests free times in weeks without a lecture, usual time first, and fills only what is missing", () => {
    const s = S([A("a", 1, 3, "pm"), A("b", 2, 3, "pm"), A("busy", 3, 3, "pm", { courseId: "c9", instructorId: "i1" })]);
    const row = buildPlan(s).rows[0];
    let n = 0;
    const res = suggestPlacements(s, row, { weeks: [1, 2, 3, 4, 5], count: 3, makeId: () => "n" + (++n) });
    expect(res.perWeek.map(w => w.weekNum)).toEqual([3, 4, 5]);
    expect(res.perWeek[1].options[0]).toMatchObject({ dayIdx: 3, timeId: "pm", usual: true });
    expect(res.perWeek[0].options.some(o => o.dayIdx === 3 && o.timeId === "pm")).toBe(false); // the instructor is busy then
    expect(res.fill.map(a => [a.id, a.weekNum, a.kind, a.roomId])).toEqual([["n1", 3, "lecture", "r1"], ["n2", 4, "lecture", "r1"], ["n3", 5, "lecture", "r1"]]);
    expect(suggestPlacements(s, row, { weeks: [1, 2, 3], count: 5 }).short).toBe(4);
  });
});
