// Source of truth for database.rules.json. Edit here, then run:  node scripts/rules.mjs
// (a test fails if the committed JSON does not match this file).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const S = k => `root.child('rooms/'+$rid+'/secrets/${k}')`;
const has = k => `${S(k)}.exists() && root.child('rooms/'+$rid+'/access/'+${S(k)}.val()+'/'+auth.uid).exists()`;

const validRid = `$rid.matches(/^[A-Za-z0-9]{6,24}$/)`;
const legacyOpen = `!root.child('rooms/'+$rid+'/secrets').exists()`;   // old rooms: no roles, everyone with the code edits
const isAdmin = `(${has("admin")})`;
const isEditor = `(${has("editor")})`;
const isViewer = `(${has("viewer")})`;
const canEdit = `(${legacyOpen} || ${isAdmin} || ${isEditor})`;
const isMember = `(${legacyOpen} || ${isAdmin} || ${isEditor} || ${isViewer})`;
const authed = `auth != null && ${validRid}`;

const read = cond => `${authed} && ${cond}`;
const adminOfRid = r => `root.child('rooms/'+${r}+'/secrets/admin').exists() && root.child('rooms/'+${r}+'/access/'+root.child('rooms/'+${r}+'/secrets/admin').val()+'/'+auth.uid).exists()`;

export function buildRules() {
  return {
    rules: {
      ".read": false,
      ".write": false,

      users: {
        $uid: {
          ".read": "auth != null && auth.uid === $uid && auth.token.firebase.sign_in_provider !== 'anonymous'",
          ".write": "auth != null && auth.uid === $uid && auth.token.firebase.sign_in_provider !== 'anonymous'",
        },
      },

      // code -> room lookup. Anyone signed in can look up a code they were given (there is no way to list codes);
      // only that room's admin can create or remove them.
      codes: {
        $code: {
          ".read": "auth != null && $code.matches(/^[A-Z0-9]{6,12}$/)",
          ".write": `auth != null && $code.matches(/^[A-Z0-9]{6,12}$/) && ((!data.exists() && newData.child('rid').isString() && (${adminOfRid("newData.child('rid').val()")})) || (data.exists() && (${adminOfRid("data.child('rid').val()")})))`,
          ".validate": "newData.hasChildren(['rid','role']) && newData.child('rid').isString() && (newData.child('role').val() === 'admin' || newData.child('role').val() === 'editor' || newData.child('role').val() === 'viewer')",
        },
      },

      rooms: {
        $rid: {
          // Room details and timetable data.
          meta: {
            ".read": read(isMember),
            ".write": read(`(${legacyOpen} || ${isAdmin})`),
          },
          v2: {
            ".read": read(isMember),
            ".write": read(canEdit),
          },
          state: {
            ".read": read(isMember),
            ".write": read(canEdit),
          },
          ops: {
            ".read": read(isMember),
            ".write": read(canEdit),
          },
          presence: {
            ".read": read(isMember),
            ".write": read(isMember),
          },

          // Comments: any member may add their own; authors (and editors / admins) may change or delete.
          comments: {
            ".read": read(isMember),
            $cid: {
              ".write": read(`${isMember} && (!data.exists() ? newData.child('uid').val() === auth.uid : (data.child('uid').val() === auth.uid || ${canEdit}))`),
              ".validate": "newData.hasChildren(['apptId','uid','name','text','at']) && newData.child('text').isString() && newData.child('text').val().length > 0 && newData.child('text').val().length <= 2000 && (!data.exists() || newData.child('uid').val() === data.child('uid').val())",
            },
          },

          // The codes themselves. Each role can read only its own code and those below it.
          secrets: {
            ".write": read(`((!data.exists() && (!root.child('rooms/'+$rid+'/meta').exists() || root.child('rooms/'+$rid+'/meta/ownerId').val() === auth.uid)) || ${isAdmin})`),
            admin: { ".read": read(isAdmin) },
            editor: { ".read": read(`(${isAdmin} || ${isEditor})`) },
            viewer: { ".read": read(`(${isAdmin} || ${isEditor} || ${isViewer})`) },
          },

          // "This person joined with this code". People may only add themselves, and only with a real code.
          access: {
            $code: {
              ".write": read(isAdmin),
              $uid: {
                ".read": "auth != null && auth.uid === $uid",
                ".write": read(`$uid === auth.uid && ((newData.val() === true && $code.matches(/^[A-Z0-9]{6,12}$/) && (${S("admin")}.val() === $code || ${S("editor")}.val() === $code || ${S("viewer")}.val() === $code)) || !newData.exists())`),
              },
            },
          },
        },
      },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL("../database.rules.json", import.meta.url), JSON.stringify(buildRules(), null, 2) + "\n");
  console.log("wrote database.rules.json");
}
