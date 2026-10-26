// Room access: roles, codes and share links (framework-free).
//
// Every room has up to three secret codes - one per role:
//   admin  - everything, plus sharing / rotating codes
//   editor - edit the timetable, comment
//   viewer - read the timetable, comment   (the "read-only link")
// Anyone holding a code joins with just that code (no account). The database rules
// (database.rules.json) enforce the roles: a person's role is whichever code they used
// to claim access. Editors and viewers can never read codes of a higher role.
//
// Layout in the database:
//   codes/<CODE>                       { rid, role }     lookup used when joining
//   rooms/<rid>/secrets/{admin,editor,viewer}  the codes (read only by that role and above)
//   rooms/<rid>/access/<CODE>/<uid>    true              "this user joined with this code"
//
// All functions take a `store` ({ get, set, update, remove } on database paths), so they run
// against Firebase in the app and against an in-memory database with the real rules in tests.

export const ROLES = ["admin", "editor", "viewer"];
export const ROLE_LABEL = { admin: "Admin", editor: "Editor", viewer: "Viewer" };
export const ROLE_BLURB = {
  admin: "Full control, including sharing and changing codes",
  editor: "Can edit the timetable and comment",
  viewer: "Can view and comment, but not edit",
};

const CAN = {
  admin: { view: true, comment: true, edit: true, share: true, moderate: true },
  editor: { view: true, comment: true, edit: true, share: false, moderate: true },
  viewer: { view: true, comment: true, edit: false, share: false, moderate: false },
};
/** What a role may do. `action`: view | comment | edit | share | moderate (delete others' comments). */
export const can = (role, action) => !!CAN[role]?.[action];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const randomString = (chars, len) => {
  const buf = new Uint32Array(len);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, n => chars[n % chars.length]).join("");
};
/** 8-character join code (32^8 ~ 1e12 combinations). */
export const genCode = (len = 8) => randomString(CODE_CHARS, len);
/** Internal room id (never typed by people). */
export const genRid = () => randomString(RID_CHARS, 16);

export const normalizeCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isValidCode = c => /^[A-Z0-9]{6,12}$/.test(c);

/** Link that opens the app and joins with this code. */
export const joinLink = (origin, code) => `${String(origin).replace(/\/+$/, "")}/?join=${encodeURIComponent(code)}`;
/** Code carried by a link's query string (`?join=CODE`), or "". */
export function codeFromSearch(search) {
  try { return normalizeCode(new URLSearchParams(search).get("join")); } catch { return ""; }
}

const isDenied = e => e?.code === "PERMISSION_DENIED" || /permission[_ ]denied/i.test(e?.message || "");

export function createAccess(store, getUid) {
  const uid = () => {
    const u = getUid();
    if (!u) throw new Error("Not signed in");
    return u;
  };

  /** Make a room and its three codes; the caller becomes its admin. */
  async function createRoom({ name, rid = genRid(), makeCode = genCode }) {
    const me = uid();
    const codes = { admin: makeCode(), editor: makeCode(), viewer: makeCode() };
    await store.set(`rooms/${rid}/secrets`, codes);                    // first writer wins
    await store.set(`rooms/${rid}/access/${codes.admin}/${me}`, true);  // now an admin
    for (const role of ROLES) await store.set(`codes/${codes[role]}`, { rid, role });
    await store.set(`rooms/${rid}/meta`, { name, ownerId: me, createdAt: Date.now(), v: 3 });
    return { rid, codes, role: "admin" };
  }

  /** What does this code open? { rid, role, legacy } or null. */
  async function resolve(code) {
    code = normalizeCode(code);
    if (!isValidCode(code)) return null;
    let entry = null;
    try { entry = await store.get(`codes/${code}`); } catch (e) { if (!isDenied(e)) throw e; }
    if (entry?.rid && ROLES.includes(entry.role)) return { rid: entry.rid, role: entry.role, legacy: false, code };
    // Older rooms: the code IS the room id and there are no roles (everyone edits).
    try {
      const exists = (await store.get(`rooms/${code}/meta`)) || (await store.get(`rooms/${code}/v2/config`)) || (await store.get(`rooms/${code}/state`));
      if (exists) return { rid: code, role: "editor", legacy: true, code };
    } catch (e) { if (!isDenied(e)) throw e; }
    return null;
  }

  /** Resolve a code and register this user as holding it. Throws "Room not found" if it opens nothing. */
  async function join(code) {
    const found = await resolve(code);
    if (!found) throw new Error("Room not found");
    if (!found.legacy) await store.set(`rooms/${found.rid}/access/${found.code}/${uid()}`, true);
    return found;
  }

  /** The codes this user is allowed to see, e.g. { admin, editor, viewer } for admins, { viewer } for viewers. */
  async function getCodes(rid) {
    const out = {};
    for (const role of ROLES) {
      try { const v = await store.get(`rooms/${rid}/secrets/${role}`); if (v) out[role] = v; }
      catch (e) { if (!isDenied(e)) throw e; }
    }
    return out;
  }

  /** Replace a role's code. Everyone who joined with the old code loses access immediately. */
  async function rotate(rid, role, { makeCode = genCode } = {}) {
    const me = uid();
    const old = await store.get(`rooms/${rid}/secrets/${role}`);
    const fresh = makeCode();
    await store.set(`codes/${fresh}`, { rid, role });
    await store.set(`rooms/${rid}/secrets/${role}`, fresh);
    if (role === "admin") await store.set(`rooms/${rid}/access/${fresh}/${me}`, true); // keep the person rotating it as admin
    if (old) {
      await store.remove(`rooms/${rid}/access/${old}`);
      await store.remove(`codes/${old}`);
    }
    return fresh;
  }

  /** Turn the read-only link off (viewers lose access) ... */
  async function disableViewer(rid) {
    const old = await store.get(`rooms/${rid}/secrets/viewer`);
    await store.remove(`rooms/${rid}/secrets/viewer`);
    if (old) {
      await store.remove(`rooms/${rid}/access/${old}`);
      await store.remove(`codes/${old}`);
    }
  }
  /** ... and back on with a new code. */
  async function enableViewer(rid, { makeCode = genCode } = {}) {
    const fresh = makeCode();
    await store.set(`codes/${fresh}`, { rid, role: "viewer" });
    await store.set(`rooms/${rid}/secrets/viewer`, fresh);
    return fresh;
  }

  /**
   * Give an old open room roles. Only its creator can. The old code keeps working as the editor code,
   * so existing collaborators just rejoin with it; new admin and viewer codes are created.
   */
  async function upgradeLegacy(rid, { makeCode = genCode } = {}) {
    const me = uid();
    const codes = { admin: makeCode(), editor: rid.toUpperCase(), viewer: makeCode() };
    await store.set(`rooms/${rid}/secrets`, codes); // the rules only allow this for the room's creator
    await store.set(`rooms/${rid}/access/${codes.admin}/${me}`, true);
    for (const role of ROLES) await store.set(`codes/${codes[role]}`, { rid, role });
    return { rid, codes, role: "admin" };
  }

  /** Archive a term (read-only for everyone, including admins) or reopen it. Admins only: the rules enforce it. */
  async function setArchived(rid, archived) {
    await store.set(`rooms/${rid}/meta/archived`, archived ? true : null);
  }

  return { createRoom, resolve, join, getCodes, rotate, disableViewer, enableViewer, upgradeLegacy, setArchived };
}
