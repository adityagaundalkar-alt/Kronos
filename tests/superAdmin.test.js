import { describe, it, expect } from "vitest";
import { isSuperUser, dedupePresence, codesByTerm, membersOf, opsStats, buildPeople, onlineAcross, fresh } from "../src/superAdmin.js";

describe("isSuperUser", () => {
  it("only the listed Google account, verified", () => {
    expect(isSuperUser({ email: "Aditya.Gaundalkar@gmail.com", emailVerified: true })).toBe(true);
    expect(isSuperUser({ email: "aditya.gaundalkar@gmail.com", isAnonymous: true })).toBe(false);
    expect(isSuperUser({ email: "aditya.gaundalkar@gmail.com", emailVerified: false })).toBe(false);
    expect(isSuperUser({ email: "someone@gmail.com" })).toBe(false);
    expect(isSuperUser(null)).toBe(false);
  });
});

describe("dedupePresence", () => {
  const P = (name, at, o = {}) => ({ name, at, ...o });
  it("one entry per Google account, the most recent tab", () => {
    const out = dedupePresence({ t1: P("Pete", 1, { uid: "u1", acct: true }), t2: P("Pete", 5, { uid: "u1", acct: true, tab: "courses" }), t3: P("Ann", 3) }, null);
    expect(Object.keys(out).sort()).toEqual(["t2", "t3"]);
  });
  it("code-only people in two browsers merge by name", () => {
    const out = dedupePresence({ a: P("Sam Lee", 1, { uid: "x" }), b: P(" sam lee ", 2, { uid: "y" }) }, null);
    expect(Object.keys(out)).toEqual(["b"]);
  });
  it("my other tabs never show as someone else, and this tab is me", () => {
    const self = { userId: "mine", uid: "u1", acct: true, name: "Aadi" };
    const out = dedupePresence({ mine: P("Aadi", 1, { uid: "u1", acct: true }), other: P("Aadi", 9, { uid: "u1", acct: true }), x: P("Ann", 2) }, self);
    expect(Object.keys(out).sort()).toEqual(["mine", "x"]);
    expect(Object.keys(dedupePresence({ other: P("Aadi", 9, { uid: "u1", acct: true }) }, self))).toEqual([]);
  });
});

describe("terms and people", () => {
  const codes = { AAA111: { rid: "r1", role: "admin" }, EEE111: { rid: "r1", role: "editor" }, VVV111: { rid: "r1", role: "viewer" }, AAA222: { rid: "r2", role: "admin" } };
  it("groups codes by term", () => {
    expect(codesByTerm(codes)).toEqual({ r1: { admin: "AAA111", editor: "EEE111", viewer: "VVV111" }, r2: { admin: "AAA222" } });
  });
  it("members take their highest role and ignore replaced codes", () => {
    const m = membersOf({ AAA111: { u1: true }, EEE111: { u1: true, u2: true }, OLD999: { u3: true } }, codesByTerm(codes).r1);
    expect(m).toEqual({ u1: "admin", u2: "editor" });
  });
  it("ops stats by account, then by name", () => {
    const s = opsStats({ a: { at: 5, uid: "u1", userName: "Pete" }, b: { at: 9, uid: "u1", userName: "Pete" }, c: { at: 7, userName: "Ann" } });
    expect(s.count).toBe(3); expect(s.lastAt).toBe(9);
    expect(s.editors.map(e => [e.name, e.count])).toEqual([["Pete", 2], ["Ann", 1]]);
  });
  it("people merge logins, memberships and changes", () => {
    const logins = { u1: { name: "Pete", email: "p@x.com", provider: "google", first: 1, last: 50, terms: { r1: { role: "editor", name: "Sep", last: 50 } } } };
    const terms = [{ rid: "r1", name: "Sep 2026", members: { u1: "admin", u2: "viewer" }, ops: opsStats({ a: { at: 5, uid: "u1", userName: "Pete" } }) }];
    const people = buildPeople(logins, terms);
    expect(people.map(p => p.uid)).toEqual(["u1", "u2"]);
    expect(people[0].terms.r1).toMatchObject({ role: "admin", member: true, changes: 1, last: 50 });
    expect(people[0].changes).toBe(1);
    expect(people[1]).toMatchObject({ name: "", terms: { r1: { role: "viewer" } } });
  });
  it("online across terms is one row per person with every term they are in", () => {
    const rows = onlineAcross({
      r1: { t1: { name: "Pete", uid: "u1", acct: true, at: 4, tab: "schedule" }, t2: { name: "Pete", uid: "u1", acct: true, at: 6, tab: "courses" } },
      r2: { t3: { name: "Pete", uid: "u1", acct: true, at: 5 }, t4: { name: "Ann", at: 1 } },
    }, { r1: "Sep", r2: "Jan" });
    expect(rows.map(r => r.name)).toEqual(["Pete", "Ann"]);
    expect(rows[0].terms.map(t => [t.name, t.tab])).toEqual([["Sep", "courses"], ["Jan", ""]]);
  });
  it("fresh drops stale presence", () => {
    expect(Object.keys(fresh({ a: { at: 100 }, b: { at: 10 } }, 120, 50))).toEqual(["a"]);
  });
});
