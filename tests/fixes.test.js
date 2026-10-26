import { describe, it, expect } from "vitest";
import { suggestFixes } from "../src/fixes.js";
import { checkConflicts } from "../src/conflicts.js";

const slots = [{ id: "am", label: "09:00 – 12:00", short: "Morning" }, { id: "pm", label: "13:00 – 16:00", short: "Afternoon" }];
const A = (id, o = {}) => ({ id, weekNum: 1, dayIdx: 0, timeId: "am", courseId: id, courseName: id, groupIds: [], instructorId: "", roomId: "", ...o });
const st = (apps, extra = {}) => ({ slots, week1Start: "2026-09-07", holidays: [], groups: [{ id: "g", name: "G", size: 30 }], instructors: [], rooms: [{ id: "r1", name: "R1", capacity: 40 }, { id: "r2", name: "R2", capacity: 20 }, { id: "r3", name: "R3", capacity: 60 }], appointments: Object.fromEntries(apps.map(a => [a.id, a])), ...extra });

describe("suggestFixes", () => {
  it("offers times that clash with nothing, nearest first", () => {
    const a = A("a", { instructorId: "i" }), b = A("b", { instructorId: "i" });
    const s = st([a, b]);
    const { moves } = suggestFixes(s, a);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0].label).toBe("Mon Afternoon");
    moves.forEach(m => expect(checkConflicts(s.appointments, { ...a, ...m.changes }, slots, a.id)).toEqual([]));
  });
  it("skips holidays and unavailable times", () => {
    const a = A("a", { instructorId: "i" }), b = A("b", { instructorId: "i" });
    const s = st([a, b], { holidays: [{ id: "h", name: "Day off", date: "2026-09-07" }], instructors: [{ id: "i", name: "I", availability: { 1: ["am"] } }] });
    const { moves } = suggestFixes(s, a);
    expect(moves.map(m => m.label)).toEqual(["Tue Morning"]);
  });
  it("suggests free rooms that are big enough", () => {
    const a = A("a", { roomId: "r1", groupIds: ["g"] }), b = A("b", { roomId: "r1" });
    const { rooms } = suggestFixes(st([a, b]), a);
    expect(rooms.map(r => r.changes.roomId)).toEqual(["r3"]); // r2 is too small
  });
});
