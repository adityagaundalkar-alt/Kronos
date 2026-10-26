import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  remove,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  query,
  limitToLast
} from "firebase/database";
import { COLLECTIONS } from "./sync.js";
import { createAccess } from "./access.js";

// Web API keys are not secrets; access is controlled by the Realtime Database
// rules (see database.rules.json).
const firebaseConfig = {
  apiKey: "AIzaSyD0ZbCo4swkchf51jr0Jrh6DfrExwGw93Q",
  authDomain: "kronos-fcada.firebaseapp.com",
  databaseURL: "https://kronos-fcada-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kronos-fcada",
  storageBucket: "kronos-fcada.firebasestorage.app",
  messagingSenderId: "1087373672487",
  appId: "1:1087373672487:web:ae8af09338753081d54e02",
  measurementId: "G-PYLCGVQJZL"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

// --- Auth Functions ---
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

/** Turn a Firebase auth error into something a person can act on. `silent` = not worth showing. */
export const explainAuthError = (e) => {
  const code = e?.code || "";
  const host = typeof location !== "undefined" ? location.hostname : "this site";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return { silent: true, message: "" };
    case "auth/unauthorized-domain":
      return { message: `Google sign-in isn't allowed on "${host}" yet. A Firebase admin needs to add it: Firebase Console → Authentication → Settings → Authorized domains → Add domain "${host}".` };
    case "auth/popup-blocked":
      return { message: "Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again." };
    case "auth/network-request-failed":
      return { message: "Couldn't reach Google — check your connection and try again." };
    case "auth/operation-not-allowed":
      return { message: "Google sign-in isn't switched on for this Firebase project (Authentication → Sign-in method → Google)." };
    default:
      return { message: e?.message || "Sign-in failed. Please try again." };
  }
};
export const signOutUser = () => signOut(auth);
export const onAuthChange = (callback) => onAuthStateChanged(auth, callback);

/**
 * Make sure there is some Firebase identity so room reads/writes pass rules
 * that require `auth != null`. People who join with only a room code get an
 * anonymous identity. Returns true if the session is authenticated.
 */
export const ensureAuth = async () => {
  if (auth.currentUser) return true;
  try {
    await signInAnonymously(auth);
    return true;
  } catch (e) {
    console.warn("Anonymous sign-in unavailable:", e?.code || e);
    return false; // rooms still work if the database rules allow unauthenticated access
  }
};

// --- Terms (shared by everyone who joins them) ---
// Layout:  codes/<CODE>                 { rid, role }   what a join code opens (see access.js)
//          rooms/<rid>/meta             { name, ownerId, createdAt }
//          rooms/<rid>/secrets/<role>   the room's admin / editor / viewer codes (role-restricted reads)
//          rooms/<rid>/access/<CODE>/<uid>  who joined with which code
//          rooms/<rid>/v2/<col>/<id>    one node per item (see sync.js)
//          rooms/<rid>/comments/<id>    comments on sessions
//          rooms/<rid>/ops/<key>        activity log
//          rooms/<rid>/presence/<id>    who is online / editing what
//          rooms/<rid>/state            LEGACY whole-timetable blob (read once to migrate)
const roomRef = (code, path = "") => ref(db, `rooms/${code}${path ? "/" + path : ""}`);

/** Database paths as a tiny get/set/update/remove interface (what access.js is written against). */
const store = {
  get: async (path) => { const s = await get(ref(db, path)); return s.exists() ? s.val() : null; },
  set: (path, value) => set(ref(db, path), value),
  update: (path, obj) => update(ref(db, path), obj),
  remove: (path) => remove(ref(db, path)),
};
export const access = createAccess(store, () => auth.currentUser?.uid || null);

export const getRoomMeta = async (rid) => store.get(`rooms/${rid}/meta`);
/** Live term details (name, archived). onChange gets {} when there is nothing yet. */
export const subscribeMeta = (rid, onChange, onError) =>
  onValue(roomRef(rid, "meta"), (snap) => onChange(snap.val() || {}), onError);

