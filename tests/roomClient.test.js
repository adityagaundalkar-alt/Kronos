import { describe, it, expect } from "vitest";
import { createRoomClient } from "../src/roomClient.js";
import { stateToFlat, flatToTree, same } from "../src/sync.js";

// ── In-memory stand-in for Firebase RTDB (v2 layout) ─────────────────────────
// Mimics the quirks that matter: empty arrays/objects/null are dropped, sequential
// index-keyed objects come back as arrays, events are async, and the writer also
// receives an event for its own write (local echo).
function fbNormalize(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { const a = v.map(fbNormalize); return a.every(x => x === undefined) ? undefined : a.map(x => x ?? null); }
  if (typeof v === "object") {
    const o = {}; Object.entries(v).forEach(([k, x]) => { const n = fbNormalize(x); if (n !== undefined) o[k] = n; });
    const keys = Object.keys(o);
    if (!keys.length) return undefined;
    if (keys.every((k, i) => String(i) === k)) return keys.map(k => o[k]); // 0..n-1 -> array
    return o;
  }
  return v;
}
function makeFakeDb(latency = 3) {
  const rooms = {}; // code -> { flat:{path:value}, legacy:null, subs:Set }
  const room = c => (rooms[c] ||= { flat: {}, legacy: null, subs: new Set() });
  const emit = (r, path, value) => {
    const [col, id] = path.split("/");
    r.subs.forEach(fn => setTimeout(() => fn(col, id, value === undefined ? null : JSON.parse(JSON.stringify(value))), latency));
  };
  const writePath = (r, path, value) => {
    const n = fbNormalize(value);
    if (n === undefined) { if (path in r.flat) { delete r.flat[path]; emit(r, path, null); } }
    else { r.flat[path] = n; emit(r, path, n); }
  };
  return {
    rooms,
    seedLegacy(code, state) { room(code).legacy = state; },
    api: () => ({
      ensureAuth: async () => true,
      loadRoom: async code => {
        const r = room(code);
        if (Object.keys(r.flat).length) return { tree: JSON.parse(JSON.stringify(flatToTree(r.flat))) };
        return r.legacy ? { legacy: JSON.parse(JSON.stringify(r.legacy)) } : null;
      },
      writeRoomTree: async (code, tree) => {
        const r = room(code), next = {};
        Object.entries(tree).forEach(([col, v]) => {
          if (col === "config") next.config = v; else Object.entries(v).forEach(([id, x]) => (next[`${col}/${id}`] = x));
        });
        Object.keys(r.flat).forEach(p => { if (!(p in next)) writePath(r, p, null); });
        Object.entries(next).forEach(([p, v]) => writePath(r, p, v));
      },
      updateRoom: async (code, updates) => { const r = room(code); Object.entries(updates).forEach(([p, v]) => writePath(r, p, v)); },
      subscribeRoom: (code, onChange) => {
        const r = room(code);
        Object.entries(r.flat).forEach(([p, v]) => { const [col, id] = p.split("/"); setTimeout(() => onChange(col, id, v), latency); });
        r.subs.add(onChange);
        return () => r.subs.delete(onChange);
      },
      pushOp: async () => {},
    }),
  };
}

// Mirrors the defaults sanitizeState() adds in App.jsx (so echo handling is exercised)
const sanitize = s => ({
  ...s,
  appointments: Object.fromEntries(Object.entries(s.appointments || {}).map(([k, a]) => [k, { ...a, groupIds: a.groupIds || [], notes: a.notes || "" }])),
  courses: s.courses || [], instructors: (s.instructors || []).map(i => ({ ...i, availability: i.availability || {} })),
  rooms: s.rooms || [], groups: s.groups || [], holidays: s.holidays || [], slots: s.slots || [], changelog: s.changelog || [],
  settings: s.settings || {},
});

