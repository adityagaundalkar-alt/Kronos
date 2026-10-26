// Pure helpers for per-item real-time sync. No Firebase imports here so the
// logic can be unit-tested.
//
// The timetable state is mapped to a flat set of paths, one per item:
//   appointments/<id>, courses/<id>, instructors/<id>, rooms/<id>, groups/<id>,
//   holidays/<id>, slots/<id>, changelog/<key>, config
// Only the paths that changed are written, so two people editing different
// items never overwrite each other, and deletions are real deletions.

// Collections stored as arrays in app state (order kept in an `_o` field).
export const ARRAY_COLLECTIONS = ["courses", "instructors", "rooms", "groups", "holidays", "slots"];
export const COLLECTIONS = ["appointments", ...ARRAY_COLLECTIONS, "changelog"];

const clean = v => JSON.parse(JSON.stringify(v ?? null)); // drops undefined (Firebase rejects it)

// Firebase drops empty arrays/objects/null and returns index-keyed objects as arrays,
// so a value we wrote can come back looking different. Compare in a canonical form
// that ignores those differences, otherwise our own writes would look like remote edits.
export function canon(v) {
  if (v === null || v === undefined || v === "") return undefined;
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { const c = canon(x); if (c !== undefined) o[i] = c; });
    return Object.keys(o).length ? o : undefined;
  }
  if (typeof v === "object") {
    const o = {};
    Object.keys(v).sort().forEach(k => { const c = canon(v[k]); if (c !== undefined) o[k] = c; });
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}
export const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export function changelogKey(e) {
  const s = `${e.action || ""}|${e.detail || ""}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `${e.at || 0}_${(h >>> 0).toString(36)}`;
}

/** State -> { path: value } (values already JSON-safe). */
export function stateToFlat(state) {
  const flat = {};
  const s = state || {};
  Object.entries(s.appointments || {}).forEach(([id, a]) => {
    if (a) flat[`appointments/${id}`] = clean(a);
  });
  ARRAY_COLLECTIONS.forEach(col => {
    (s[col] || []).forEach((item, i) => {
      if (item && item.id) flat[`${col}/${item.id}`] = { ...clean(item), _o: i };
    });
  });
  (s.changelog || []).forEach(e => {
    if (e) flat[`changelog/${changelogKey(e)}`] = clean({ at: e.at, action: e.action, detail: e.detail || "" });
  });
  flat.config = clean({ week1Start: s.week1Start || "", settings: s.settings || {} });
  return flat;
}

/** Diff two flat maps into a Firebase multi-path update ({path: value|null}). */
export function diffFlat(prev, next) {
  const updates = {};
  for (const [p, v] of Object.entries(next)) {
    if (!(p in prev) || !same(prev[p], v)) updates[p] = v;
  }
  for (const p of Object.keys(prev)) {
    if (!(p in next)) updates[p] = null;
  }
  return updates;
}

/** Full state -> nested tree to `set()` at the room root (used when creating a room). */
export function flatToTree(flat) {
  const tree = {};
  for (const [p, v] of Object.entries(flat)) {
    const [col, id] = p.split("/");
    if (id === undefined) tree[col] = v;
    else (tree[col] ||= {})[id] = v;
  }
  return tree;
}

/** Nested tree from Firebase -> partial app state. Caller should run sanitizeState on it. */
export function treeToState(tree) {
  const t = tree || {};
  const out = {
    appointments: { ...(t.appointments || {}) },
    week1Start: t.config?.week1Start || "",
    settings: t.config?.settings || {},
  };
  ARRAY_COLLECTIONS.forEach(col => {
    out[col] = Object.values(t[col] || {})
      .filter(Boolean)
      .sort((a, b) => (a._o ?? 0) - (b._o ?? 0) || String(a.id).localeCompare(String(b.id)))
      .map(({ _o, ...rest }) => rest);
  });
  out.changelog = Object.values(t.changelog || {}).filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0));
  return out;
}

/**
 * Apply one remote child change to app state. Returns the SAME object when
 * nothing changes (so echoes of our own writes cause no re-render).
 */
export function applyRemoteChange(state, col, id, value) {
  if (col === "config") {
    const curCfg = { week1Start: state.week1Start, settings: state.settings };
    const nextCfg = { week1Start: value?.week1Start ?? state.week1Start, settings: value?.settings ?? state.settings };
    return same(nextCfg, curCfg) ? state : { ...state, ...nextCfg };
  }
  if (col === "appointments") {
    const cur = state.appointments || {};
    if (value == null) {
      if (!(id in cur)) return state;
      const { [id]: _drop, ...rest } = cur;
      return { ...state, appointments: rest };
    }
    if (same(cur[id], value)) return state;
    return { ...state, appointments: { ...cur, [id]: value } };
  }
  if (col === "changelog") {
    const list = state.changelog || [];
    const idx = list.findIndex(e => changelogKey(e) === id);
    if (value == null) {
      if (idx < 0) return state;
      return { ...state, changelog: list.filter((_, i) => i !== idx) };
    }
    if (idx >= 0) return state;
    return { ...state, changelog: [...list, value].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-200) };
  }
  if (ARRAY_COLLECTIONS.includes(col)) {
    const list = state[col] || [];
    const idx = list.findIndex(x => x.id === id);
    if (value == null) {
      if (idx < 0) return state;
      return { ...state, [col]: list.filter((_, i) => i !== idx) };
    }
    const { _o, ...item } = value;
    // Place the item at its remote position (`_o`) among the other items.
    const without = list.filter(x => x.id !== id);
    const target = Math.min(Math.max(_o ?? without.length, 0), without.length);
    const next = [...without.slice(0, target), item, ...without.slice(target)];
    return same(next, list) ? state : { ...state, [col]: next };
  }
  return state;
}
