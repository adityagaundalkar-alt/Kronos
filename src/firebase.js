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

// --- User Cloud Save (Solo Mode) ---
export const saveUserState = async (uid, state) => {
  await set(ref(db, `users/${uid}`), { ...state, _savedAt: Date.now() });
};

export const loadUserState = async (uid) => {
  const snapshot = await get(ref(db, `users/${uid}`));
  return snapshot.exists() ? snapshot.val() : null;
};

// --- Collaboration (Room Mode) ---
// Layout:  rooms/<code>/meta          { name, ownerId, createdAt }
//          rooms/<code>/v2/<col>/<id> one node per item (see sync.js)
//          rooms/<code>/ops/<key>     activity log
//          rooms/<code>/presence/<id> who is online / editing what
//          rooms/<code>/state         LEGACY whole-timetable blob (read once to migrate)
const roomRef = (code, path = "") => ref(db, `rooms/${code}${path ? "/" + path : ""}`);

export const registerRoom = (code, name, ownerId) =>
  set(roomRef(code, "meta"), { name, ownerId, createdAt: Date.now() });

export const roomExists = async (code) => {
  if ((await get(roomRef(code, "meta"))).exists()) return true;
  if ((await get(roomRef(code, "v2/config"))).exists()) return true;
  return (await get(roomRef(code, "state"))).exists();
};

export const getRoomMeta = async (code) => {
  const s = await get(roomRef(code, "meta"));
  return s.exists() ? s.val() : null;
};

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
