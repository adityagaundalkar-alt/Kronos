import { describe, it, expect } from "vitest";
import { makeVersion, stateFromVersion, versionsToPrune } from "../src/versions.js";
import { emptyState } from "../src/state.js";

const st = () => ({ ...emptyState("Sep 2026"), courses: [{ id: "c1", name: "Math", code: "M1", defaultGroupIds: [] }], appointments: { a1: { id: "a1", weekNum: 1, dayIdx: 0, timeId: "am", courseId: "c1", courseName: "Math", courseCode: "M1", groupIds: [] } }, changelog: [{ at: 1, action: "x" }] });

describe("versions", () => {
  it("round-trips a timetable without the activity log", () => {
    const v = makeVersion(st(), { name: "Before import", by: "Aadi" });
    expect(v.sessions).toBe(1); expect(v.courses).toBe(1); expect(JSON.parse(v.data).changelog).toBeUndefined();
    const back = stateFromVersion(v, { ...emptyState("Renamed"), changelog: [{ at: 9, action: "now" }] });
    expect(back.appointments.a1.courseName).toBe("Math");
    expect(back.settings.semester).toBe("Renamed"); // the term keeps its current name
    expect(back.changelog).toEqual([{ at: 9, action: "now" }]);
  });
  it("prunes automatic versions first, oldest first", () => {
    const list = [{ id: "1", at: 1, kind: "manual" }, { id: "2", at: 2, kind: "auto" }, { id: "3", at: 3, kind: "auto" }, { id: "4", at: 4, kind: "manual" }];
    expect(versionsToPrune(list, 3)).toEqual(["2"]);
    expect(versionsToPrune(list, 2)).toEqual(["2", "3"]);
    expect(versionsToPrune(list, 1)).toEqual(["2", "3", "1"]);
    expect(versionsToPrune(list, 10)).toEqual([]);
  });
  it("a long name is cut to the rules' limit", () => {
    expect(makeVersion(st(), { name: "x".repeat(500) }).name).toHaveLength(120);
  });
});
