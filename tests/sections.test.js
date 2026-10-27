import { describe, it, expect } from "vitest";
import { migrateSections, sectionsOf, countNewSections, sectionId, sessionsInSection } from "../src/sections.js";

const A = (id, o = {}) => ({ id, weekNum: 1, dayIdx: 0, timeId: "am", courseId: "c1", courseName: "English", groupIds: [], instructorId: "", roomId: "", section: "", ...o });
const st = (apps, courses) => ({ courses: courses || [{ id: "c1", name: "English", code: "E1" }], appointments: Object.fromEntries(apps.map(a => [a.id, a])) });

describe("migrateSections", () => {
  it("creates a section per distinct name with the instructor, groups and room most used", () => {
    const s = st([
      A("a", { section: "G1", instructorId: "pete", groupIds: ["x", "y"], roomId: "r1" }),
      A("b", { section: "G1", instructorId: "pete", groupIds: ["y", "x"], roomId: "r1", weekNum: 2 }),
      A("c", { section: "G1", instructorId: "adam", groupIds: ["x", "y"], roomId: "r2", weekNum: 3 }),
      A("d", { section: "g2", instructorId: "adam", groupIds: ["z"] }),
      A("e", { section: "" }),
    ]);
    const out = migrateSections(s);
    const secs = sectionsOf(out.courses[0]);
    expect(secs.map(x => x.name)).toEqual(["G1", "g2"]);
    expect(secs[0]).toMatchObject({ instructorId: "pete", roomId: "r1" });
    expect([...secs[0].groupIds].sort()).toEqual(["x", "y"]);
    expect(secs[1].instructorId).toBe("adam");
    expect(out.appointments.a.sectionId).toBe(secs[0].id);
    expect(out.appointments.d.sectionId).toBe(secs[1].id);
    expect(out.appointments.e.sectionId).toBeUndefined();
    expect(countNewSections(s, out)).toBe(2);
  });
  it("is idempotent and returns the same object when nothing is left to do", () => {
    const once = migrateSections(st([A("a", { section: "G1" })]));
    expect(migrateSections(once)).toBe(once);
    expect(migrateSections(st([A("a")]))).toBeTruthy();
  });
  it("links to an existing section with the same name instead of duplicating it", () => {
    const courses = [{ id: "c1", name: "E", code: "E", sections: [{ id: "keep", name: "G1", instructorId: "pete", groupIds: [] }] }];
    const out = migrateSections(st([A("a", { section: "g1" })], courses));
    expect(sectionsOf(out.courses[0])).toHaveLength(1);
    expect(out.appointments.a.sectionId).toBe("keep");
    expect(out.appointments.a.section).toBe("G1");
  });
  it("does not bring back a deleted section for sessions that already point at one", () => {
    const s = st([A("a", { section: "G1", sectionId: "gone" })]);
    expect(migrateSections(s)).toBe(s);
  });
  it("two people converting the same sessions get the same ids", () => {
    const s = st([A("a", { section: "Group 1" })]);
    expect(sectionsOf(migrateSections(s).courses[0])[0].id).toBe(sectionId("c1", "Group 1"));
    expect(sessionsInSection(migrateSections(s), "c1", sectionId("c1", "Group 1"))).toHaveLength(1);
  });
});
