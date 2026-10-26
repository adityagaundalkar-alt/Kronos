// Saved versions of a term. A version is the whole timetable as one JSON string plus a label, so restoring one
// is simply "make the term look like this again" (and that restore can itself be undone).
import { sanitizeState } from "./state.js";

export const MAX_VERSIONS = 20;

export function makeVersion(state, { name, kind = "manual", by = "" }) {
  const { changelog: _log, ...rest } = state || {};
  return {
    name: String(name || "Saved version").slice(0, 120), at: Date.now(), by: String(by || "").slice(0, 80), kind,
    sessions: Object.keys(state?.appointments || {}).length, courses: (state?.courses || []).length,
    data: JSON.stringify(rest),
  };
}

/** The state a version holds, ready to put into the term. The term keeps its own name and activity log. */
export function stateFromVersion(version, current) {
  const saved = sanitizeState(JSON.parse(version.data));
  return { ...saved, changelog: current?.changelog || [], settings: { ...saved.settings, semester: current?.settings?.semester ?? saved.settings?.semester ?? "" } };
}

/** Which versions to delete so at most `max` remain: automatic ones go first, oldest first. */
export function versionsToPrune(list, max = MAX_VERSIONS) {
  const extra = list.length - max;
  if (extra <= 0) return [];
  const order = [...list].sort((a, b) => (a.kind === "auto" ? 0 : 1) - (b.kind === "auto" ? 0 : 1) || a.at - b.at);
  return order.slice(0, extra).map(v => v.id);
}

// ── This device only (no shared term) ──
const key = k => `kronos_versions_v1_${k || "local"}`;
export const localVersions = {
  list(termKey) {
    try { return (JSON.parse(localStorage.getItem(key(termKey)) || "[]") || []).sort((a, b) => b.at - a.at); } catch { return []; }
  },
  save(termKey, id, v) {
    try { const l = this.list(termKey).filter(x => x.id !== id); l.push({ id, ...v }); localStorage.setItem(key(termKey), JSON.stringify(l)); return true; } catch { return false; }
  },
  remove(termKey, id) {
    try { localStorage.setItem(key(termKey), JSON.stringify(this.list(termKey).filter(x => x.id !== id))); } catch { /* storage unavailable */ }
  },
};
