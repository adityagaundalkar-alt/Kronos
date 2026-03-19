# Kronos — Collaborative Timetable Builder

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

## Enable Real-time Collaboration (Firebase)

The app ships with localStorage-based collab stubs so it works offline.
To enable true real-time multi-user sync:

### 1. Create a Firebase project
1. Go to https://console.firebase.google.com
2. Create project → Add web app → copy `firebaseConfig`
3. Go to **Realtime Database** → Create database → Start in test mode

### 2. Install Firebase
```bash
npm install firebase
```

### 3. Configure environment
```bash
cp .env.example .env.local
# Fill in your Firebase values in .env.local
```

### 4. Swap the collab functions
Open `src/firebase.js` and follow the instructions inside — uncomment the
Firebase implementation and import those functions into `App.jsx` in place
of the localStorage stubs (search for `colLoad`, `colSave`, etc.).

### 5. Add env vars to Vercel
In your Vercel project → Settings → Environment Variables, add each
`VITE_FIREBASE_*` key from your `.env.local`.

---

## Project structure
```
kronos/
├── index.html          # Entry HTML
├── vite.config.js      # Vite config
├── vercel.json         # SPA routing for Vercel
├── .env.example        # Firebase env template
├── public/
│   └── favicon.svg
└── src/
    ├── main.jsx        # React root mount
    ├── App.jsx         # Full application (single file)
    └── firebase.js     # Firebase setup + collab functions (ready to enable)
```
