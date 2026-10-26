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
