// Super admin: one Google account that can see and manage every term. The database rules check the same email
// (scripts/rules.mjs), so this list only decides what the app shows; it grants nothing by itself.
export const SUPER_EMAILS = ["aditya.gaundalkar@gmail.com"];

export const isSuperUser = user =>
  !!user && !user.isAnonymous && user.emailVerified !== false && SUPER_EMAILS.includes(String(user.email || "").toLowerCase());

// ── Presence: one entry per person ──────────────────────────────────────────
// Every open tab writes its own presence node. A Google account is one person wherever it is open; people who joined
// with only a code get a new anonymous identity per browser, so for them the name is the best guess.
export const personKey = p => (p && p.acct && p.uid ? "u:" + p.uid : "n:" + String(p?.name || "").trim().toLowerCase());

/**
 * Collapse presence to one entry per person, keeping their most recent tab. `self` = { userId, uid, acct, name }:
 * this tab always represents me, and my other tabs never show as somebody else.
 */
export function dedupePresence(entries, self) {
  const selfKey = self ? personKey(self) : null;
  const best = new Map();
  Object.entries(entries || {}).forEach(([id, p]) => {
    if (!p) return;
    const k = personKey(p);
    if (k === selfKey && self && id !== self.userId) return; // my other tab
    const cur = best.get(k);
    if (!cur || (p.at || 0) > (cur[1].at || 0)) best.set(k, [id, p]);
  });
  return Object.fromEntries(best.values());
}

// ── Terms ───────────────────────────────────────────────────────────────────
/** codes/<CODE> = { rid, role }  →  { rid: { admin, editor, viewer } } */
export function codesByTerm(codes) {
  const out = {};
  Object.entries(codes || {}).forEach(([code, v]) => {
    if (!v || !v.rid || !v.role) return;
    (out[v.rid] ||= {})[v.role] = code;
  });
  return out;
}

/** rooms/<rid>/access = { CODE: { uid: true } } and the term's codes → { uid: role } (the highest role held). */
export function membersOf(access, codes) {
  const rank = { admin: 3, editor: 2, viewer: 1 };
  const roleOf = {};
  Object.entries(codes || {}).forEach(([role, code]) => { roleOf[code] = role; });
  const out = {};
  Object.entries(access || {}).forEach(([code, uids]) => {
    const role = roleOf[code];
    if (!role || !uids) return; // an old code that was replaced: no access any more
    Object.keys(uids).forEach(uid => { if (!out[uid] || rank[role] > rank[out[uid]]) out[uid] = role; });
  });
  return out;
}

/** Activity from a term's ops: last change, and who changed things most (by account when known, else by name). */
export function opsStats(ops) {
  const list = Object.values(ops || {}).filter(o => o && o.at);
  const by = new Map();
  list.forEach(o => {
    const k = o.uid ? "u:" + o.uid : "n:" + String(o.userName || "Someone").trim().toLowerCase();
    const e = by.get(k) || { key: k, uid: o.uid || null, name: o.userName || "Someone", count: 0, last: 0 };
    e.count++; if (o.at >= e.last) { e.last = o.at; e.name = o.userName || e.name; }
    by.set(k, e);
  });
  return {
    count: list.length,
    lastAt: list.reduce((m, o) => Math.max(m, o.at), 0) || null,
    editors: [...by.values()].sort((a, b) => b.count - a.count || b.last - a.last),
  };
}

/**
 * Everyone known, one row per account: from login records, term memberships and activity.
 *   logins  { uid: { name, email, provider, first, last, terms: { rid: { role, name, last } } } }
 *   terms   [{ rid, name, members: { uid: role }, ops: opsStats }]
 */
export function buildPeople(logins, terms) {
  const people = new Map();
  const get = uid => {
    if (!people.has(uid)) people.set(uid, { uid, name: "", email: "", provider: "", first: null, last: null, terms: {}, changes: 0 });
    return people.get(uid);
  };
  Object.entries(logins || {}).forEach(([uid, l]) => {
    if (!l) return;
    const p = get(uid);
    Object.assign(p, { name: l.name || "", email: l.email || "", provider: l.provider || "", first: l.first || null, last: l.last || null });
    Object.entries(l.terms || {}).forEach(([rid, t]) => { p.terms[rid] = { role: t?.role || "", name: t?.name || "", last: t?.last || null, changes: 0, member: false }; });
  });
  (terms || []).forEach(t => {
    Object.entries(t.members || {}).forEach(([uid, role]) => {
      const p = get(uid);
      p.terms[t.rid] = { ...(p.terms[t.rid] || { last: null, changes: 0 }), role, name: t.name || p.terms[t.rid]?.name || "", member: true };
    });
    (t.ops?.editors || []).forEach(e => {
      if (!e.uid) return; // older changes carry only a name; they are counted on the term, not the person
      const p = get(e.uid);
      const pt = p.terms[t.rid] || (p.terms[t.rid] = { role: "", name: t.name || "", last: null, changes: 0, member: false });
      pt.changes += e.count; p.changes += e.count;
      if (!p.name) p.name = e.name;
    });
  });
  return [...people.values()].sort((a, b) => (b.last || 0) - (a.last || 0) || a.name.localeCompare(b.name));
}

/** Who is online in which term, one row per person: [{ key, name, color, terms: [{ rid, name, tab, at }], at }] */
export function onlineAcross(presenceByTerm, termNames) {
  const out = new Map();
  Object.entries(presenceByTerm || {}).forEach(([rid, entries]) => {
    Object.values(dedupePresence(entries, null)).forEach(p => {
      const k = personKey(p);
      const e = out.get(k) || { key: k, uid: p.uid || null, name: p.name || "Someone", color: p.color, terms: [], at: 0 };
      e.terms.push({ rid, name: termNames?.[rid] || rid, tab: p.tab || "", role: p.role || "", at: p.at || 0 });
      e.at = Math.max(e.at, p.at || 0);
      out.set(k, e);
    });
  });
  return [...out.values()].sort((a, b) => b.at - a.at);
}

export const fresh = (entries, now, staleMs = 60000) =>
  Object.fromEntries(Object.entries(entries || {}).filter(([, p]) => p && now - (p.at || 0) < staleMs));
