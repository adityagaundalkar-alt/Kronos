import { describe, it, expect } from "vitest";
import { toMinutes, fromMinutes, slotRange, customRange, apptRange, sessionsOverlap, customLabel, timeLabel, startKey, validateCustomTimes } from "../src/timeslots.js";
import { checkConflicts, getAllConflicts, isInstructorFreeAllWeeks, areGroupsFreeAllWeeks, isRoomFree } from "../src/conflicts.js";

const slots = [
  { id: "am", short: "Morning", label: "09:00 – 12:00" },
  { id: "pm", short: "Afternoon", label: "13:00 – 16:00" },
  { id: "ev", short: "Evening", label: "17:00 - 20:00" },   // plain hyphen
  { id: "x", short: "Flexible", label: "Whenever" },          // no parsable times
];
const S = (id, o = {}) => ({ id, weekNum: 1, dayIdx: 0, timeId: "am", courseName: id, instructorId: "", roomId: "", groupIds: [], ...o });

describe("time parsing", () => {
  it("toMinutes / fromMinutes", () => {
    expect(toMinutes("09:30")).toBe(570); expect(toMinutes("9:05")).toBe(545);
    expect(toMinutes("24:00")).toBeNull(); expect(toMinutes("12:60")).toBeNull(); expect(toMinutes("")).toBeNull(); expect(toMinutes(undefined)).toBeNull();
    expect(fromMinutes(570)).toBe("09:30"); expect(fromMinutes(0)).toBe("00:00");
  });
  it("slotRange understands en dash, em dash and hyphen, and rejects text-only labels", () => {
    expect(slotRange(slots[0])).toEqual({ start: 540, end: 720 });
    expect(slotRange(slots[2])).toEqual({ start: 1020, end: 1200 });
    expect(slotRange({ label: "09:00 — 12:00" })).toEqual({ start: 540, end: 720 });
    expect(slotRange(slots[3])).toBeNull();
    expect(slotRange({ label: "12:00 – 09:00" })).toBeNull();
  });
  it("customRange needs both valid times with start < end", () => {
    expect(customRange({ start: "10:00", end: "11:30" })).toEqual({ start: 600, end: 690 });
    expect(customRange({ start: "10:00" })).toBeNull();
    expect(customRange({ start: "11:00", end: "10:00" })).toBeNull();
    expect(customRange({})).toBeNull();
  });
  it("labels and sort keys", () => {
    expect(customLabel({ start: "10:00", end: "11:30" })).toBe("10:00–11:30");
    expect(timeLabel(S("a"), slots)).toBe("09:00 – 12:00");
    expect(timeLabel(S("a", { start: "10:00", end: "11:30" }), slots)).toBe("10:00–11:30");
    expect(startKey(S("a", { start: "10:00", end: "11:00" }), slots)).toBe(600);
    expect(startKey(S("a"), slots)).toBe(540);
    expect(startKey(S("a", { timeId: "x" }), slots)).toBeGreaterThan(10000); // unknown sorts last
  });
});

describe("overlap rules", () => {
  it("two default sessions in the same slot overlap (unchanged behaviour)", () => {
    expect(sessionsOverlap(S("a"), S("b"), slots)).toBe(true);
  });
  it("different slots, different days, different weeks never overlap", () => {
    expect(sessionsOverlap(S("a"), S("b", { timeId: "pm" }), slots)).toBe(false);
    expect(sessionsOverlap(S("a"), S("b", { dayIdx: 1 }), slots)).toBe(false);
    expect(sessionsOverlap(S("a"), S("b", { weekNum: 2 }), slots)).toBe(false);
  });
  it("custom times in the same slot: only real overlap clashes", () => {
    const a = S("a", { start: "09:00", end: "10:30" });
    expect(sessionsOverlap(a, S("b", { start: "10:00", end: "11:00" }), slots)).toBe(true);
    expect(sessionsOverlap(a, S("b", { start: "10:30", end: "12:00" }), slots)).toBe(false); // back-to-back is fine
    expect(sessionsOverlap(a, S("b", { start: "11:00", end: "12:00" }), slots)).toBe(false);
  });
  it("a custom session vs a default (whole-slot) session overlaps when it sits inside the slot", () => {
    expect(sessionsOverlap(S("a", { start: "10:00", end: "11:00" }), S("b"), slots)).toBe(true);
  });
  it("custom times that spill across slots are caught even though the slots differ", () => {
    const a = S("a", { start: "11:00", end: "13:30" });            // in Morning, runs into Afternoon
    expect(sessionsOverlap(a, S("b", { timeId: "pm" }), slots)).toBe(true);
    expect(sessionsOverlap(S("a", { start: "11:00", end: "13:00" }), S("b", { timeId: "pm" }), slots)).toBe(false);
  });
  it("slots without parsable times fall back to same-slot clashes", () => {
    expect(sessionsOverlap(S("a", { timeId: "x" }), S("b", { timeId: "x" }), slots)).toBe(true);
    expect(sessionsOverlap(S("a", { timeId: "x" }), S("b", { timeId: "am" }), slots)).toBe(false);
  });
  it("an invalid half-set custom time is ignored (session keeps its slot window)", () => {
    expect(sessionsOverlap(S("a", { start: "10:00" }), S("b", { start: "11:00", end: "11:30" }), slots)).toBe(true);
  });
});

