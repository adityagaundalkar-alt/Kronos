// ─────────────────────────────────────────────────────────────────
//  firebase.js  —  Real-time collaboration backend
//
//  SETUP STEPS:
//  1. npm install firebase
//  2. Go to console.firebase.google.com
//  3. Create a project → Add web app → copy firebaseConfig
//  4. Enable "Realtime Database" in the Firebase console
//  5. Set database rules to:
//       { "rules": { ".read": true, ".write": true } }   ← for dev
//  6. Fill in .env.local (copy from .env.example)
//  7. Uncomment everything below
// ─────────────────────────────────────────────────────────────────

// import { initializeApp } from 'firebase/app'
// import { getDatabase, ref, get, set, push, onValue, serverTimestamp } from 'firebase/database'
//
// const firebaseConfig = {
//   apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
//   authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
//   databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
//   projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
//   appId:             import.meta.env.VITE_FIREBASE_APP_ID,
// }
//
// const app = initializeApp(firebaseConfig)
// export const db = getDatabase(app)
// export { ref, get, set, push, onValue, serverTimestamp }

// ─── Replace collab functions in App.jsx with these ──────────────
//
// export async function colLoad(roomCode) {
//   const snap = await get(ref(db, `rooms/${roomCode}/state`))
//   return snap.exists() ? snap.val() : null
// }
// export async function colSave(roomCode, state) {
//   await set(ref(db, `rooms/${roomCode}/state`), state)
// }
// export async function colGetPresence(roomCode) {
//   const snap = await get(ref(db, `rooms/${roomCode}/presence`))
//   return snap.exists() ? snap.val() : {}
// }
// export async function colSetPresence(roomCode, presence) {
//   await set(ref(db, `rooms/${roomCode}/presence`), presence)
// }
// export async function colPushOp(roomCode, op) {
//   await push(ref(db, `rooms/${roomCode}/ops`), op)
// }
// export async function colGetOps(roomCode) {
//   const snap = await get(ref(db, `rooms/${roomCode}/ops`))
//   if (!snap.exists()) return []
//   return Object.values(snap.val()).slice(-200)
// }
// export async function listRooms() {
//   const snap = await get(ref(db, 'rooms_index'))
//   return snap.exists() ? Object.values(snap.val()) : []
// }
// export async function registerRoom(code, name) {
//   await set(ref(db, `rooms_index/${code}`), { code, name, createdAt: Date.now() })
// }

export {}