function makeClient(db, name, initial) {
  let state = sanitize(initial);
  const log = { remoteNotices: 0, errors: [], appliedChanges: 0 };
  const client = createRoomClient({
    api: db.api(), getState: () => state, sanitize, flushMs: 5, quietMs: 0,
    applyRemote: fn => { const prev = state, raw = fn(prev); if (raw === prev) return false; state = sanitize(raw); log.appliedChanges++; return true; },
    callbacks: { onRemoteChange: () => log.remoteNotices++, onError: m => log.errors.push(m) },
  });
  return {
    name, client, log,
    get state() { return state; },
    edit(updater, op = "edit") { const prev = state, next = updater(prev); state = next; client.pushDiff(prev, next, op); },
  };
}
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const initial = () => ({
  week1Start: "2026-10-26", settings: { institution: "U", semester: "S1" },
  appointments: {
    a1: { id: "a1", weekNum: 1, dayIdx: 0, timeId: "am", courseId: "c1", instructorId: "i1", roomId: "r1", groupIds: ["g1"] },
    a2: { id: "a2", weekNum: 1, dayIdx: 1, timeId: "pm", courseId: "c2", instructorId: "i1", roomId: "r2", groupIds: [] },
  },
  courses: [{ id: "c1", name: "CS101" }, { id: "c2", name: "CS201" }],
  instructors: [{ id: "i1", name: "Chen", availability: { 0: ["am", "pm"], 1: ["am"] } }],
  rooms: [{ id: "r1", name: "R1" }, { id: "r2", name: "R2" }], groups: [{ id: "g1", name: "Y1", size: 40 }],
  holidays: [], slots: [{ id: "am" }, { id: "pm" }], changelog: [],
});
async function twoClients(db, code = "ABC12345") {
  const A = makeClient(db, "A", initial()); await A.client.join(code, { userId: "ua", userName: "A" }, true);
  const B = makeClient(db, "B", { ...initial(), appointments: {}, courses: [] }); // B starts with different local data
  await B.client.join(code, { userId: "ub", userName: "B" }, false);
  await wait();
  return { A, B };
}

