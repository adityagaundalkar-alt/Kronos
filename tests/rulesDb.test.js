import { describe, it, expect } from "vitest";
import { createRulesDb } from "./helpers/rulesDb.js";

// Sanity checks for the evaluator itself, so the access tests can be trusted.
const rules = { rules: {
  ".read": false, ".write": false,
  open: { ".read": true, ".write": "auth != null" },
  mine: { $uid: { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && auth.uid === $uid" } },
  parent: { ".read": "auth != null", child: { ".read": false } },   // a parent grant cascades; a child "false" does not revoke it
  guarded: { ".write": true, $k: { ".validate": "newData.isString() && newData.val().length <= 3" } },
  tern: { $k: { ".write": "!data.exists() ? newData.child('o').val() === auth.uid : data.child('o').val() === auth.uid" } },
  exp: { ".read": true, ".write": "root.child('flag').val() === 'on'" },
  flag: { ".read": true, ".write": true },
} };

describe("rules evaluator", () => {
  it("denies by default and allows by rule", async () => {
    const db = createRulesDb(rules);
    await expect(db.as("a").get("nothing")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(db.as(null).set("open/x", 1)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await db.as("a").set("open/x", 1);
    expect(await db.as(null).get("open/x")).toBe(1);
  });
  it("binds $wildcards", async () => {
    const db = createRulesDb(rules);
    await db.as("a").set("mine/a", "hi");
    await expect(db.as("b").set("mine/a", "no")).rejects.toThrow();
    await expect(db.as("b").get("mine/a")).rejects.toThrow();
    expect(await db.as("a").get("mine/a")).toBe("hi");
  });
  it("cascades a grant down to children", async () => {
    const db = createRulesDb(rules, { parent: { child: 5 } });
    expect(await db.as("a").get("parent/child")).toBe(5);
    await expect(db.as(null).get("parent/child")).rejects.toThrow();
  });
  it("enforces .validate", async () => {
    const db = createRulesDb(rules);
    await db.as("a").set("guarded/k", "abc");
    await expect(db.as("a").set("guarded/k", "abcd")).rejects.toThrow();
    await expect(db.as("a").set("guarded/k", 5)).rejects.toThrow();
  });
  it("supports ternaries and data/newData", async () => {
    const db = createRulesDb(rules);
    await db.as("a").set("tern/k", { o: "a" });
    await expect(db.as("b").set("tern/k", { o: "b" })).rejects.toThrow(); // exists and owned by a
    await expect(db.as("b").set("tern/j", { o: "a" })).rejects.toThrow();  // new, but claims another owner
    await db.as("b").set("tern/j", { o: "b" });
  });
  it("evaluates root against the pre-write database", async () => {
    const db = createRulesDb(rules);
    await expect(db.as("a").set("exp/x", 1)).rejects.toThrow();
    await db.as("a").set("flag", "on");
    await db.as("a").set("exp/x", 1);
    await expect(db.as("a").update("", { flag: "off", "exp/y": 2 })).resolves.toBeUndefined(); // exp/y checked before flag changes
    await expect(db.as("a").set("exp/z", 3)).rejects.toThrow(); // now off
  });
  it("a rule that throws is a denial", async () => {
    const r = { rules: { x: { ".read": "auth.uid.foo.bar === 1" } } };
    await expect(createRulesDb(r, { x: 1 }).as("a").get("x")).rejects.toThrow();
  });
});