// --- The terms a signed-in person belongs to (private to them; lets any device list them) ---
export const listMyTerms = async (uid) => {
  const v = await store.get(`users/${uid}/terms`);
  return v ? Object.values(v).filter((t) => t && t.code) : [];
};
export const saveMyTerm = (uid, term) => set(ref(db, `users/${uid}/terms/${term.code}`), term);
export const removeMyTerm = (uid, code) => remove(ref(db, `users/${uid}/terms/${code}`));

/** Returns { tree } (v2 data), { legacy } (old whole-state blob) or null. */
export const loadRoom = async (code) => {
  const v2 = await get(roomRef(code, "v2"));
  if (v2.exists()) return { tree: v2.val() };
  const legacy = await get(roomRef(code, "state"));
  return legacy.exists() ? { legacy: legacy.val() } : null;
};

export const writeRoomTree = (code, tree) => set(roomRef(code, "v2"), tree);

/** Multi-path update of changed items only: { "appointments/abc": {...}, "courses/x": null } */
export const updateRoom = (code, updates) =>
  update(roomRef(code, "v2"), updates);

/**
 * Live per-item listeners. onChange(collection, id, value|null) fires once per
 * existing item at start, then for every later add/change/remove (including our
 * own writes, which callers should treat as no-ops). Returns an unsubscribe fn.
 */
export const subscribeRoom = (code, onChange, onError) => {
  const unsubs = [];
  COLLECTIONS.forEach((col) => {
    const r = roomRef(code, `v2/${col}`);
    const fire = (snap) => onChange(col, snap.key, snap.val());
    unsubs.push(onChildAdded(r, fire, onError));
    unsubs.push(onChildChanged(r, fire, onError));
    unsubs.push(onChildRemoved(r, (snap) => onChange(col, snap.key, null), onError));
  });
  unsubs.push(onValue(roomRef(code, "v2/config"), (snap) => onChange("config", undefined, snap.val()), onError));
  return () => unsubs.forEach((u) => { try { u(); } catch { /* already detached */ } });
};

// --- Comments on sessions ---
export const subscribeComments = (rid, onChange, onError) => {
  const r = roomRef(rid, "comments");
  const unsubs = [
    onChildAdded(r, (snap) => onChange(snap.key, snap.val()), onError),
    onChildChanged(r, (snap) => onChange(snap.key, snap.val()), onError),
    onChildRemoved(r, (snap) => onChange(snap.key, null), onError),
  ];
  return () => unsubs.forEach((u) => { try { u(); } catch { /* already detached */ } });
};
export const newCommentId = (rid) => push(roomRef(rid, "comments")).key;
export const saveComment = (rid, id, comment) => set(roomRef(rid, `comments/${id}`), comment);
export const patchComment = (rid, id, fields) => update(roomRef(rid, `comments/${id}`), fields);
export const deleteComment = (rid, id) => remove(roomRef(rid, `comments/${id}`));

// --- Activity log ---
export const pushOp = (code, op) => push(roomRef(code, "ops"), op);

export const subscribeOps = (code, cb) => {
  const q = query(roomRef(code, "ops"), limitToLast(50));
  return onChildAdded(q, (snap) => cb({ key: snap.key, ...snap.val() }));
};

// --- Presence (one node per user; removed automatically on disconnect) ---
export const subscribePresence = (code, cb) =>
  onValue(roomRef(code, "presence"), (snap) => cb(snap.val() || {}));

/**
 * Announce ourselves in a room. Re-announces after network reconnects and
 * removes our node when the connection drops. Returns { update(fields), leave() }.
 */
export const joinPresence = (code, userId, initial) => {
  const me = roomRef(code, `presence/${userId}`);
  let data = { ...initial, at: Date.now() };
  const announce = () => {
    onDisconnect(me).remove().catch(() => {});
    set(me, { ...data, at: Date.now() }).catch(() => {});
  };
  const offConn = onValue(ref(db, ".info/connected"), (snap) => { if (snap.val() === true) announce(); });
  const beat = setInterval(() => update(me, { at: Date.now() }).catch(() => {}), 20000);
  return {
    update(fields) {
      data = { ...data, ...fields };
      update(me, { ...fields, at: Date.now() }).catch(() => {});
    },
    async leave() {
      clearInterval(beat);
      try { offConn(); } catch { /* ignore */ }
      try { await onDisconnect(me).cancel(); await remove(me); } catch { /* ignore */ }
    },
  };
};
