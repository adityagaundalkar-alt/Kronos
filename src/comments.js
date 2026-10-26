// Comments on sessions (pure helpers). Stored per room at rooms/<rid>/comments/<id>:
//   { apptId, uid, name, role, text, at, resolved? }
// Everyone in the room - including read-only viewers - can add comments; authors can edit/delete their own;
// editors and admins can resolve or delete any (enforced by database.rules.json, mirrored here for the UI).
import { can } from "./access.js";

export const MAX_COMMENT = 2000;

/** Build a new comment, or null if there is nothing to post. */
export function makeComment({ apptId, uid, name, role, text, at = Date.now() }) {
  const clean = String(text ?? "").trim().slice(0, MAX_COMMENT);
  if (!clean || !apptId || !uid) return null;
  return { apptId, uid, name: String(name ?? "").trim().slice(0, 60) || "Someone", role: role || "viewer", text: clean, at };
}

/** Apply one live event (value or null = deleted) to the id -> comment map without mutating it. */
export function applyCommentEvent(map, id, value) {
  if (value == null) {
    if (!(id in map)) return map;
    const { [id]: _gone, ...rest } = map;
    return rest;
  }
  return { ...map, [id]: { ...value, id } };
}

/** { apptId: [comments oldest-first] } */
export function groupByAppt(map) {
  const out = {};
  Object.values(map || {}).forEach(c => { if (c?.apptId) (out[c.apptId] ||= []).push(c); });
  Object.values(out).forEach(list => list.sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id))));
  return out;
}

/** { apptId: number of unresolved comments } - drives the badge on a session. */
export function openCounts(map) {
  const out = {};
  Object.values(map || {}).forEach(c => { if (c?.apptId && !c.resolved) out[c.apptId] = (out[c.apptId] || 0) + 1; });
  return out;
}

export const canDeleteComment = (comment, uid, role) => !!comment && (comment.uid === uid || can(role, "moderate"));
export const canResolveComment = (comment, uid, role) => !!comment && (comment.uid === uid || can(role, "moderate"));
export const canEditComment = (comment, uid) => !!comment && comment.uid === uid;

/** Short "5m ago" style label. */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** Comments whose session no longer exists. */
export const orphanIds = (map, appointments) =>
  Object.values(map || {}).filter(c => c?.apptId && !(appointments || {})[c.apptId]).map(c => c.id);
