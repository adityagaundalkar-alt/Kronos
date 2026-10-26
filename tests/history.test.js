import { describe, it, expect } from "vitest";
import { changesBetween, invert, applyChanges } from "../src/history.js";
import { emptyState } from "../src/state.js";

const base = () => ({ ...emptyState("T"), courses: [{ id: "c1", name: "Math", code: "M1", defaultGroupIds: [] }], appointments: { a1: { id: "a1", weekNum: 1, dayIdx: 0, timeId: "am", courseId: "c1", courseName: "Math", courseCode: "M1", groupIds: [] } } });

describe("undo / redo", () => {
  it("undoes a deleted session and redoes it", () => {
    const s0 = base(); const s1 = { ...s0, appointments: {} };
    const ch = changesBetween(s0, s1);
    expect(ch).toHaveLength(1);
    const u = applyChanges(s1, invert(ch));
    expect(u.state.appointments.a1.courseName).toBe("Math");
    const r = applyChanges(u.state, ch);
    expect(r.state.appointments).toEqual({});
  });
  it("undoes a bulk delete of courses in one step", () => {
    const s0 = { ...base(), courses: [{ id: "c1", name: "A", code: "A", defaultGroupIds: [] }, { id: "c2", name: "B", code: "B", defaultGroupIds: [] }] };
    const s1 = { ...s0, courses: [], appointments: {} };
    const u = applyChanges(s1, invert(changesBetween(s0, s1)));
    expect(u.state.courses.map(c => c.id).sort()).toEqual(["c1", "c2"]);
    expect(Object.keys(u.state.appointments)).toEqual(["a1"]);
  });
  it("skips items a teammate changed since, and keeps their work", () => {
    const s0 = base();
    const s1 = { ...s0, appointments: { a1: { ...s0.appointments.a1, dayIdx: 2 } } };
    const ch = changesBetween(s0, s1);
    const theirs = { ...s1, appointments: { a1: { ...s1.appointments.a1, dayIdx: 4 } } };
    const u = applyChanges(theirs, invert(ch));
    expect(u.skipped).toBe(1);
    expect(u.state.appointments.a1.dayIdx).toBe(4);
  });
  it("ignores the changelog", () => {
    const s0 = base(); const s1 = { ...s0, changelog: [{ at: 1, action: "x", detail: "" }] };
    expect(changesBetween(s0, s1)).toEqual([]);
  });
  it("undoes settings changes", () => {
    const s0 = base(); const s1 = { ...s0, week1Start: "2026-09-07" };
    expect(applyChanges(s1, invert(changesBetween(s0, s1))).state.week1Start).toBe(s0.week1Start);
  });
});
