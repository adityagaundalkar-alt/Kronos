import { describe, it, expect } from "vitest";
import { emptyState, termFrom, sanitizeState } from "../src/state.js";

describe("new terms", () => {
  it("an empty term has no classes, people, rooms or groups", () => {
    const t = emptyState("Term 1");
    expect(t.courses).toEqual([]); expect(t.instructors).toEqual([]); expect(t.rooms).toEqual([]);
    expect(t.groups).toEqual([]); expect(t.appointments).toEqual({}); expect(t.holidays).toEqual([]);
    expect(t.settings.semester).toBe("Term 1");
    expect(t.slots.length).toBe(3);
  });
  it("is unchanged by sanitizing (so loading it back doesn't invent data)", () => {
    const t = emptyState("T");
    expect(sanitizeState(t)).toEqual(t);
  });
  it("copies instructors, rooms, groups and slots from an earlier term, but no classes", () => {
    const old = { ...emptyState("Old"), instructors: [{ id: "i1", name: "A" }], rooms: [{ id: "r1", name: "R" }], groups: [{ id: "g1", name: "G" }],
      courses: [{ id: "c1" }], appointments: { a1: { id: "a1" } }, holidays: [{ id: "h", date: "2026-01-01" }], changelog: [{ at: 1 }],
      slots: [{ id: "x", short: "Day", label: "08:00 – 17:00" }], settings: { institution: "Uni", semester: "Old", logo: "" } };
    const t = termFrom(old, "New");
    expect(t.instructors).toEqual(old.instructors); expect(t.rooms).toEqual(old.rooms); expect(t.groups).toEqual(old.groups);
    expect(t.slots).toEqual(old.slots);
    expect(t.courses).toEqual([]); expect(t.appointments).toEqual({}); expect(t.holidays).toEqual([]); expect(t.changelog).toEqual([]);
    expect(t.settings).toEqual({ institution: "Uni", semester: "New", logo: "" });
  });
  it("does not share objects with the earlier term", () => {
    const old = { ...emptyState("Old"), instructors: [{ id: "i1", name: "A" }] };
    const t = termFrom(old, "New");
    t.instructors[0].name = "changed";
    expect(old.instructors[0].name).toBe("A");
  });
  it("copes with a missing earlier term", () => {
    expect(termFrom(null, "N").settings.semester).toBe("N");
  });
});
