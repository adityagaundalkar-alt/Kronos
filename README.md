# Kronos 2.0 — Collaborative Timetable Builder

A full-featured academic timetable scheduling app built with React + Vite.

## Features
- Visual weekly schedule grid (Orientation + 16 weeks)
- Auto-scheduler that places whole courses at once: per-week flexibility, holidays, room capacity from student-group sizes, instructor availability and load, soft preferences (days / times), pinned sessions it never moves, a live preview of which times work, and plain-language reasons when something can't be placed
- Roles: **admin**, **editor** and **view only** (read-only share links for instructors and students)
- Comments on sessions (viewers can comment too), with open-comment badges and a Comments view
- Responsive layout (phone agenda view, bottom tab bar), light and dark themes
- Dashboard with load charts and session analytics
- Terms: each term has its own timetable that the whole team edits together live (Firebase). Start a term from scratch, or reuse the instructors, rooms and groups of an earlier one. Finished terms can be archived (read-only) and stay listed under "Older terms"
- Optional custom start/end times for a session inside a slot (e.g. 10:00–11:30 in a 09:00–12:00 slot); clashes are detected by real time overlap, back-to-back sessions are fine
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

## Terms and real-time collaboration (Firebase)

Everyone works inside a **term**. The first screen lists the terms you belong to (this browser's list, plus your account's if you sign in with Google), with older, archived terms in their own section. From there you can start a new term (empty, or reusing the instructors, rooms, student groups and time slots of an earlier term; classes are never copied) or join one with a code. Every term has three codes, one per role:

| Role | Can do | Gets it by |
|------|--------|-----------|
| Admin | everything, plus share links and changing codes | the code shown once to the term's creator |
| Editor | edit the timetable and comment | the editor code or link |
| View only | read the timetable and comment | the read-only code or link |

Anyone joins with just a code (or a `?join=CODE` link). No account is needed. The database
rules enforce the roles, so a viewer can't edit even by tampering with the app, and viewers
never see the editor or admin codes. An admin can change a code (everyone holding the old
one is locked out), turn the read-only link off and on, or **archive** the term: it becomes read-only for everybody (no edits, no new comments) until an admin reopens it.

Each change is saved per item (a session, a course, a room...) so two people editing at once
don't overwrite each other, and deletions stay deleted. You can see who is online and which
session each person has open.

Notes:
- Admin rights belong to the browser (anonymous identity) that created or joined with the admin
  code, so save the admin code to get them back on another device.
- Terms made before roles existed keep working: everyone with the code can edit. Their
  creator can switch on roles from the Share dialog; the old code then becomes the editor code.
- To start fresh, delete the old `rooms`, `codes` and `users` nodes in the Realtime Database console. The app no longer keeps a personal cloud copy, and demo data is gone.

The Firebase project is configured in `src/firebase.js`. To set up or secure it:

1. **Enable Anonymous sign-in**: Firebase Console → Authentication → Sign-in method →
   Anonymous → Enable. People who join with just a code get an anonymous identity.
2. **Add your site as an authorized domain**: Authentication → Settings → Authorized domains.
3. **Publish the security rules**: Firebase Console → Realtime Database → Rules, paste
   the contents of [`database.rules.json`](database.rules.json) and Publish. **Do this again
   whenever the file changes** (the role rules need it). The file is generated from
   `scripts/rules.mjs`; run `node scripts/rules.mjs` after editing that.
4. Keep Google sign-in enabled for personal cloud save.

Codes are 8 characters from a cryptographic random source. Treat the editor and admin codes
like passwords.

---

## Tests

```bash
npm test
```
Covers the date helpers (in several timezones), per-item sync, two people editing a room at
once, the scheduler (including a randomized no-clash check), roles and access codes, comments,
and the database rules. The rules tests run against a small in-memory evaluator that
approximates Firebase's rule engine (`tests/helpers/rulesDb.js`); it is not the official
emulator, so check a real two-browser session after publishing new rules.

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
├── scripts/rules.mjs  # Source of the database rules (generates database.rules.json)
└── src/
    ├── main.jsx        # React root mount
    ├── App.jsx         # Root app and the schedule / course / settings views
    ├── scheduler.js    # Auto-scheduler engine (pure, tested)
    ├── access.js       # Roles, codes and share links (pure, tested)
    ├── comments.js     # Comment logic (pure, tested)
    ├── dates.js        # Timezone-safe date helpers
    ├── sync.js         # Per-item sync logic (pure, tested)
    ├── timeslots.js    # Slot / custom-time parsing and overlap rules (pure, tested)
    ├── conflicts.js    # Conflict engine (pure, tested)
    ├── roomClient.js   # Room collaboration core (tested with simulated clients)
    ├── firebase.js     # Firebase setup, auth, rooms, comments, presence
    ├── constants.js, state.js
    ├── ui/             # Design tokens (app.css), icons, shared components
    ├── shell/          # Navigation rail / tab bar, login screen
    ├── collab/         # Room hook and share / join / presence UI
    └── features/       # Auto-schedule, comments, availability grid
tests/                  # npm test
```
