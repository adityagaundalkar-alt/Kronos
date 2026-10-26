import { describe, it, expect } from "vitest";
import { iso, parseISO, addDays, mondayOf, getWeekStart, slotDate } from "../src/dates.js";

describe("dates (timezone-safe)", () => {
  it("iso() round-trips a local date regardless of time of day", () => {
    const d = new Date(2026, 9, 26, 0, 30); // 00:30 local - used to shift back a day in UTC+7
    expect(iso(d)).toBe("2026-10-26");
    expect(iso(new Date(2026, 9, 26, 23, 59))).toBe("2026-10-26");
  });
  it("parseISO gives local midnight of the same calendar day", () => {
    const d = parseISO("2026-10-26");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 26, 0]);
  });
  it("addDays crosses month/year and DST boundaries by calendar days", () => {
    expect(iso(addDays("2026-12-30", 3))).toBe("2027-01-02");
    expect(iso(addDays("2026-03-07", 1))).toBe("2026-03-08");
    expect(iso(addDays("2026-03-08", 1))).toBe("2026-03-09");
    expect(iso(addDays("2026-10-31", 1))).toBe("2026-11-01");
    expect(iso(addDays("2026-11-01", 1))).toBe("2026-11-02");
  });
  it("mondayOf returns the Monday of the week; Sunday belongs to the week that just ended", () => {
    expect(iso(mondayOf(new Date(2026, 9, 26)))).toBe("2026-10-26"); // Monday
    expect(iso(mondayOf(new Date(2026, 9, 28, 3)))).toBe("2026-10-26"); // Wed
    expect(iso(mondayOf(new Date(2026, 9, 25)))).toBe("2026-10-19"); // Sunday
  });
  it("week and slot dates", () => {
    expect(iso(getWeekStart("2026-10-26", 1))).toBe("2026-10-26");
    expect(iso(getWeekStart("2026-10-26", 0))).toBe("2026-10-19");
    expect(iso(getWeekStart("2026-10-26", 3))).toBe("2026-11-09");
    expect(iso(slotDate("2026-10-26", 2, 4))).toBe("2026-11-06");
  });
});
