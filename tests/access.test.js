import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { buildRules } from "../scripts/rules.mjs";
import { createRulesDb } from "./helpers/rulesDb.js";
import { createAccess, can, genCode, genRid, normalizeCode, isValidCode, joinLink, codeFromSearch } from "../src/access.js";

const rules = JSON.parse(fs.readFileSync(new URL("../database.rules.json", import.meta.url)));
const denied = { code: "PERMISSION_DENIED" };

let db, seq;
const person = uid => {
  const store = db.as(uid);
  return { uid, store, access: createAccess(store, () => uid) };
};
const codeFactory = (prefix = "CODE") => { let n = 0; return () => `${prefix}${String(++n).padStart(8 - prefix.length, "0")}`; }; // deterministic, 8 chars

let alice, bob, cara, dave, mallory;
let room; // { rid, codes }

beforeEach(async () => {
  db = createRulesDb(rules);
  seq = 0;
  [alice, bob, cara, dave, mallory] = ["alice", "bob", "cara", "dave", "mallory"].map(person);
  room = await alice.access.createRoom({ name: "CS Dept", makeCode: codeFactory() });
  // admin writes some timetable data
  await alice.store.set(`rooms/${room.rid}/v2/config`, { week1Start: "2026-01-05" });
  await alice.store.set(`rooms/${room.rid}/v2/courses/c1`, { id: "c1", name: "Intro" });
  await bob.access.join(room.codes.editor);
  await cara.access.join(room.codes.viewer);
});

describe("the committed rules file", () => {
  it("is exactly what scripts/rules.mjs generates", () => {
    expect(rules).toEqual(JSON.parse(JSON.stringify(buildRules())));
  });
});

describe("code helpers", () => {
  it("generates well-formed codes and ids", () => {
    for (let i = 0; i < 50; i++) { expect(isValidCode(genCode())).toBe(true); expect(genRid()).toMatch(/^[a-z0-9]{16}$/); }
    expect(genCode()).not.toBe(genCode());
  });
  it("normalises typed codes", () => {
    expect(normalizeCode(" ab-cd 23 ")).toBe("ABCD23");
    expect(isValidCode("ABC")).toBe(false);
  });
  it("round-trips share links", () => {
    expect(codeFromSearch(new URL(joinLink("https://x.app/", "ABCD2345")).search)).toBe("ABCD2345");
    expect(codeFromSearch("")).toBe("");
    expect(codeFromSearch("?join=abcd%2023")).toBe("ABCD23");
  });
  it("capability table", () => {
    expect(can("admin", "share")).toBe(true);
    expect(can("editor", "edit")).toBe(true);
    expect(can("editor", "share")).toBe(false);
    expect(can("viewer", "edit")).toBe(false);
    expect(can("viewer", "comment")).toBe(true);
    expect(can("nobody", "view")).toBe(false);
  });
});

describe("joining", () => {
  it("resolves each code to its role", async () => {
    expect((await mallory.access.resolve(room.codes.admin)).role).toBe("admin");
    expect((await mallory.access.resolve(room.codes.editor)).role).toBe("editor");
    expect((await mallory.access.resolve(room.codes.viewer)).role).toBe("viewer");
    expect(await mallory.access.resolve("ZZZZZZZZ")).toBeNull();
    expect(await mallory.access.resolve("")).toBeNull();
  });
  it("joining with an unknown code fails cleanly", async () => {
    await expect(mallory.access.join("ZZZZZZZZ")).rejects.toThrow("Room not found");
  });
  it("the same person can join again (idempotent)", async () => {
    await bob.access.join(room.codes.editor);
    await bob.access.join(room.codes.editor);
  });
  it("someone who has not joined cannot read the timetable", async () => {
    await expect(mallory.store.get(`rooms/${room.rid}/v2`)).rejects.toMatchObject(denied);
    await expect(mallory.store.get(`rooms/${room.rid}/meta`)).rejects.toMatchObject(denied);
  });
  it("signed-out users (no identity at all) get nothing", async () => {
    const anon = db.as(null);
    await expect(anon.get(`codes/${room.codes.viewer}`)).rejects.toMatchObject(denied);
    await expect(anon.get(`rooms/${room.rid}/v2`)).rejects.toMatchObject(denied);
  });
});

