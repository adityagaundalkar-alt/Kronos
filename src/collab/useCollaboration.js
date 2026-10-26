// Room collaboration for the React app: joining by code (with a role), live presence,
// comments, and recovering when someone's access changes. The data syncing itself lives in
// roomClient.js; roles and codes live in access.js and the database rules.
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { auth, ensureAuth, loadRoom, writeRoomTree, updateRoom, subscribeRoom, pushOp, subscribePresence, joinPresence,
  access, getRoomMeta, subscribeMeta, subscribeComments, newCommentId, saveComment, patchComment, deleteComment } from "../firebase.js";
import { createRoomClient } from "../roomClient.js";
import { uid, USER_COLORS, userColor } from "../constants.js";
import { rememberRoom } from "../state.js";
import { applyCommentEvent, groupByAppt, openCounts, makeComment } from "../comments.js";
import { can } from "../access.js";

const PRESENCE_STALE_MS = 60000;

export function useCollaboration({ getState, applyRemote, toast, sanitize, backup }) {
  const [session, setSession] = useState(null);
  const [rawPresence, setRawPresence] = useState({});
  const [tick, setTick] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [commentMap, setCommentMap] = useState({});
  const [accessLost, setAccessLost] = useState(null); // { roomName, code } once we can no longer get back in
  const sessionRef = useRef(null);
  const cleanupRef = useRef([]);
  const presenceCtl = useRef(null);
  const lastToastAt = useRef(0);
  const clientRef = useRef(null);
  const busy = useRef(false);        // a join / rejoin is in progress
  const lostGuard = useRef(0);
  const onLostRef = useRef(() => {});

  if (!clientRef.current) {
    clientRef.current = createRoomClient({
      api: { ensureAuth, loadRoom, writeRoomTree, updateRoom, subscribeRoom, pushOp },
      getState, applyRemote, sanitize,
      callbacks: {
        onRemoteChange: () => {
          const t = Date.now();
          if (t - lastToastAt.current > 8000) { lastToastAt.current = t; toast("Schedule updated by a collaborator", "info"); }
        },
        onSyncing: setSyncing,
        onSynced: () => setLastSyncAt(Date.now()),
        onError: msg => toast(msg, "warn"),
        onAccessLost: () => onLostRef.current(),
        backup,
      },
    });
  }
  const client = clientRef.current;

  function teardown() {
    client.leave();
    cleanupRef.current.forEach(fn => { try { fn(); } catch { /* already detached */ } });
    cleanupRef.current = [];
    try { presenceCtl.current?.leave(); } catch { /* ignore */ }
    presenceCtl.current = null; sessionRef.current = null;
    setSession(null); setRawPresence({}); setCommentMap({});
  }

  // Connect to a room we already have access to (the database role was settled by access.join / createRoom).
  async function attach({ rid, role, code, legacy, roomName, create }, userName, existingColor) {
    const sess = {
      rid, roomCode: rid, code, role, legacy: !!legacy, roomName: roomName || "",
      userId: uid(), uid: auth.currentUser?.uid || null, userName,
      userColor: existingColor || userColor(Math.floor(Math.random() * USER_COLORS.length)),
    };
    await client.join(rid, { userId: sess.userId, userName }, !!create, { readOnly: role === "viewer" });
    sessionRef.current = sess; setSession(sess); setAccessLost(null);
    cleanupRef.current.push(subscribePresence(rid, setRawPresence));
    cleanupRef.current.push(subscribeMeta(rid, m => {            // the term's name, and whether an admin has archived it
      const cur = sessionRef.current;
      if (!cur || cur.rid !== rid) return;
      const archived = m.archived === true, name = m.name || cur.roomName;
      client.setReadOnly(cur.role === "viewer" || archived);
      if (archived !== !!cur.archived || name !== cur.roomName) {
        const next = { ...cur, archived, roomName: name };
        sessionRef.current = next; setSession(next);
        rememberRoom(cur.code, name, cur.role, archived);
      }
    }, () => {}));
    cleanupRef.current.push(subscribeComments(rid, (id, v) => setCommentMap(m => applyCommentEvent(m, id, v)), () => {}));
    presenceCtl.current = joinPresence(rid, sess.userId, { name: userName, color: sess.userColor, role, tab: "schedule", editing: null });
    const t = setInterval(() => setTick(x => x + 1), 15000); // re-evaluate who is stale
    cleanupRef.current.push(() => clearInterval(t));
    return sess;
  }

  /** Join an existing room with any of its codes. Resolves to the new session. */
  async function joinRoom(code, userName) {
    busy.current = true;
    try {
      await ensureAuth();
      const found = await access.join(code);            // throws "Room not found" for an unknown code
      let roomName = "";
      try { roomName = (await getRoomMeta(found.rid))?.name || ""; } catch { /* viewers of some rooms can't read meta */ }
      const sess = await attach({ ...found, roomName }, userName);
      rememberRoom(found.code, roomName, found.role);
      return sessionRef.current || sess;
    } finally { busy.current = false; }
  }

  /** Create a room; the creator becomes its admin and the current timetable becomes the room's. */
  async function createRoom(roomName, userName) {
    busy.current = true;
    try {
      await ensureAuth();
      const made = await access.createRoom({ name: roomName });
      const sess = await attach({ rid: made.rid, role: "admin", code: made.codes.admin, roomName, create: true }, userName);
      rememberRoom(made.codes.admin, roomName, "admin");
      return { sess, codes: made.codes };
    } finally { busy.current = false; }
  }

  async function leaveRoom() { teardown(); }

  /** Join again with the same code, e.g. after signing in or out changed our identity. */
  const rejoin = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || busy.current) return false;
    const { code, userName, roomName, userColor: color } = s;
    teardown();
    busy.current = true;
    try {
      await ensureAuth();
      const found = await access.join(code);
      await attach({ ...found, roomName }, userName, color);
      return true;
    } catch (e) {
      setAccessLost({ roomName, code, reason: e?.message === "Room not found" ? "code-changed" : "error" });
      return false;
    } finally { busy.current = false; }
  }, []);

  onLostRef.current = async () => {
    const now = Date.now();
    if (!sessionRef.current || busy.current || now - lostGuard.current < 15000) return;
    lostGuard.current = now;
    const ok = await rejoin();
    if (ok) toast("Your access to the room was refreshed", "info");
  };

  /** Archive the open term (read-only for everybody) or reopen it. Admins only. */
  async function setArchived(archived) {
    const s = sessionRef.current;
    if (!s) return;
    await access.setArchived(s.rid, archived); // the meta listener updates the session
  }

  /** Give an old room roles (creator only). Other people rejoin with the old code, which now means "editor". */
  async function upgradeLegacy() {
    const s = sessionRef.current;
    const up = await access.upgradeLegacy(s.rid);
    const next = { ...s, role: "admin", legacy: false, code: up.codes.admin };
    sessionRef.current = next; setSession(next);
    presenceCtl.current?.update({ role: "admin" });
    rememberRoom(up.codes.admin, s.roomName, "admin");
    return up.codes;
  }

  /** The admin code changed (the session must remember the new one to be able to rejoin). */
  function updateSessionCode(code) {
    const s = sessionRef.current;
    if (!s) return;
    const next = { ...s, code };
    sessionRef.current = next; setSession(next);
    rememberRoom(code, s.roomName, s.role);
  }

  const pushDiff = (prev, next, opType, opDetail) => client.pushDiff(prev, next, opType, opDetail);
  const setPresenceFields = fields => presenceCtl.current?.update(fields);

  const presence = useMemo(() => {
    const now = Date.now(), out = {};
    Object.entries(rawPresence || {}).forEach(([id, p]) => { if (p && now - (p.at || 0) < PRESENCE_STALE_MS) out[id] = p; });
    return out;
  }, [rawPresence, tick]);

  // ── Comments ──
  const commentMapRef = useRef({});
  commentMapRef.current = commentMap;
  const comments = useMemo(() => ({ all: commentMap, byAppt: groupByAppt(commentMap), open: openCounts(commentMap) }), [commentMap]);
  const commentApi = useMemo(() => ({
    async add(apptId, text) {
      const s = sessionRef.current;
      if (!s) return false;
      const c = makeComment({ apptId, uid: s.uid, name: s.userName, role: s.role, text });
      if (!c) return false;
      const id = newCommentId(s.rid);
      setCommentMap(m => applyCommentEvent(m, id, c)); // show it straight away
      try { await saveComment(s.rid, id, c); return true; }
      catch { setCommentMap(m => applyCommentEvent(m, id, null)); toast("Couldn't post your comment. Check your connection and try again.", "warn"); return false; }
    },
    async setResolved(c, resolved) {
      const s = sessionRef.current;
      if (!s) return;
      try { await patchComment(s.rid, c.id, { resolved: resolved ? true : null }); }
      catch { toast("Couldn't update the comment", "warn"); }
    },
    async remove(c) {
      const s = sessionRef.current;
      if (!s) return;
      try { await deleteComment(s.rid, c.id); } catch { toast("Couldn't delete the comment", "warn"); }
    },
    /** Best-effort tidy-up when a session is deleted. */
    async removeForAppt(apptId) {
      const s = sessionRef.current;
      if (!s || !can(s.role, "moderate")) return;
      const ids = Object.values(commentMapRef.current).filter(c => c.apptId === apptId).map(c => c.id);
      await Promise.all(ids.map(id => deleteComment(s.rid, id).catch(() => {})));
    },
  }), []);
  useEffect(() => () => { // leave cleanly if the component unmounts
    client.leave();
    cleanupRef.current.forEach(fn => { try { fn(); } catch { /* ignore */ } });
    presenceCtl.current?.leave();
  }, []);

  const role = session?.role || null;
  return {
    session, role, canEdit: !session || (can(role, "edit") && !session.archived), archived: !!session?.archived, presence, syncing, lastSyncAt,
    comments, commentApi, accessLost, clearAccessLost: () => setAccessLost(null),
    joinRoom, createRoom, leaveRoom, rejoin, setArchived, upgradeLegacy, updateSessionCode, pushDiff, setPresenceFields,
  };
}
