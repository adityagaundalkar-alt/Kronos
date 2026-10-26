import { describe, it, expect } from "vitest";
import { repeatWeeks, planRepeat } from "../src/repeat.js";

const slots = [{ id: "am", label: "09:00 – 12:00", short: "Morning" }];
let n = 0; const newId = () => "n" + ++n;
const base = { weekNum: 2, dayIdx: 1, timeId: "am", courseId: "", courseName: "Clinic", groupIds: ["g"], instructorId: "", roomId: "" };
const st = (extra = {}) => ({ slots, week1Start: "2026-09-07", holidays: [], appointments: {}, ...extra });

describe("repeat", () => {
  it("lists weeks every N from the start", () => {
    expect(repeatWeeks(2, 1, 5)).toEqual([2, 3, 4, 5]);
    expect(repeatWeeks(1, 2, 8)).toEqual([1, 3, 5, 7]);
    expect(repeatWeeks(3, 0, 9)).toEqual([3]);
  });
  it("skips weeks with a clash or a holiday and says which", () => {
    const s = st({ holidays: [{ id: "h", date: "2026-09-29" }], appointments: { x: { id: "x", weekNum: 5, dayIdx: 1, timeId: "am", groupIds: ["g"] } } });
    // week 4, day 1 = Tue 2026-09-29 (week 1 starts 2026-09-07)
    const r = planRepeat(s, base, { every: 1, until: 6, newId });
    expect(r.holiday).toEqual([4]);
    expect(r.clash).toEqual([5]);
    expect(r.toSave.map(a => a.weekNum)).toEqual([2, 3, 6]);
    expect(new Set(r.toSave.map(a => a.id)).size).toBe(3);
  });
});