describe("what each role can do to the timetable", () => {
  const v2 = () => `rooms/${room.rid}/v2`;
  it("admin and editor read and write", async () => {
    for (const p of [alice, bob]) {
      expect((await p.store.get(v2())).courses.c1.name).toBe("Intro");
      await p.store.update(v2(), { [`appointments/${p.uid}`]: { id: p.uid, weekNum: 1 } });
    }
    expect(Object.keys((await alice.store.get(v2())).appointments).sort()).toEqual(["alice", "bob"]);
  });
  it("viewer reads but cannot write, update or delete", async () => {
    expect((await cara.store.get(v2())).courses.c1.name).toBe("Intro");
    await expect(cara.store.set(`${v2()}/courses/c2`, { id: "c2" })).rejects.toMatchObject(denied);
    await expect(cara.store.update(v2(), { "courses/c1/name": "Hacked" })).rejects.toMatchObject(denied);
    await expect(cara.store.remove(`${v2()}/courses/c1`)).rejects.toMatchObject(denied);
    await expect(cara.store.set(v2(), {})).rejects.toMatchObject(denied);
    expect((await alice.store.get(v2())).courses.c1.name).toBe("Intro");
  });
  it("viewer cannot write the activity log or room details either", async () => {
    await expect(cara.store.set(`rooms/${room.rid}/ops/x`, { type: "x" })).rejects.toMatchObject(denied);
    await expect(cara.store.set(`rooms/${room.rid}/meta/name`, "Renamed")).rejects.toMatchObject(denied);
    await bob.store.set(`rooms/${room.rid}/ops/x`, { type: "edit" });
  });
  it("editor cannot change room details (admin only)", async () => {
    await expect(bob.store.set(`rooms/${room.rid}/meta/name`, "Renamed")).rejects.toMatchObject(denied);
    await alice.store.set(`rooms/${room.rid}/meta/name`, "Renamed");
  });
  it("everyone who joined can announce presence and see it", async () => {
    for (const p of [alice, bob, cara]) await p.store.set(`rooms/${room.rid}/presence/${p.uid}`, { name: p.uid });
    expect(Object.keys(await bob.store.get(`rooms/${room.rid}/presence`))).toHaveLength(3);
    await expect(mallory.store.set(`rooms/${room.rid}/presence/m`, { name: "m" })).rejects.toMatchObject(denied);
  });
});

describe("who can see which codes", () => {
  it("admin sees all three", async () => {
    expect(await alice.access.getCodes(room.rid)).toEqual(room.codes);
  });
  it("editor sees editor + viewer codes, never the admin code", async () => {
    expect(await bob.access.getCodes(room.rid)).toEqual({ editor: room.codes.editor, viewer: room.codes.viewer });
  });
  it("viewer sees only the viewer code", async () => {
    expect(await cara.access.getCodes(room.rid)).toEqual({ viewer: room.codes.viewer });
  });
  it("outsiders see nothing, and cannot list the secrets folder", async () => {
    expect(await mallory.access.getCodes(room.rid)).toEqual({});
    await expect(cara.store.get(`rooms/${room.rid}/secrets`)).rejects.toMatchObject(denied);
    await expect(cara.store.get(`rooms/${room.rid}/access`)).rejects.toMatchObject(denied);
    await expect(cara.store.get(`codes`)).rejects.toMatchObject(denied);
  });
});

