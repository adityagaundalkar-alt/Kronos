import { describe, it, expect } from "vitest";
import { stateToFlat, diffFlat, flatToTree, treeToState, applyRemoteChange, changelogKey, same } from "../src/sync.js";

const base = () => ({
  week1Start: "2026-10-26",
  settings: { institution: "U", semester: "S1", logo: "" },
  appointments: { a1: { id: "a1", weekNum: 1, dayIdx: 0, timeId: "am", courseId: "c1", instructorId: "i1", roomId: "r1", groupIds: ["g1"] } },
  courses: [{ id: "c1", name: "CS101" }, { id: "c2", name: "CS201" }],
  instructors: [{ id: "i1", name: "Chen", availability: { 0: ["am"] } }],
  rooms: [{ id: "r1", name: "R1", capacity: 40 }],
  groups: [{ id: "g1", name: "Y1", size: 80 }],
  holidays: [], slots: [{ id: "am", label: "09-12" }],
  changelog: [{ at: 1000, action: "Session scheduled", detail: "CS101" }],
});

describe("diff / apply", () => {
  it("no change -> empty diff", () => {
    expect(diffFlat(stateToFlat(base()), stateToFlat(base()))).toEqual({});
  });
  it("editing one appointment writes exactly one path", () => {
    const b = base(), n = base();
    n.appointments.a1 = { ...n.appointments.a1, roomId: "r2" };
    expect(Object.keys(diffFlat(stateToFlat(b), stateToFlat(n)))).toEqual(["appointments/a1"]);
  });
  it("deleting an appointment writes null (propagates as a real delete)", () => {
    const n = base(); delete n.appointments.a1;
    expect(diffFlat(stateToFlat(base()), stateToFlat(n))).toEqual({ "appointments/a1": null });
  });
  it("changing instructor/room/group is detected (old hash missed these)", () => {
    const n = base();
    n.instructors = [{ ...n.instructors[0], name: "Chen B" }];
    n.groups = [{ ...n.groups[0], size: 90 }];
    expect(Object.keys(diffFlat(stateToFlat(base()), stateToFlat(n))).sort()).toEqual(["groups/g1", "instructors/i1"]);
  });
  it("two people editing different items both survive", () => {
    // A edits appt a1, B adds appt a2; each applies the other's change
    const A = base(); A.appointments.a1 = { ...A.appointments.a1, notes: "A" };
    const B = base(); B.appointments.a2 = { id: "a2", weekNum: 2 };
    const dA = diffFlat(stateToFlat(base()), stateToFlat(A));
    const dB = diffFlat(stateToFlat(base()), stateToFlat(B));
    let sA = A, sB = B;
    for (const [p, v] of Object.entries(dB)) { const [c, id] = p.split("/"); sA = applyRemoteChange(sA, c, id, v); }
    for (const [p, v] of Object.entries(dA)) { const [c, id] = p.split("/"); sB = applyRemoteChange(sB, c, id, v); }
    expect(sA.appointments).toEqual(sB.appointments);
    expect(Object.keys(sA.appointments).sort()).toEqual(["a1", "a2"]);
    expect(sA.appointments.a1.notes).toBe("A");
  });
  it("remote delete removes the item locally; echo of own change is a no-op (same object)", () => {
    const s = base();
    expect(applyRemoteChange(s, "appointments", "a1", null).appointments).toEqual({});
    expect(applyRemoteChange(s, "appointments", "a1", s.appointments.a1)).toBe(s);
    expect(applyRemoteChange(s, "courses", "c1", { id: "c1", name: "CS101", _o: 0 })).toBe(s);
    expect(applyRemoteChange(s, "config", undefined, { week1Start: s.week1Start, settings: s.settings })).toBe(s);
  });
  it("array items keep their order and support remote reorder/insert/delete", () => {
    let s = base();
    s = applyRemoteChange(s, "courses", "c3", { id: "c3", name: "X", _o: 1 });
    expect(s.courses.map(c => c.id)).toEqual(["c1", "c3", "c2"]);
    s = applyRemoteChange(s, "courses", "c2", { id: "c2", name: "CS201", _o: 0 });
    expect(s.courses.map(c => c.id)).toEqual(["c2", "c1", "c3"]);
    s = applyRemoteChange(s, "courses", "c1", null);
    expect(s.courses.map(c => c.id)).toEqual(["c2", "c3"]);
  });
  it("tree round trip preserves state (order, nested objects, changelog)", () => {
    const s = base();
    const back = treeToState(flatToTree(stateToFlat(s)));
    expect(back.courses).toEqual(s.courses);
    expect(back.appointments).toEqual(s.appointments);
    expect(back.instructors).toEqual(s.instructors);
    expect(back.changelog).toEqual(s.changelog);
    expect(back.week1Start).toBe(s.week1Start);
    expect(back.settings).toEqual(s.settings);
  });
  it("undefined fields never reach Firebase", () => {
    const s = base(); s.appointments.a1.notes = undefined;
    expect(JSON.stringify(stateToFlat(s))).not.toContain("undefined");
    expect("notes" in stateToFlat(s)["appointments/a1"]).toBe(false);
  });
  it("changelog entries are keyed deterministically; remote add is deduped", () => {
    const e = { at: 5, action: "x", detail: "y" };
    expect(changelogKey(e)).toBe(changelogKey({ ...e }));
    const s = { ...base(), changelog: [e] };
    expect(applyRemoteChange(s, "changelog", changelogKey(e), e)).toBe(s);
  });
  it("Firebase round-trip quirks (dropped empty arrays, arrays for index-keyed objects) are not seen as changes", () => {
    const s = base();
    s.appointments.a1 = { ...s.appointments.a1, groupIds: [], notes: "" };   // local defaults
    // what Firebase hands back: empty array removed, sequential-key object becomes an array
    const remoteAppt = { id: "a1", weekNum: 1, dayIdx: 0, timeId: "am", courseId: "c1", instructorId: "i1", roomId: "r1" };
    expect(applyRemoteChange(s, "appointments", "a1", remoteAppt)).toBe(s);
    const remoteInstr = { id: "i1", name: "Chen", availability: [["am"]], _o: 0 }; // {0:["am"]} comes back as [["am"]]
    expect(applyRemoteChange(s, "instructors", "i1", remoteInstr)).toBe(s);
    expect(same({ a: [] , b: "" }, {})).toBe(true);
    expect(same({ a: ["x"] }, { a: [] })).toBe(false);
  });
  it("a real remote edit is still detected", () => {
    const s = base();
    const edited = { ...s.appointments.a1, roomId: "r9" };
    const next = applyRemoteChange(s, "appointments", "a1", edited);
    expect(next).not.toBe(s);
    expect(next.appointments.a1.roomId).toBe("r9");
  });
  it("clearing a field locally (value -> empty) is written, not swallowed", () => {
    const b = base(), n = base();
    n.appointments.a1 = { ...n.appointments.a1, groupIds: [] };
    expect(Object.keys(diffFlat(stateToFlat(b), stateToFlat(n)))).toEqual(["appointments/a1"]);
  });
});