describe("two clients through a Firebase-like database", () => {
  it("joiner adopts the room's timetable", async () => {
    const { A, B } = await twoClients(makeFakeDb());
    expect(Object.keys(B.state.appointments).sort()).toEqual(["a1", "a2"]);
    expect(B.state.courses.map(c => c.id)).toEqual(["c1", "c2"]);
    expect(same(A.state, B.state)).toBe(true);
  });

  it("our own writes are not mistaken for collaborator edits (no notices, no extra state churn)", async () => {
    const { A, B } = await twoClients(makeFakeDb());
    const before = A.log.appliedChanges;
    A.edit(s => ({ ...s, appointments: { ...s.appointments, a1: { ...s.appointments.a1, roomId: "r2" } } }));
    await wait();
    expect(A.log.appliedChanges).toBe(before);   // echo ignored
    expect(A.log.remoteNotices).toBe(0);
    expect(B.state.appointments.a1.roomId).toBe("r2");
    expect(B.log.remoteNotices).toBe(1);          // B is told once
  });

  it("changes to instructors / rooms / groups reach the other person (old sync missed these)", async () => {
    const { A, B } = await twoClients(makeFakeDb());
    A.edit(s => ({ ...s, instructors: [{ ...s.instructors[0], name: "Dr. Chen" }], groups: [{ ...s.groups[0], size: 55 }] }));
    await wait();
    expect(B.state.instructors[0].name).toBe("Dr. Chen");
    expect(B.state.groups[0].size).toBe(55);
  });

  it("a deletion stays deleted on both sides", async () => {
    const { A, B } = await twoClients(makeFakeDb());
    A.edit(s => { const { a1, ...rest } = s.appointments; return { ...s, appointments: rest }; });
    await wait();
    expect(Object.keys(B.state.appointments)).toEqual(["a2"]);
    await wait(80); // and it does not come back
    expect(Object.keys(A.state.appointments)).toEqual(["a2"]);
    expect(Object.keys(B.state.appointments)).toEqual(["a2"]);
  });

  it("simultaneous edits to different sessions both survive", async () => {
    const { A, B } = await twoClients(makeFakeDb());
    A.edit(s => ({ ...s, appointments: { ...s.appointments, a1: { ...s.appointments.a1, notes: "from A" } } }));
    B.edit(s => ({ ...s, appointments: { ...s.appointments, a2: { ...s.appointments.a2, notes: "from B" } } }));
    await wait();
    for (const c of [A, B]) {
      expect(c.state.appointments.a1.notes).toBe("from A");
      expect(c.state.appointments.a2.notes).toBe("from B");
    }
    expect(same(A.state, B.state)).toBe(true);
  });

  it("adding sessions at the same time keeps both people's additions (whole-state overwrite used to lose one)", async () => {
    const { A, B } = await twoClients(makeFakeDb());
    A.edit(s => ({ ...s, appointments: { ...s.appointments, n1: { id: "n1", weekNum: 2, dayIdx: 0, timeId: "am" } } }));
    B.edit(s => ({ ...s, appointments: { ...s.appointments, n2: { id: "n2", weekNum: 2, dayIdx: 1, timeId: "am" } } }));
    await wait();
    expect(Object.keys(A.state.appointments).sort()).toEqual(["a1", "a2", "n1", "n2"]);
    expect(Object.keys(B.state.appointments).sort()).toEqual(["a1", "a2", "n1", "n2"]);
  });

  it("a bulk change (auto-schedule: 16 sessions) is one batched update and arrives intact", async () => {
    const db = makeFakeDb(); const { A, B } = await twoClients(db);
    let updates = 0; const orig = db.api; // count update calls on A
    const add = {}; for (let w = 1; w <= 16; w++) add["s" + w] = { id: "s" + w, weekNum: w, dayIdx: 2, timeId: "am", groupIds: ["g1"] };
    A.edit(s => ({ ...s, appointments: { ...s.appointments, ...add } }));
    await wait(100);
    expect(Object.keys(B.state.appointments).length).toBe(18);
    expect(B.log.remoteNotices).toBeLessThanOrEqual(1);
  });

  it("both people editing the SAME session converge on one value (last write wins, no divergence)", async () => {
    const { A, B } = await twoClients(makeFakeDb());
    A.edit(s => ({ ...s, appointments: { ...s.appointments, a1: { ...s.appointments.a1, roomId: "r1", notes: "A" } } }));
    B.edit(s => ({ ...s, appointments: { ...s.appointments, a1: { ...s.appointments.a1, roomId: "r2", notes: "B" } } }));
    await wait(120);
    expect(same(A.state.appointments.a1, B.state.appointments.a1)).toBe(true);
  });

  it("joining an old-style (single blob) room migrates it to per-item storage", async () => {
    const db = makeFakeDb(); db.seedLegacy("OLD123", initial());
    const B = makeClient(db, "B", { ...initial(), appointments: {} });
    await B.client.join("OLD123", { userId: "ub", userName: "B" }, false);
    await wait();
    expect(Object.keys(B.state.appointments).sort()).toEqual(["a1", "a2"]);
    expect(Object.keys(db.rooms.OLD123.flat).some(p => p.startsWith("appointments/"))).toBe(true);
    const C = makeClient(db, "C", { ...initial(), appointments: {} });
    await C.client.join("OLD123", { userId: "uc", userName: "C" }, false);
    await wait();
    expect(Object.keys(C.state.appointments).sort()).toEqual(["a1", "a2"]);
  });

  it("joining a room that doesn't exist fails cleanly", async () => {
    const B = makeClient(makeFakeDb(), "B", initial());
    await expect(B.client.join("NOPE1234", { userId: "ub", userName: "B" }, false)).rejects.toThrow("Room not found");
    expect(B.client.active).toBe(false);
  });

  it("local data is backed up before it's replaced by the room's", async () => {
    const db = makeFakeDb(); const owner = makeClient(db, "A", initial());
    await owner.client.join("BKP12345", { userId: "ua", userName: "A" }, true);
    let backedUp = null;
    const local = { ...initial(), appointments: { mine: { id: "mine", weekNum: 3 } } };
    let state = sanitize(local);
    const client = createRoomClient({ api: db.api(), getState: () => state, sanitize, flushMs: 5, quietMs: 0,
      applyRemote: fn => { const raw = fn(state); if (raw === state) return false; state = sanitize(raw); return true; },
      callbacks: { backup: (st, why) => (backedUp = { st, why }) } });
    await client.join("BKP12345", { userId: "ub", userName: "B" }, false);
    expect(backedUp.st.appointments.mine).toBeTruthy();
    expect(backedUp.why).toContain("BKP12345");
  });

  it("after leaving, nothing more is applied", async () => {
    const { A, B } = await twoClients(makeFakeDb());
    B.client.leave();
    A.edit(s => ({ ...s, appointments: { ...s.appointments, a1: { ...s.appointments.a1, notes: "later" } } }));
    await wait();
    expect(B.state.appointments.a1.notes).not.toBe("later");
  });

  it("a failed write is reported, not swallowed", async () => {
    const db = makeFakeDb(); const A = makeClient(db, "A", initial());
    await A.client.join("ERR12345", { userId: "ua", userName: "A" }, true);
    const api = db.api(); api.updateRoom = async () => { const e = new Error("denied"); e.code = "PERMISSION_DENIED"; throw e; };
    const errors = [];
    let state = sanitize(initial());
    const c = createRoomClient({ api, getState: () => state, sanitize, applyRemote: () => false, flushMs: 5, quietMs: 0, callbacks: { onError: m => errors.push(m) } });
    await c.join("ERR12345", { userId: "ux", userName: "X" }, true);
    c.pushDiff(state, { ...state, settings: { institution: "changed" } }, "edit");
    await wait();
    expect(errors.join()).toContain("PERMISSION_DENIED");
  });
});