describe("conflict engine with custom times", () => {
  const apps = o => Object.fromEntries(o.map(a => [a.id, a]));
  it("instructor teaching two back-to-back custom sessions is fine; overlapping is not", () => {
    const base = [S("a", { instructorId: "i1", start: "09:00", end: "10:30" })];
    expect(checkConflicts(apps(base), S("n", { instructorId: "i1", start: "10:30", end: "12:00" }), slots)).toEqual([]);
    const c = checkConflicts(apps(base), S("n", { instructorId: "i1", start: "10:00", end: "11:00" }), slots);
    expect(c.map(x => x.type)).toEqual(["instructor"]);
  });
  it("room and group clashes are reported by type", () => {
    const base = apps([S("a", { roomId: "r1", groupIds: ["g1", "g2"] })]);
    const c = checkConflicts(base, S("n", { roomId: "r1", groupIds: ["g2"] }), slots);
    expect(c.map(x => x.type).sort()).toEqual(["group", "room"]);
  });
  it("editing a session doesn't clash with itself", () => {
    const base = apps([S("a", { instructorId: "i1" })]);
    expect(checkConflicts(base, base.a, slots, "a")).toEqual([]);
  });
  it("getAllConflicts finds only true overlaps (two sessions in one slot, split by time, are fine)", () => {
    const list = apps([
      S("a", { instructorId: "i1", start: "09:00", end: "10:30" }),
      S("b", { instructorId: "i1", start: "10:30", end: "12:00" }),
      S("c", { instructorId: "i1", start: "11:00", end: "12:00" }),   // overlaps b only
    ]);
    const all = getAllConflicts(list, slots);
    expect(all).toHaveLength(1);
    expect([all[0].a.id, all[0].b.id].sort()).toEqual(["b", "c"]);
  });
  it("default sessions behave exactly as before", () => {
    const list = apps([S("a", { instructorId: "i1", roomId: "r1" }), S("b", { instructorId: "i1", roomId: "r1" }), S("c", { timeId: "pm", instructorId: "i1" })]);
    expect(getAllConflicts(list, slots).map(x => x.type).sort()).toEqual(["instructor", "room"]);
  });
  it("scales: 5,000 sessions are checked quickly", () => {
    const big = {}; for (let i = 0; i < 5000; i++) big["s" + i] = S("s" + i, { weekNum: i % 17, dayIdx: i % 5, timeId: ["am", "pm", "ev"][i % 3], instructorId: "i" + (i % 400) });
    const t = Date.now(); getAllConflicts(big, slots);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe("auto-scheduler availability helpers see custom-time sessions", () => {
  const list = Object.fromEntries([S("a", { instructorId: "i1", roomId: "r1", groupIds: ["g1"], start: "10:00", end: "11:00" })].map(a => [a.id, a]));
  it("a whole-slot placement is blocked by a custom session inside that slot", () => {
    expect(isInstructorFreeAllWeeks(list, "i1", 0, "am", [1], slots)).toBe(false);
    expect(areGroupsFreeAllWeeks(list, ["g1"], 0, "am", [1], slots)).toBe(false);
    expect(isRoomFree(list, "r1", 1, 0, "am", slots)).toBe(false);
  });
  it("other slots, weeks, days and people are unaffected", () => {
    expect(isInstructorFreeAllWeeks(list, "i1", 0, "pm", [1], slots)).toBe(true);
    expect(isInstructorFreeAllWeeks(list, "i1", 0, "am", [2], slots)).toBe(true);
    expect(isInstructorFreeAllWeeks(list, "i2", 0, "am", [1], slots)).toBe(true);
    expect(isRoomFree(list, "r2", 1, 0, "am", slots)).toBe(true);
  });
});

describe("validateCustomTimes", () => {
  it("rejects missing or reversed times; warns (not blocks) when outside the slot window", () => {
    expect(validateCustomTimes("", "10:00", slots[0]).ok).toBe(false);
    expect(validateCustomTimes("11:00", "10:00", slots[0]).ok).toBe(false);
    expect(validateCustomTimes("10:00", "11:00", slots[0])).toMatchObject({ ok: true, outsideSlot: false });
    expect(validateCustomTimes("08:30", "10:00", slots[0])).toMatchObject({ ok: true, outsideSlot: true });
    expect(validateCustomTimes("10:00", "11:00", slots[3])).toMatchObject({ ok: true, outsideSlot: false });
  });
});
