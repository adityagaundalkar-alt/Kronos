// Student groups can be organised as parent -> child (parentId). When a term has no hierarchy yet
// (a flat list such as "Cohort 3A CS", "Cohort 4 IBM"), we fold them into virtual folders by their last
// word (CS, IBM, ...) so a long list is still easy to pick from.
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** → [{ key, label, self: group|null, children: group[] (all descendants), virtual }] */
export function buildGroupTree(groups = []) {
  const list = (groups || []).filter(Boolean);
  const byId = new Map(list.map(g => [g.id, g]));
  const hasParents = list.some(g => g.parentId && byId.has(g.parentId));
  if (hasParents) {
    const kids = new Map(); const roots = [];
    list.forEach(g => (g.parentId && byId.has(g.parentId) && g.parentId !== g.id ? (kids.get(g.parentId) || kids.set(g.parentId, []).get(g.parentId)).push(g) : roots.push(g)));
    const descend = (id, seen = new Set()) => (kids.get(id) || []).flatMap(c => (seen.has(c.id) ? [] : (seen.add(c.id), [c, ...descend(c.id, seen)])));
    return roots.sort(natural).map(g => ({ key: g.id, label: g.name, self: g, children: descend(g.id).sort(natural), virtual: false }));
  }
  const folderOf = g => { const w = g.name.trim().split(/\s+/); return w.length > 1 ? w[w.length - 1] : ""; };
  const counts = {};
  list.forEach(g => { const f = folderOf(g); if (f) counts[f] = (counts[f] || 0) + 1; });
  const useFolders = list.length > 8;
  const folders = new Map(); const loose = [];
  list.forEach(g => { const f = folderOf(g); if (useFolders && f && counts[f] > 1) (folders.get(f) || folders.set(f, []).get(f)).push(g); else loose.push(g); });
  const out = [...folders.entries()].map(([f, gs]) => ({ key: "v:" + f, label: f, self: null, children: gs.sort(natural), virtual: true }));
  loose.sort(natural).forEach(g => out.push({ key: g.id, label: g.name, self: g, children: [], virtual: false }));
  return out.sort((a, b) => (a.children.length ? 0 : 1) - (b.children.length ? 0 : 1) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Toggle many ids on or off together: if all are already in `value`, remove them, otherwise add the missing ones. */
export function toggleMany(value, ids) {
  const all = ids.every(i => value.includes(i));
  return all ? value.filter(v => !ids.includes(v)) : [...value, ...ids.filter(i => !value.includes(i))];
}

// ── Who shares students ─────────────────────────────────────────────────────
// A parent group (Cohort 6) contains its sub-groups (Cohort 6 TH, Cohort 6 CS …), at any depth: they always share
// students. Sub-groups of one parent may or may not: "TH" and "FE" never do (separate English tracks), but "TH" and
// "CS" can. Groups mark the sub-groups they never share students with in `separateFrom` (either side is enough).

/** → rel(a, b): "same" | "contains" (one is inside the other) | "separate" | "maybe" | "none" (different families). */
export function groupRelations(groups) {
  const byId = new Map((groups || []).filter(Boolean).map(g => [g.id, g]));
  const chains = new Map();
  const chain = id => {
    if (chains.has(id)) return chains.get(id);
    const out = [];
    for (let cur = id, seen = new Set(); cur && !seen.has(cur); cur = byId.get(cur)?.parentId) { seen.add(cur); out.push(cur); }
    chains.set(id, out);
    return out;
  };
  const marked = (x, y) => (byId.get(x)?.separateFrom || []).includes(y) || (byId.get(y)?.separateFrom || []).includes(x);
  const memo = new Map();
  return function rel(a, b) {
    if (!a || !b) return "none";
    if (a === b) return "same";
    const key = a < b ? a + "|" + b : b + "|" + a;
    if (memo.has(key)) return memo.get(key);
    const ca = chain(a), cb = chain(b);
    let r;
    if (ca.includes(b) || cb.includes(a)) r = "contains";
    else {
      const common = ca.find(x => cb.includes(x));
      if (!common) r = "none";
      else {
        // separate if any pair of branches below the shared parent is marked separate (sub-groups inherit it)
        const la = ca.slice(0, ca.indexOf(common)), lb = cb.slice(0, cb.indexOf(common));
        r = la.some(x => lb.some(y => marked(x, y))) ? "separate" : "maybe";
      }
    }
    memo.set(key, r);
    return r;
  };
}

/**
 * How two sessions' student groups meet: "group" (the same students: same group, or a group and one inside it),
 * "overlap" (sub-groups of one parent that may share students), or null. Returns the pair that decided it.
 */
export function groupClash(rel, idsA, idsB) {
  let maybe = null;
  for (const x of idsA || []) for (const y of idsB || []) {
    const r = rel(x, y);
    if (r === "same" || r === "contains") return { kind: "group", a: x, b: y, relation: r };
    if (r === "maybe" && !maybe) maybe = { kind: "overlap", a: x, b: y, relation: r };
  }
  return maybe;
}