describe("privilege escalation attempts", () => {
  it("a viewer cannot claim the editor or admin role without that code", async () => {
    // they know the room id (it is visible to them) but not the other codes
    await expect(cara.store.set(`rooms/${room.rid}/access/GUESS123/${cara.uid}`, true)).rejects.toMatchObject(denied);
    await expect(cara.store.set(`rooms/${room.rid}/access/${room.codes.viewer}/${bob.uid}`, true)).rejects.toMatchObject(denied); // not for someone else
  });
  it("a viewer cannot rewrite the secrets or add their own code", async () => {
    await expect(cara.store.set(`rooms/${room.rid}/secrets/viewer`, "MYCODE99")).rejects.toMatchObject(denied);
    await expect(cara.store.set(`rooms/${room.rid}/secrets/admin`, "MYCODE99")).rejects.toMatchObject(denied);
    await expect(cara.store.set(`rooms/${room.rid}/secrets`, { admin: "A", editor: "B", viewer: "C" })).rejects.toMatchObject(denied);
  });
  it("an editor cannot become admin", async () => {
    await expect(bob.store.set(`rooms/${room.rid}/secrets/admin`, "MYCODE99")).rejects.toMatchObject(denied);
    await expect(bob.store.set(`rooms/${room.rid}/access/MYCODE99/${bob.uid}`, true)).rejects.toMatchObject(denied);
    await expect(bob.access.rotate(room.rid, "editor")).rejects.toMatchObject(denied);
    await expect(bob.access.disableViewer(room.rid)).rejects.toMatchObject(denied);
  });
  it("nobody but the admin can create or delete code lookups", async () => {
    await expect(bob.store.set("codes/HIJACK12", { rid: room.rid, role: "admin" })).rejects.toMatchObject(denied);
    await expect(cara.store.remove(`codes/${room.codes.editor}`)).rejects.toMatchObject(denied);
    await expect(mallory.store.set("codes/HIJACK12", { rid: room.rid, role: "admin" })).rejects.toMatchObject(denied);
    await expect(mallory.store.set(`codes/${room.codes.viewer}`, { rid: "other", role: "admin" })).rejects.toMatchObject(denied); // overwrite existing
  });
  it("a code entry must be well formed", async () => {
    await expect(alice.store.set("codes/BADROLE1", { rid: room.rid, role: "superuser" })).rejects.toMatchObject(denied);
    await expect(alice.store.set("codes/BADROLE2", { rid: room.rid })).rejects.toMatchObject(denied);
  });
  it("an admin of another room cannot touch this one", async () => {
    const other = await mallory.access.createRoom({ name: "Other", makeCode: () => "OTHER" + Math.random().toString(36).slice(2, 5).toUpperCase() });
    await expect(mallory.store.set(`rooms/${room.rid}/v2/courses/x`, { id: "x" })).rejects.toMatchObject(denied);
    await expect(mallory.store.set("codes/STEAL123", { rid: room.rid, role: "admin" })).rejects.toMatchObject(denied);
    await expect(mallory.store.set(`rooms/${room.rid}/secrets/editor`, "OTHER")).rejects.toMatchObject(denied);
    expect(other.rid).not.toBe(room.rid);
  });
  it("a second person cannot re-create secrets for an existing room", async () => {
    await expect(mallory.store.set(`rooms/${room.rid}/secrets`, { admin: "X1X1X1X1", editor: "Y1Y1Y1Y1", viewer: "Z1Z1Z1Z1" })).rejects.toMatchObject(denied);
  });
  it("users' private cloud saves stay private", async () => {
    const google = { uid: "g1", store: db.as("g1", "google.com") };
    await google.store.set("users/g1", { x: 1 });
    await expect(alice.store.get("users/g1")).rejects.toMatchObject(denied);
    await expect(db.as("g1", "anonymous").set("users/g1", { x: 2 })).rejects.toMatchObject(denied); // anonymous identity cannot use cloud save
  });
});

