// Undo / redo. Each change a person makes is stored as the list of items it touched: what each item was before
// and what it became. Undoing puts the "before" back, but only for items nobody else has changed since, so in a
// shared term it never wipes out a teammate's work.
import { stateToFlat, same, applyRemoteChange } from "./sync.js";

export const MAX_HISTORY = 60;

/** What changed between two states, as [{ path, before, after }] (null = absent). The changelog is not undoable. */
export function changesBetween(prev, next) {
  const a = stateToFlat(prev), b = stateToFlat(next);
  const out = [];
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach(path => {
    if (path.startsWith("changelog/")) return;
    const before = a[path] ?? null, after = b[path] ?? null;
    if (!same(before, after)) out.push({ path, before, after });
  });
  return out;
}

export const invert = changes => changes.map(c => ({ path: c.path, before: c.after, after: c.before }));

/** Apply `changes` (before -> after) to `state`. Items that no longer match `before` are skipped and counted. */
export function applyChanges(state, changes) {
  const flat = stateToFlat(state);
  let cur = state, applied = 0, skipped = 0;
  changes.forEach(c => {
    // Compare against the item as it is now: it must still look like the state we are undoing from.
    if (!same(flat[c.path] ?? null, c.before)) { skipped++; return; }
    const [col, id] = c.path.split("/");
    const nextState = applyRemoteChange(cur, col, id, c.after);
    if (nextState !== cur) { cur = nextState; applied++; } else applied++;
  });
  return { state: cur, applied, skipped };
}
