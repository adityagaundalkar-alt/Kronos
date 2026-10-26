// A small in-memory Realtime Database that enforces a rules JSON the way Firebase does
// (approximately - this is NOT Firebase's own engine, which could not be downloaded here):
//   - .read / .write cascade downward: if any rule on the way to a path grants access, it is granted
//   - $wildcards bind to the matching path segment; rule expressions see root, data, newData, auth, now
//   - .validate is checked at every rule location on the path and inside the written value
//   - multi-path update() checks each path separately against the pre-write database
//   - a rule that throws counts as false; paths with no rule are denied
// Used to test access.js against the real database.rules.json.

if (!String.prototype.matches) {
  Object.defineProperty(String.prototype, "matches", { value(re) { return re.test(String(this)); }, enumerable: false });
}

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const segs = p => String(p).split("/").filter(Boolean);

function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "object") {
    const o = {};
    Object.entries(v).forEach(([k, x]) => { const n = prune(x); if (n !== undefined) o[k] = n; });
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}
const getAt = (tree, path) => { let n = tree; for (const s of segs(path)) { if (n == null || typeof n !== "object") return undefined; n = n[s]; } return n; };
function setAt(tree, path, value) {
  const parts = segs(path);
  const root = clone(tree) || {};
  if (!parts.length) return prune(value) || {};
  let n = root;
  parts.slice(0, -1).forEach(s => { if (typeof n[s] !== "object" || n[s] === null) n[s] = {}; n = n[s]; });
  const last = parts[parts.length - 1];
  if (value === undefined || value === null) delete n[last]; else n[last] = clone(value);
  return prune(root) || {};
}

class Snap {
  constructor(tree, path) { this.tree = tree; this.path = segs(path); }
  _v() { return getAt(this.tree, this.path.join("/")); }
  val() { const v = this._v(); return v === undefined ? null : clone(v); }
  exists() { return this._v() !== undefined; }
  child(p) { return new Snap(this.tree, [...this.path, ...segs(p)].join("/")); }
  parent() { return new Snap(this.tree, this.path.slice(0, -1).join("/")); }
  isString() { return typeof this._v() === "string"; }
  isNumber() { return typeof this._v() === "number"; }
  isBoolean() { return typeof this._v() === "boolean"; }
  hasChild(k) { const v = this._v(); return v && typeof v === "object" && k in v; }
  hasChildren(list) { const v = this._v(); if (!v || typeof v !== "object") return false; return list ? list.every(k => k in v) : Object.keys(v).length > 0; }
}

const compiled = new Map();
function evalRule(expr, vars, ctx) {
  if (typeof expr === "boolean") return expr;
  const names = Object.keys(vars);
  const key = names.join(",") + "|" + expr;
  let fn = compiled.get(key);
  if (!fn) { fn = new Function(...names, "root", "data", "newData", "auth", "now", `return (${expr});`); compiled.set(key, fn); }
  try { return fn(...names.map(n => vars[n]), ctx.root, ctx.data, ctx.newData, ctx.auth, ctx.now) === true; }
  catch { return false; }
}

export function createRulesDb(rulesJson, initial = {}) {
  const rules = rulesJson.rules;
  const db = { tree: prune(clone(initial)) || {}, log: [] };
  const denied = path => Object.assign(new Error(`PERMISSION_DENIED: ${path}`), { code: "PERMISSION_DENIED" });

  // Walk the rules along `path`, returning the rule nodes (with bound $vars and their paths) from root to path.
  function chain(path) {
    const out = []; let node = rules, vars = {}; const cur = [];
    out.push({ node, vars: { ...vars }, path: [] });
    for (const s of segs(path)) {
      let next = node[s];
      if (next === undefined || typeof next !== "object") {
        const wild = Object.keys(node).find(k => k.startsWith("$"));
        if (!wild) return out;
        vars = { ...vars, [wild]: s }; next = node[wild];
      }
      cur.push(s); node = next; out.push({ node, vars: { ...vars }, path: [...cur] });
    }
    return out;
  }

  function canRead(path, auth) {
    return chain(path).some(({ node, vars, path: p }) => {
      if (node[".read"] === undefined) return false;
      const snap = new Snap(db.tree, p.join("/"));
      return evalRule(node[".read"], vars, { root: new Snap(db.tree, ""), data: snap, newData: snap, auth, now: Date.now() });
    });
  }

  function validate(newTree, writePath, auth) {
    const wp = segs(writePath);
    const root = new Snap(db.tree, ""), newRoot = new Snap(newTree, "");
    const check = (node, vars, p) => {
      const nv = getAt(newTree, p.join("/"));
      if (nv !== undefined && node[".validate"] !== undefined) {
        const ok = evalRule(node[".validate"], vars, { root, data: new Snap(db.tree, p.join("/")), newData: new Snap(newTree, p.join("/")), auth, now: Date.now() });
        if (!ok) return false;
      }
      const onPath = p.length < wp.length && p.every((s, i) => s === wp[i]);
      const inside = p.length >= wp.length && wp.every((s, i) => s === p[i]);
      if (!onPath && !inside) return true;
      for (const key of Object.keys(node).filter(k => !k.startsWith("."))) {
        if (key.startsWith("$")) {
          const parentVal = getAt(newTree, p.join("/"));
          const keys = onPath ? [wp[p.length]] : Object.keys(parentVal && typeof parentVal === "object" ? parentVal : {});
          for (const k of keys) if (!check(node[key], { ...vars, [key]: k }, [...p, k])) return false;
        } else {
          if (onPath && wp[p.length] !== key) continue;
          if (!check(node[key], vars, [...p, key])) return false;
        }
      }
      return true;
    };
    return check(rules, {}, []);
  }

  function checkWrite(path, value, auth) {
    const newTree = setAt(db.tree, path, value);
    const allowed = chain(path).some(({ node, vars, path: p }) => {
      if (node[".write"] === undefined) return false;
      return evalRule(node[".write"], vars, {
        root: new Snap(db.tree, ""), data: new Snap(db.tree, p.join("/")), newData: new Snap(newTree, p.join("/")), auth, now: Date.now(),
      });
    });
    if (!allowed || !validate(newTree, path, auth)) throw denied(path);
    return newTree;
  }

  db.as = (uid, provider = "anonymous") => {
    const auth = uid ? { uid, token: { firebase: { sign_in_provider: provider } } } : null;
    return {
      uid,
      async get(path) { if (!canRead(path, auth)) throw denied(path); const v = getAt(db.tree, path); return v === undefined ? null : clone(v); },
      async set(path, value) { db.tree = checkWrite(path, value, auth); },
      async remove(path) { db.tree = checkWrite(path, null, auth); },
      async update(path, obj) {
        // each path is checked against the database as it was before the update; all must pass
        const writes = Object.entries(obj).map(([k, v]) => [`${segs(path).join("/")}/${segs(k).join("/")}`, v]);
        writes.forEach(([p, v]) => checkWrite(p, v, auth));
        writes.forEach(([p, v]) => { db.tree = setAt(db.tree, p, v); });
      },
    };
  };
  return db;
}
