import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRulesDb } from "./helpers/rulesDb.js";
import { createAccess } from "../src/access.js";
import { makeComment, applyCommentEvent, groupByAppt, openCounts, canDeleteComment, canResolveComment, canEditComment, ago, orphanIds, MAX_COMMENT } from "../src/comments.js";

describe("makeComment", () => {
  it("trims, caps length and fills defaults", () => {
    const c = makeComment({ apptId: "a", uid: "u", name: "  ", role: undefined, text: "  hello  ", at: 5 });
    expect(c).toEqual({ apptId: "a", uid: "u", name: "Someone", role: "viewer", text: "hello", at: 5 });
  });
  it("returns null when there is nothing to post", () => {
    expect(makeComment({ apptId: "a", uid: "u", text: "   " })).toBeNull();
    expect(makeComment({ apptId: "", uid: "u", text: "x" })).toBeNull();
    expect(makeComment({ apptId: "a", uid: "", text: "x" })).toBeNull();
  });
  it("caps at the limit the database accepts", () => {
    expect(makeComment({ apptId: "a", uid: "u", text: "x".repeat(MAX_COMMENT + 50) }).text).toHaveLength(MAX_COMMENT);
  });
});

describe("event reducer and grouping", () => {
  it("adds, updates and removes without mutating", () => {
    const m0 = {};
    const m1 = applyCommentEvent(m0, "c1", { apptId: "a", text: "one", at: 1 });
    expect(m0).toEqual({}); expect(m1.c1.id).toBe("c1");
    const m2 = applyCommentEvent(m1, "c1", { apptId: "a", text: "one", at: 1, resolved: true });
    expect(m2.c1.resolved).toBe(true); expect(m1.c1.resolved).toBeUndefined();
    const m3 = applyCommentEvent(m2, "c1", null);
    expect(m3).toEqual({});
    expect(applyCommentEvent(m3, "nope", null)).toBe(m3);
  });
  it("groups by session oldest first and counts only unresolved", () => {
    let m = {};
    m = applyCommentEvent(m, "c2", { apptId: "a", text: "second", at: 2 });
    m = applyCommentEvent(m, "c1", { apptId: "a", text: "first", at: 1 });
    m = applyCommentEvent(m, "c3", { apptId: "a", text: "done", at: 3, resolved: true });
    m = applyCommentEvent(m, "c4", { apptId: "b", text: "other", at: 1 });
    expect(groupByAppt(m).a.map(c => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(openCounts(m)).toEqual({ a: 2, b: 1 });
    expect(openCounts({})).toEqual({});
  });
  it("finds comments whose session was deleted", () => {
    const m = { c1: { id: "c1", apptId: "gone" }, c2: { id: "c2", apptId: "here" } };
    expect(orphanIds(m, { here: {} })).toEqual(["c1"]);
  });
});

describe("who may do what (UI mirror of the rules)", () => {
  const mine = { uid: "me" }, theirs = { uid: "them" };
  it("authors manage their own", () => {
    for (const role of ["viewer", "editor", "admin"]) {
      expect(canDeleteComment(mine, "me", role)).toBe(true);
      expect(canResolveComment(mine, "me", role)).toBe(true);
    }
    expect(canEditComment(mine, "me")).toBe(true);
    expect(canEditComment(theirs, "me")).toBe(false);
  });
  it("only editors and admins moderate others", () => {
    expect(canDeleteComment(theirs, "me", "viewer")).toBe(false);
    expect(canDeleteComment(theirs, "me", "editor")).toBe(true);
    expect(canResolveComment(theirs, "me", "admin")).toBe(true);
    expect(canResolveComment(theirs, "me", "viewer")).toBe(false);
    expect(canDeleteComment(null, "me", "admin")).toBe(false);
  });
  it("the UI mirror agrees with the real rules", async () => {
    const rules = JSON.parse(fs.readFileSync(new URL("../database.rules.json", import.meta.url)));
    const db = createRulesDb(rules);
    const mk = u => { const s = db.as(u); return { uid: u, store: s, access: createAccess(s, () => u) }; };
    const [admin, editor, viewer, other] = ["adm", "edi", "vie", "oth"].map(mk);
    const room = await admin.access.createRoom({ name: "R", makeCode: (() => { let n = 0; return () => "RULE000" + ++n; })() });
    await editor.access.join(room.codes.editor); await viewer.access.join(room.codes.viewer); await other.access.join(room.codes.viewer);
    const people = [[admin, "admin"], [editor, "editor"], [viewer, "viewer"], [other, "viewer"]];
    for (const [author, authorRole] of people) {
      for (const [actor, actorRole] of people) {
        const base = { apptId: "a", uid: author.uid, name: "n", text: "t", at: 1 };
        const p = `rooms/${room.rid}/comments/${author.uid}`;
        await author.store.set(p, base);
        const ui = canDeleteComment({ uid: author.uid }, actor.uid, actorRole);
        let rules_ok = true;
        try { await actor.store.remove(p); } catch { rules_ok = false; }
        expect(rules_ok, `${actorRole} deleting ${authorRole}'s comment`).toBe(ui);
        if (rules_ok) continue;
        const resolveUi = canResolveComment({ uid: author.uid }, actor.uid, actorRole);
        let resolveOk = true;
        try { await actor.store.update(p, { resolved: true }); } catch { resolveOk = false; }
        expect(resolveOk, `${actorRole} resolving ${authorRole}'s comment`).toBe(resolveUi);
        await author.store.remove(p);
      }
    }
  });
});

describe("ago", () => {
  it("formats recency", () => {
    const now = 1_000_000_000_000;
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5m ago");
    expect(ago(now - 3 * 3600_000, now)).toBe("3h ago");
    expect(ago(now - 2 * 86400_000, now)).toBe("2d ago");
    expect(ago(now - 30 * 86400_000, now)).toMatch(/\w{3}/);
  });
});
