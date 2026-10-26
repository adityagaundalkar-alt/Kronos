import { describe, it, expect } from "vitest";
import { planMoves, shiftMoves } from "../src/move.js";

const slots = [{ id: "am", label: "a", short: "Morning" }, { id: "pm", label: "b", short: "Afternoon" }];
const A = (id, o = {}) => ({ id, weekNum: 1, dayIdx: 0, timeId: "am", courseId: id, courseName: id, groupIds: [], instructorId: "", roomId: "", ...o });
const st = (apps, extra = {}) => ({ slots, week1Start: "2026-09-07", holidays: [], appointments: Object.fromEntries(apps.map(a => [a.id, a])), ...extra });

describe("planMoves", () => {
  it("moves a session and keeps the rest", () => {
    const s = st([A("a"), A("b", { dayIdx: 2 })]);
    const r = planMoves(s, [{ id: "a", dayIdx: 1 }]);
    expect(r.appointments.a.dayIdx).toBe(1);
    expect(r.appointments.b.dayIdx).toBe(2);
    expect(r.moved).toEqual(["a"]);
    expect(r.newClashes).toBe(0);
  });
  it("counts clashes the move would create, not the ones already there", () => {
    const s = st([A("a", { instructorId: "i" }), A("b", { instructorId: "i", dayIdx: 1 }), A("c", { roomId: "r" }), A("d", { roomId: "r" })]);
    const r = planMoves(s, [{ id: "a", dayIdx: 1 }]);
    expect(r.newClashes).toBe(1); // a now meets b; c/d were already clashing
  });
  it("blocks holidays, the edges of the term and unknown slots", () => {
    const s = st([A("a")], { holidays: [{ id: "h", date: "2026-09-08" }] });
    expect(planMoves(s, [{ id: "a", dayIdx: 1 }]).blocked[0].reason).toMatch(/holiday/);
    expect(planMoves(s, [{ id: "a", weekNum: 17 }]).blocked).toHaveLength(1);
    expect(planMoves(s, [{ id: "a", dayIdx: 9 }]).blocked).toHaveLength(1);
    expect(planMoves(s, [{ id: "a", timeId: "zz" }]).blocked).toHaveLength(1);
    expect(planMoves(s, [{ id: "a", dayIdx: 1 }]).appointments.a.dayIdx).toBe(0);
  });
  it("drops a custom time when the slot changes", () => {
    const s = st([A("a", { start: "09:30", end: "11:00" })]);
    expect(planMoves(s, [{ id: "a", timeId: "pm" }]).appointments.a.start).toBeUndefined();
    expect(planMoves(s, [{ id: "a", dayIdx: 1 }]).appointments.a.start).toBe("09:30");
  });
  it("shiftMoves shifts a whole selection", () => {
    const s = st([A("a"), A("b", { dayIdx: 3, timeId: "pm" })]);
    const r = planMoves(s, shiftMoves(s, ["a", "b"], { weeks: 1 }));
    expect(r.appointments.a.weekNum).toBe(2);
    expect(r.appointments.b.weekNum).toBe(2);
    expect(r.appointments.b.dayIdx).toBe(3);
  });
});