describe("comments", () => {
  const cpath = id => `rooms/${room.rid}/comments/${id}`;
  const comment = (p, extra = {}) => ({ apptId: "a1", uid: p.uid, name: p.uid, text: "Can we move this?", at: 1, ...extra });

  it("every member can comment, including viewers", async () => {
    for (const p of [alice, bob, cara]) await p.store.set(cpath("c-" + p.uid), comment(p));
    expect(Object.keys(await cara.store.get(`rooms/${room.rid}/comments`))).toHaveLength(3);
  });
  it("outsiders cannot read or write comments", async () => {
    await expect(mallory.store.set(cpath("m"), comment(mallory))).rejects.toMatchObject(denied);
    await expect(mallory.store.get(`rooms/${room.rid}/comments`)).rejects.toMatchObject(denied);
  });
  it("you cannot post as someone else", async () => {
    await expect(cara.store.set(cpath("x"), comment(cara, { uid: bob.uid }))).rejects.toMatchObject(denied);
  });
  it("authors can edit and delete their own; viewers cannot touch others'", async () => {
    await cara.store.set(cpath("c1"), comment(cara));
    await cara.store.set(cpath("c1"), comment(cara, { text: "edited" }));
    await bob.store.set(cpath("c2"), comment(bob));
    await expect(cara.store.remove(cpath("c2"))).rejects.toMatchObject(denied);
    await expect(cara.store.set(cpath("c2"), comment(bob, { text: "tampered" }))).rejects.toMatchObject(denied);
    await expect(cara.store.update(cpath("c2"), { resolved: true })).rejects.toMatchObject(denied);
    await cara.store.remove(cpath("c1"));
  });
  it("editors and admins can resolve or delete anyone's comment but not change its author", async () => {
    await cara.store.set(cpath("c1"), comment(cara));
    await bob.store.update(cpath("c1"), { resolved: true });
    expect((await alice.store.get(cpath("c1"))).resolved).toBe(true);
    await expect(bob.store.update(cpath("c1"), { uid: bob.uid })).rejects.toMatchObject(denied);
    await alice.store.remove(cpath("c1"));
    expect(await alice.store.get(cpath("c1"))).toBeNull();
  });
  it("rejects empty and oversized comments", async () => {
    await expect(cara.store.set(cpath("e"), comment(cara, { text: "" }))).rejects.toMatchObject(denied);
    await expect(cara.store.set(cpath("big"), comment(cara, { text: "x".repeat(2001) }))).rejects.toMatchObject(denied);
    await cara.store.set(cpath("ok"), comment(cara, { text: "x".repeat(2000) }));
    await expect(cara.store.set(cpath("nofield"), { uid: cara.uid, text: "hi" })).rejects.toMatchObject(denied);
  });
});

describe("rotating and switching off codes", () => {
  it("rotating the editor code locks out existing editors and keeps admins and viewers", async () => {
    const fresh = await alice.access.rotate(room.rid, "editor", { makeCode: () => "NEWEDIT1" });
    expect(fresh).toBe("NEWEDIT1");
    await expect(bob.store.set(`rooms/${room.rid}/v2/courses/c9`, { id: "c9" })).rejects.toMatchObject(denied);
    await expect(bob.store.get(`rooms/${room.rid}/v2`)).rejects.toMatchObject(denied);
    expect((await cara.store.get(`rooms/${room.rid}/v2`)).courses.c1.name).toBe("Intro");
    await alice.store.set(`rooms/${room.rid}/v2/courses/c9`, { id: "c9" });
    // the old code no longer opens anything; the new one does
    expect(await dave.access.resolve(room.codes.editor)).toBeNull();
    await dave.access.join("NEWEDIT1");
    await dave.store.set(`rooms/${room.rid}/v2/courses/c10`, { id: "c10" });
    // bob can come back with the new code
    await bob.access.join("NEWEDIT1");
    await bob.store.set(`rooms/${room.rid}/v2/courses/c11`, { id: "c11" });
  });
  it("rotating the admin code keeps the person who did it as admin and ends the old code", async () => {
    await alice.access.rotate(room.rid, "admin", { makeCode: () => "NEWADMIN" });
    expect(await alice.access.getCodes(room.rid)).toMatchObject({ admin: "NEWADMIN" });
    expect(await mallory.access.resolve(room.codes.admin)).toBeNull();
    // a co-admin who joined with the old code is out until they get the new one
    const co = person("co");
    const before = await createAccess(db.as("co"), () => "co");
    expect(before).toBeTruthy();
    await mallory.access.join("NEWADMIN");
    await mallory.access.rotate(room.rid, "viewer", { makeCode: () => "NEWVIEW1" }); // proves she is admin now
    await expect(cara.store.get(`rooms/${room.rid}/v2`)).rejects.toMatchObject(denied);
    expect(co).toBeTruthy();
  });
  it("switching the read-only link off and on again", async () => {
    await alice.access.disableViewer(room.rid);
    await expect(cara.store.get(`rooms/${room.rid}/v2`)).rejects.toMatchObject(denied);
    expect(await dave.access.resolve(room.codes.viewer)).toBeNull();
    expect((await bob.store.get(`rooms/${room.rid}/v2`)).courses.c1.name).toBe("Intro"); // editors unaffected
    expect(await bob.access.getCodes(room.rid)).toEqual({ editor: room.codes.editor });
    const fresh = await alice.access.enableViewer(room.rid, { makeCode: () => "NEWVIEW2" });
    await dave.access.join(fresh);
    expect((await dave.store.get(`rooms/${room.rid}/v2`)).courses.c1.name).toBe("Intro");
    await expect(dave.store.set(`rooms/${room.rid}/v2/x`, 1)).rejects.toMatchObject(denied);
    // old viewers must use the new link
    await expect(cara.store.get(`rooms/${room.rid}/v2`)).rejects.toMatchObject(denied);
  });
  it("a removed viewer cannot sneak back in by re-claiming the old code", async () => {
    await alice.access.disableViewer(room.rid);
    await expect(cara.store.set(`rooms/${room.rid}/access/${room.codes.viewer}/${cara.uid}`, true)).rejects.toMatchObject(denied);
  });
});

