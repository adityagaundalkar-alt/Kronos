import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  onValue, 
  push, 
  update 
} from "firebase/database";

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

// --- User Cloud Save (Solo Mode) ---
export const saveUserState = async (uid, state) => {
  await set(ref(db, `users/${uid}`), { ...state, _savedAt: Date.now() });
};

export const loadUserState = async (uid) => {
  const snapshot = await get(ref(db, `users/${uid}`));
  return snapshot.exists() ? snapshot.val() : null;
};

// --- Collaboration (Room Mode) ---
export const registerRoom = async (code, name, ownerId) => {
  await set(ref(db, `rooms/${code}/meta`), { name, ownerId, createdAt: Date.now() });
};

export const listRooms = async () => {
  const snapshot = await get(ref(db, 'rooms'));
  if (!snapshot.exists()) return [];
  return Object.entries(snapshot.val()).map(([code, data]) => ({
    code,
    name: data.meta?.name || "Untitled",
    createdAt: data.meta?.createdAt
  }));
};

export const colSave = async (code, state) => {
  await set(ref(db, `rooms/${code}/state`), state);
};

export const colLoad = async (code) => {
  const snapshot = await get(ref(db, `rooms/${code}/state`));
  return snapshot.exists() ? snapshot.val() : null;
};

export const colPushOp = async (code, op) => {
  await push(ref(db, `rooms/${code}/ops`), op);
};

export const colGetOps = async (code) => {
  const snapshot = await get(ref(db, `rooms/${code}/ops`));
  return snapshot.exists() ? Object.values(snapshot.val()) : [];
};

export const colSetPresence = async (code, presence) => {
  await set(ref(db, `rooms/${code}/presence`), presence);
};

export const colGetPresence = async (code) => {
  const snapshot = await get(ref(db, `rooms/${code}/presence`));
  return snapshot.exists() ? snapshot.val() : {};
};

export const subscribeToRoom = (code, callback) => {
  return onValue(ref(db, `rooms/${code}/state`), (snapshot) => {
    callback(snapshot.val());
  });
};