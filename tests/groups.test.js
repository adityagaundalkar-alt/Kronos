import { describe, it, expect } from "vitest";
import { buildGroupTree, toggleMany } from "../src/groups.js";

const g = (id, name, parentId = null) => ({ id, name, parentId, size: 0 });

describe("group tree", () => {
  it("uses real parents when they exist", () => {
    const t = buildGroupTree([g("p", "Cohort 6"), g("a", "Cohort 6 CS", "p"), g("b", "Cohort 6 IBM", "p"), g("x", "Alumni")]);
    const p = t.find(n => n.key === "p");
    expect(p.children.map(c => c.id)).toEqual(["a", "b"]);
    expect(p.self.id).toBe("p");
    expect(t.find(n => n.key === "x").children).toEqual([]);
  });
  it("folds a long flat list into folders by last word", () => {
    const names = ["Cohort 1 CS", "Cohort 2 CS", "Cohort 3A CS", "Cohort 10 CS", "Cohort 1 IBM", "Cohort 2 IBM", "Cohort 6 TH", "Cohort 7 FE", "Staff"];
    const t = buildGroupTree(names.map((n, i) => g("g" + i, n)));
    const cs = t.find(n => n.key === "v:CS");
    expect(cs.children.map(c => c.name)).toEqual(["Cohort 1 CS", "Cohort 2 CS", "Cohort 3A CS", "Cohort 10 CS"]);
    expect(t.find(n => n.key === "v:IBM").children).toHaveLength(2);
    expect(t.find(n => n.key === "g6").children).toEqual([]); // only one TH: stays a plain group
  });
  it("keeps a short list flat", () => {
    expect(buildGroupTree([g("a", "A 1"), g("b", "B 1")]).every(n => !n.children.length)).toBe(true);
  });
  it("toggleMany adds all, then removes all", () => {
    expect(toggleMany(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(toggleMany(["a", "b", "z"], ["a", "b"])).toEqual(["z"]);
  });
});
