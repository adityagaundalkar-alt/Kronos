import { describe, it, expect } from "vitest";
import { checkConflicts, getAllConflicts } from "../src/conflicts.js";

const slots = [{ id: "am", label: "09:00 – 12:00", short: "Morning" }, { id: "pm", label: "13:00 – 16:00", short: "Afternoon" }];
const A = (id, o = {}) => ({ id, weekNum: 1, dayIdx: 0, timeId: "am", courseId: "c1", instructorId: "", roomId: "", groupIds: ["g1"], section: "", ...o });

describe("conflicts", () => {
  it("flags a shared group at the same time", () => {
    const all = getAllConflicts({ a: A("a", { courseId: "c1" }), b: A("b", { courseId: "c2" }) }, slots);
    expect(all.map(c => c.type)).toEqual(["group"]);
  });
  it("same course, different sections: the cohort is split, so no group clash", () => {
    const apps = { a: A("a", { section: "G1", instructorId: "i1" }), b: A("b", { section: "G2", instructorId: "i2" }) };
    expect(getAllConflicts(apps, slots)).toEqual([]);
    expect(checkConflicts(apps, A("c", { section: "G3", instructorId: "i3" }), slots)).toEqual([]);
  });
  it("sections still clash on the instructor or the room", () => {
    const apps = { a: A("a", { section: "G1", instructorId: "i1", roomId: "r1" }), b: A("b", { section: "G2", instructorId: "i1", roomId: "r1" }) };
    expect(getAllConflicts(apps, slots).map(c => c.type).sort()).toEqual(["instructor", "room"]);
  });
  it("the same section twice, or a missing section, is still a clash", () => {
    expect(getAllConflicts({ a: A("a", { section: "G1" }), b: A("b", { section: "G1" }) }, slots).map(c => c.type)).toEqual(["group"]);
    expect(getAllConflicts({ a: A("a", { section: "G1" }), b: A("b") }, slots).map(c => c.type)).toEqual(["group"]);
  });
  it("different courses with different sections still clash", () => {
    expect(getAllConflicts({ a: A("a", { section: "G1" }), b: A("b", { courseId: "c2", section: "G2" }) }, slots).map(c => c.type)).toEqual(["group"]);
  });
  it("different slots or days never clash", () => {
    expect(getAllConflicts({ a: A("a"), b: A("b", { timeId: "pm" }), c: A("c", { dayIdx: 1 }) }, slots)).toEqual([]);
  });
});
