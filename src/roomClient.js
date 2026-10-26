// Framework-free core of room collaboration. The React hook in App.jsx is a thin
// wrapper around this; keeping it separate lets tests drive two simulated clients
// against an in-memory database.
import { stateToFlat, diffFlat, flatToTree, treeToState, applyRemoteChange } from "./sync.js";

/**
 * api:        { ensureAuth, loadRoom, writeRoomTree, updateRoom, subscribeRoom, pushOp }  (see firebase.js)
 * getState:   () => current app state
 * applyRemote:(fn(prevState) => nextState) => boolean   applies a change WITHOUT pushing it back; true if state changed
 * sanitize:   state => state   fills defaults on state loaded from the room
 * callbacks:  onRemoteChange(), onSyncing(bool), onSynced(), onError(message), backup(state, reason),
 *             onAccessLost()   the database refused us (our code was changed, or the room was locked down)
 *
 * join(code, who, isOwner, { readOnly })  - a read-only member (viewer) never writes the timetable or the activity log.
 */
export function createRoomClient({ api, getState, applyRemote, sanitize, callbacks = {}, flushMs = 30, quietMs = 2000, now = Date.now }) {
  const cb = { onRemoteChange() {}, onSyncing() {}, onSynced() {}, onError() {}, onAccessLost() {}, backup() {}, ...callbacks };
  let code = null, unsubscribe = null, queue = [], timer = null, quietUntil = 0, pending = 0;
  let userId = null, userName = "", readOnly = false;

  function enqueue(col, id, value) {
    queue.push([col, id, value]);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const events = queue; queue = [];
      const changed = applyRemote(s => events.reduce((acc, [c, i, v]) => applyRemoteChange(acc, c, i, v), s));
      if (changed) { cb.onSynced(); if (now() > quietUntil) cb.onRemoteChange(); }
    }, flushMs);
  }

  async function join(roomCode, who, isOwner, opts = {}) {
    readOnly = !!opts.readOnly;
    await api.ensureAuth();
    cb.onSyncing(true);
    try {
      if (isOwner && !readOnly) {
        await api.writeRoomTree(roomCode, flatToTree(stateToFlat(getState())));
      } else {
        const found = await api.loadRoom(roomCode);
        if (!found) throw new Error("Room not found");
        let remote;
        if (found.tree) {
          remote = treeToState(found.tree);
        } else {
          // Old-style room (one blob): adopt it and convert it to per-item storage.
          remote = found.legacy;
          if (!readOnly) await api.writeRoomTree(roomCode, flatToTree(stateToFlat(sanitize(remote))));
        }
        cb.backup(getState(), "before joining room " + roomCode);
        applyRemote(() => sanitize(remote));
      }
    } finally { cb.onSyncing(false); }
    code = roomCode; userId = who.userId; userName = who.userName;
    quietUntil = now() + quietMs; // the initial replay of existing items is not news
    unsubscribe = api.subscribeRoom(roomCode, enqueue, err => {
      if (!code) return; // already left
      cb.onAccessLost(err);
      cb.onError("You no longer have access to this room");
    });
  }

  function leave() {
    try { unsubscribe && unsubscribe(); } catch { /* already detached */ }
    unsubscribe = null; code = null;
    clearTimeout(timer); timer = null; queue = [];
  }

  /** Call after every local change with the state before and after it. */
  function pushDiff(prev, next, opType, opDetail) {
    if (!code || readOnly) return;
    const updates = diffFlat(stateToFlat(prev), stateToFlat(next));
    if (!Object.keys(updates).length) return;
    const room = code;
    pending++; cb.onSyncing(true);
    api.updateRoom(room, updates)
      .then(() => cb.onSynced())
      .catch(err => {
        if (err?.code === "PERMISSION_DENIED") { cb.onAccessLost(err); cb.onError("You no longer have permission to edit this room. Your last change is saved on this device only."); }
        else cb.onError("Couldn't sync your last change (" + (err?.code || "network") + "). It is saved on this device.");
      })
      .finally(() => { if (--pending <= 0) { pending = 0; cb.onSyncing(false); } });
    if (opType) {
      Promise.resolve(api.pushOp(room, { id: Math.random().toString(36).slice(2, 9), userId, userName, at: now(), type: opType, detail: opDetail || "" })).catch(() => {});
    }
  }

  return { join, leave, pushDiff, get active() { return !!code; }, get readOnly() { return readOnly; } };
}
