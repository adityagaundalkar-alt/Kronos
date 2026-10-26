# Kronos 2.0 — Collaborative Timetable Builder

A full-featured academic timetable scheduling app built with React + Vite.

## Features
- Visual weekly schedule grid (Orientation + 16 weeks)
- Auto-scheduler with instructor availability & conflict detection
- Dashboard with load charts and session analytics
- Collaborative rooms with live presence (Firebase-ready)
- Courses, instructors, rooms, student groups management
- Export to CSV / JSON

---

## Deploy in 5 minutes (Vercel)

### 1. Install dependencies
```bash
npm install
```

### 2. Run locally
```bash
npm run dev
```
Open http://localhost:5173

### 3. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
gh repo create kronos-timetable --public --push
```
(or create the repo manually on github.com and follow the push instructions)

### 4. Deploy to Vercel
1. Go to https://vercel.com → **Add New Project**
2. Import your GitHub repo
3. Framework: **Vite** (auto-detected)
4. Click **Deploy**

That's it. You get a live `https://kronos-timetable.vercel.app` URL.

---

## Real-time collaboration (Firebase)

Teams collaborate by sharing a **room code**. Everyone with the code can edit the
timetable together; each change is saved per item (a session, a course, a room...)
so two people editing at once don't overwrite each other, and deletions stay deleted.
You can see who is online and which session each person has open.

The Firebase project is configured in `src/firebase.js`. To set up or secure it:

1. **Enable Anonymous sign-in** — Firebase Console → Authentication → Sign-in method →
   Anonymous → Enable. People who join with just a room code get an anonymous identity,
   which lets the database rules require a signed-in user without making them log in.
2. **Publish the security rules** — Firebase Console → Realtime Database → Rules, paste
   the contents of [`database.rules.json`](database.rules.json) and Publish.
   These rules stop anyone listing all rooms, and only allow access to a room by its code.
3. Keep Google sign-in enabled (Authentication → Sign-in method) for personal cloud save.

Room codes are 8 characters from a cryptographic random source. Treat the code like a
password: anyone who has it can edit that room's timetable.

Rooms created with the older version are migrated automatically the first time someone
joins them.

---

## Tests

```bash
npm test
```
Covers the date helpers (in several timezones), the per-item sync logic, and a
simulation of two people editing the same room at once.

---

## Project structure
```
kronos/
├── index.html          # Entry HTML
├── database.rules.json # Firebase Realtime Database security rules (publish in the console)
├── vite.config.js      # Vite config
├── vercel.json         # SPA routing for Vercel
├── .env.example        # Firebase env template
├── public/
│   └── favicon.svg
└── src/
    ├── main.jsx        # React root mount
    ├── App.jsx         # Application UI
    ├── dates.js        # Timezone-safe date helpers
    ├── sync.js         # Per-item sync logic (pure, tested)
    ├── roomClient.js   # Room collaboration core (tested with simulated clients)
    └── firebase.js     # Firebase setup, auth, rooms, presence
tests/                  # npm test
```