describe("older rooms (no roles)", () => {
  const LEGACY = "ABCD2345";
  beforeEach(async () => {
    // exactly what the previous version of the app wrote
    await mallory.store.set(`rooms/${LEGACY}/meta`, { name: "Old room", ownerId: "mallory", createdAt: 1 });
    await mallory.store.set(`rooms/${LEGACY}/v2/config`, { week1Start: "2026-01-05" });
  });
  it("still open to anyone with the code, as before", async () => {
    const found = await dave.access.resolve(LEGACY);
    expect(found).toMatchObject({ rid: LEGACY, role: "editor", legacy: true });
    await dave.access.join(LEGACY);
    await dave.store.set(`rooms/${LEGACY}/v2/courses/z`, { id: "z" });
    expect((await bob.store.get(`rooms/${LEGACY}/v2/courses/z`)).id).toBe("z");
  });
  it("only the room's creator can upgrade it to roles", async () => {
    await expect(dave.access.upgradeLegacy(LEGACY)).rejects.toMatchObject(denied);
    const up = await mallory.access.upgradeLegacy(LEGACY, { makeCode: codeFactory("LEG") });
    expect(up.codes.editor).toBe(LEGACY); // the old code keeps working, now as the editor code
    expect(await dave.access.resolve(LEGACY)).toMatchObject({ rid: LEGACY, role: "editor", legacy: false });
    await dave.access.join(LEGACY);
    await dave.store.set(`rooms/${LEGACY}/v2/courses/z`, { id: "z" });
    const viewer = await bob.access.join(up.codes.viewer);
    expect(viewer.role).toBe("viewer");
    await expect(bob.store.set(`rooms/${LEGACY}/v2/courses/y`, { id: "y" })).rejects.toMatchObject(denied);
  });
  it("after upgrading, people who never rejoined are locked out until they do", async () => {
    await mallory.access.upgradeLegacy(LEGACY, { makeCode: codeFactory("LEG") });
    await expect(dave.store.get(`rooms/${LEGACY}/v2`)).rejects.toMatchObject(denied);
  });
  it("after upgrading, nobody else can take the secrets over", async () => {
    await mallory.access.upgradeLegacy(LEGACY, { makeCode: codeFactory("LEG") });
    await expect(dave.store.set(`rooms/${LEGACY}/secrets`, { admin: "QQQQQQQQ", editor: "RRRRRRRR", viewer: "SSSSSSSS" })).rejects.toMatchObject(denied);
    await expect(dave.access.upgradeLegacy(LEGACY)).rejects.toMatchObject(denied);
  });
});

describe("creating a room", () => {
  it("makes the creator an admin and everything consistent", async () => {
    const r = await dave.access.createRoom({ name: "Mine" });
    expect(r.role).toBe("admin");
    expect(new Set(Object.values(r.codes)).size).toBe(3);
    expect(await dave.access.getCodes(r.rid)).toEqual(r.codes);
    expect((await dave.store.get(`rooms/${r.rid}/meta`)).name).toBe("Mine");
    expect(await mallory.access.resolve(r.codes.viewer)).toMatchObject({ rid: r.rid, role: "viewer" });
  });
  it("needs an identity", async () => {
    const anon = createAccess(db.as(null), () => null);
    await expect(anon.createRoom({ name: "x" })).rejects.toThrow("Not signed in");
  });
});
