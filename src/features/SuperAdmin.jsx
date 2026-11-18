// The super admin's own page: every term and every person, who is online right now, and the tools to manage terms.
// What it may read and change is enforced by the database rules (scripts/rules.mjs); this page only presents it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { superApi, access } from "../firebase.js";
import { codesByTerm, membersOf, opsStats, buildPeople, onlineAcross, fresh, dedupePresence } from "../superAdmin.js";
import { treeToState } from "../sync.js";
import { getAllConflicts } from "../conflicts.js";
import { ROLE_LABEL } from "../access.js";
import { VIEWS } from "../shell/Shell.jsx";
import { Btn, Segmented, Avatar, EmptyState } from "../ui/kit.jsx";
import { askConfirm } from "../ui/Confirm.jsx";

const STALE_MS = 60000;
const date = t => (t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const when = t => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
function ago(t, now = Date.now()) {
  if (!t) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return date(t);
}
const tabLabel = id => VIEWS.find(v => v.id === id)?.label || "";
const roleCounts = members => Object.values(members || {}).reduce((m, r) => ({ ...m, [r]: (m[r] || 0) + 1 }), {});
const card = { background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r2)", padding: "12px 14px" };
const muted = { color: "var(--muted)", fontSize: 13.5 };

async function loadAll() {
  const [codes, logins] = await Promise.all([superApi.allCodes(), superApi.logins()]);
  const byRid = codesByTerm(codes);
  const rids = new Set(Object.keys(byRid));
  Object.values(logins || {}).forEach(l => Object.keys(l?.terms || {}).forEach(rid => rids.add(rid))); // older terms without codes
  const terms = (await Promise.all([...rids].map(async rid => {
    const [meta, acc, ops] = await Promise.all([
      superApi.meta(rid).catch(() => null), superApi.access(rid).catch(() => null), superApi.ops(rid).catch(() => ({})),
    ]);
    if (!meta && !byRid[rid]) return null; // deleted, or never really created
    const termCodes = byRid[rid] || null;
    return {
      rid, codes: termCodes, legacy: !termCodes, name: meta?.name || "Untitled term", archived: meta?.archived === true,
      createdAt: meta?.createdAt || null, ownerId: meta?.ownerId || null,
      members: termCodes ? membersOf(acc, termCodes) : {}, ops: opsStats(ops),
    };
  }))).filter(Boolean).sort((a, b) => (a.archived - b.archived) || (b.ops.lastAt || b.createdAt || 0) - (a.ops.lastAt || a.createdAt || 0));
  return { terms, logins: logins || {} };
}

export default function SuperAdmin({ onBack, onOpenTerm, toast }) {
  const [view, setView] = useState("terms");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [presence, setPresence] = useState({});
  const [now, setNow] = useState(Date.now());

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await loadAll()); }
    catch (e) {
      setError(e?.code === "PERMISSION_DENIED" || /permission/i.test(e?.message || "")
        ? "The database refused. Publish the latest database.rules.json in Firebase (Realtime Database → Rules), then reload."
        : "Couldn't load: " + (e?.message || "network error"));
    }
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  const rids = useMemo(() => (data?.terms || []).map(t => t.rid).join(","), [data]);
  useEffect(() => {
    if (!rids) return;
    const offs = rids.split(",").map(rid => superApi.watchPresence(rid, v => setPresence(p => ({ ...p, [rid]: v }))));
    return () => offs.forEach(off => { try { off(); } catch { /* ignore */ } });
  }, [rids]);

  const termNames = useMemo(() => Object.fromEntries((data?.terms || []).map(t => [t.rid, t.name])), [data]);
  const livePresence = useMemo(() => Object.fromEntries(Object.entries(presence).map(([rid, e]) => [rid, fresh(e, now, STALE_MS)])), [presence, now]);
  const online = useMemo(() => onlineAcross(livePresence, termNames), [livePresence, termNames]);
  const people = useMemo(() => (data ? buildPeople(data.logins, data.terms) : []), [data]);
  const nameOf = useCallback(uid => people.find(p => p.uid === uid)?.name || "", [people]);

  const counts = { terms: data?.terms.length || 0, people: people.length, online: online.length };
  return (
    <main style={{ position: "fixed", inset: 0, overflowY: "auto", background: "var(--bg)" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "clamp(20px, 4vw, 40px) 16px 48px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <Btn variant="outline" onClick={onBack}>Back</Btn>
          <span style={{ flex: 1 }} />
          <Btn variant="outline" onClick={reload} disabled={loading}>{loading ? "Loading…" : "Reload"}</Btn>
        </div>
        <h1 style={{ font: "400 clamp(28px, 5vw, 40px)/1.05 var(--serif)", marginBottom: 6 }}>Super admin</h1>
        <p style={{ ...muted, fontSize: 14.5, marginBottom: 18, lineHeight: 1.5 }}>
          Every term and everyone who has used Kronos. Only your account can see this page.
        </p>
        <Segmented label="Section" value={view} onChange={setView} options={[
          { value: "terms", label: `Terms (${counts.terms})` },
          { value: "people", label: `People (${counts.people})` },
          { value: "online", label: `Online now (${counts.online})` },
        ]} />
        <div style={{ marginTop: 16 }}>
          {error && <div className="callout bad" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
          {!data && loading && <div style={muted}>Loading every term…</div>}
          {data && view === "terms" && <TermsList terms={data.terms} presence={livePresence} nameOf={nameOf} onOpenTerm={onOpenTerm} reload={reload} toast={toast} />}
          {data && view === "people" && <PeopleList people={people} terms={data.terms} termNames={termNames} online={online} reload={reload} toast={toast} />}
          {data && view === "online" && <OnlineList online={online} now={now} />}
        </div>
      </div>
    </main>
  );
}

// ─────────────────────────────── Terms ───────────────────────────────
function TermsList({ terms, presence, nameOf, onOpenTerm, reload, toast }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const shown = terms.filter(t => !q || t.name.toLowerCase().includes(q.toLowerCase()));
  if (!terms.length) return <EmptyState title="No terms yet">Terms appear here once someone creates one.</EmptyState>;
  return (
    <>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search terms" aria-label="Search terms" style={{ width: "100%", maxWidth: 360, marginBottom: 12 }} />
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map(t => {
          const rc = roleCounts(t.members);
          const live = Object.keys(dedupePresence(presence[t.rid] || {}, null)).length; // people, not tabs
          return (
            <li key={t.rid} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                    {t.archived && <span className="pill warn">Archived</span>}
                    {t.legacy && <span className="pill">Older term, no roles</span>}
                    {live > 0 && <span className="pill ok"><span className="dot pulse" />{live} online</span>}
                    <span style={muted}>
                      {["admin", "editor", "viewer"].filter(r => rc[r]).map(r => `${rc[r]} ${ROLE_LABEL[r].toLowerCase()}${rc[r] === 1 ? "" : "s"}`).join(", ") || "No members recorded"}
                      {" · "}Last change {ago(t.ops.lastAt)}{t.createdAt ? ` · Created ${date(t.createdAt)}` : ""}
                    </span>
                  </div>
                </div>
                <Btn variant="primary" onClick={() => onOpenTerm({ code: t.codes?.admin || t.rid, name: t.name })}>Open as admin</Btn>
                <Btn variant="outline" onClick={() => setOpen(open === t.rid ? null : t.rid)} title="Codes, activity, members and actions">
                  {open === t.rid ? "Hide details" : "Details"}
                </Btn>
              </div>
              {open === t.rid && <TermDetails term={t} nameOf={nameOf} reload={reload} toast={toast} />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function TermDetails({ term, nameOf, reload, toast }) {
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState("");
  async function countSessions() {
    setBusy("count");
    try {
      const r = await superApi.room(term.rid);
      const st = r?.tree ? treeToState(r.tree) : r?.legacy || {};
      const appts = st.appointments || {};
      setStats({ sessions: Object.keys(appts).length, courses: (st.courses || []).length, conflicts: getAllConflicts(appts, st.slots || []).filter(c => !c.overridden).length });
    } catch { toast("Couldn't read that term", "warn"); }
    setBusy("");
  }
  async function resetCode(role) {
    if (!await askConfirm({ title: `Make a new ${ROLE_LABEL[role].toLowerCase()} code?`, message: `Everyone who joined ${term.name} with the current ${ROLE_LABEL[role].toLowerCase()} code loses access until they get the new one.`, confirmLabel: "Make new code" })) return;
    setBusy(role);
    try { await access.rotate(term.rid, role, { keepMe: false }); toast(`New ${ROLE_LABEL[role].toLowerCase()} code made`, "success"); await reload(); }
    catch { toast("Couldn't change the code", "warn"); }
    setBusy("");
  }
  async function setArchived(v) {
    if (v && !await askConfirm({ title: `Archive ${term.name}?`, message: "It becomes read-only for everyone, including its admins. You can restore it at any time.", confirmLabel: "Archive", danger: false })) return;
    setBusy("archive");
    try { await access.setArchived(term.rid, v); toast(v ? "Term archived" : "Term restored", "success"); await reload(); }
    catch { toast("Couldn't change the term", "warn"); }
    setBusy("");
  }
  async function remove(uid) {
    const who = nameOf(uid) || "This person";
    if (!await askConfirm({ title: `Remove ${who} from ${term.name}?`, message: "They lose access straight away. If they still have the code they can join again, so make a new code too if that matters.", confirmLabel: "Remove" })) return;
    try { await superApi.removeMember(term.rid, uid, term.codes); toast(`${who} removed`, "success"); await reload(); }
    catch { toast("Couldn't remove them", "warn"); }
  }
  async function del() {
    if (!await askConfirm({
      title: `Delete ${term.name}?`,
      message: "The timetable, comments, saved versions and all codes are deleted for everyone. This can't be undone.",
      detail: "Export a copy first if you might need it: open the term, then Settings → Export JSON.",
      typeToConfirm: term.name, confirmLabel: "Delete term",
    })) return;
    setBusy("delete");
    try { await superApi.deleteTerm(term.rid, term.codes, Object.keys(term.members)); toast(`${term.name} deleted`, "success"); await reload(); }
    catch { toast("Couldn't delete the term", "warn"); setBusy(""); }
  }
  const copy = c => { try { navigator.clipboard.writeText(c); toast("Code copied", "success"); } catch { /* ignore */ } };
  const members = Object.entries(term.members).sort((a, b) => a[1].localeCompare(b[1]));
  const sub = { fontWeight: 700, fontSize: 14, margin: "14px 0 6px" };
  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 4 }}>
      {term.codes && (
        <>
          <div style={sub}>Codes</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
            {["admin", "editor", "viewer"].map(role => (
              <div key={role} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "6px 8px" }}>
                <span style={{ width: 52, ...muted }}>{ROLE_LABEL[role]}</span>
                <code style={{ flex: 1, font: "600 13px var(--mono)" }}>{term.codes[role] || "off"}</code>
                {term.codes[role] && <Btn variant="ghost" onClick={() => copy(term.codes[role])} title="Copy">Copy</Btn>}
                <Btn variant="ghost" onClick={() => resetCode(role)} disabled={!!busy} title="Replace this code">{busy === role ? "…" : "Reset"}</Btn>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={sub}>Activity</div>
      <div style={{ ...muted, lineHeight: 1.6 }}>
        {term.ops.count ? `${term.ops.count}${term.ops.count >= 500 ? "+" : ""} recorded change${term.ops.count === 1 ? "" : "s"}, the last on ${when(term.ops.lastAt)}.` : "No changes recorded."}
        {" "}{stats ? `${stats.sessions} sessions, ${stats.courses} courses, ${stats.conflicts} open conflict${stats.conflicts === 1 ? "" : "s"}.`
          : <button type="button" onClick={countSessions} disabled={busy === "count"} style={{ color: "var(--accent)", textDecoration: "underline", font: "inherit" }}>{busy === "count" ? "Counting…" : "Count sessions and conflicts"}</button>}
      </div>
      {term.ops.editors.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {term.ops.editors.slice(0, 8).map(e => <span key={e.key} className="pill">{e.name} · {e.count}</span>)}
        </div>
      )}

      <div style={sub}>Members</div>
      {term.legacy ? <div style={muted}>Older terms have no roles: anyone with the code can edit. Open it as admin to give it roles.</div>
        : members.length === 0 ? <div style={muted}>Nobody has joined yet.</div>
        : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {members.map(([uid, role]) => (
              <li key={uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>{nameOf(uid) || <span style={muted}>Joined before sign-ins were tracked ({uid.slice(0, 6)})</span>}</span>
                <span className="badge">{ROLE_LABEL[role]}</span>
                <Btn variant="ghost" onClick={() => remove(uid)}>Remove</Btn>
              </li>
            ))}
          </ul>
        )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        {term.archived
          ? <Btn variant="outline" onClick={() => setArchived(false)} disabled={!!busy}>Restore term</Btn>
          : <Btn variant="outline" onClick={() => setArchived(true)} disabled={!!busy}>Archive term</Btn>}
        <Btn variant="danger" onClick={del} disabled={!!busy}>{busy === "delete" ? "Deleting…" : "Delete term"}</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────── People ───────────────────────────────
function PeopleList({ people, terms, termNames, online, reload, toast }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const onlineKeys = new Set(online.map(o => o.uid).filter(Boolean));
  const ql = q.toLowerCase();
  const shown = people.filter(p => !q || p.name.toLowerCase().includes(ql) || p.email.toLowerCase().includes(ql));
  async function remove(p, rid) {
    const t = terms.find(x => x.rid === rid);
    if (!t?.codes) return;
    if (!await askConfirm({ title: `Remove ${p.name || "this person"} from ${t.name}?`, message: "They lose access straight away. If they still have the code they can join again, so make a new code too if that matters.", confirmLabel: "Remove" })) return;
    try { await superApi.removeMember(rid, p.uid, t.codes); toast("Removed", "success"); await reload(); }
    catch { toast("Couldn't remove them", "warn"); }
  }
  if (!people.length) return <EmptyState title="Nobody yet">People appear here after they open a term with this version of Kronos.</EmptyState>;
  return (
    <>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search people" style={{ width: "100%", maxWidth: 360, marginBottom: 8 }} />
      <p style={{ ...muted, marginBottom: 12 }}>People who joined with only a code get a new identity in each browser, so they can be listed more than once.</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.map(p => {
          const tlist = Object.entries(p.terms).filter(([rid]) => termNames[rid]);
          return (
            <li key={p.uid} style={card}>
              <button type="button" onClick={() => setOpen(open === p.uid ? null : p.uid)} aria-expanded={open === p.uid}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", font: "inherit", color: "inherit", flexWrap: "wrap" }}>
                <Avatar name={p.name || "?"} size={30} />
                <span style={{ flex: 1, minWidth: 180 }}>
                  <span style={{ fontWeight: 700 }}>{p.name || "Unknown name"}</span>
                  {onlineKeys.has(p.uid) && <span className="pill ok" style={{ marginLeft: 8 }}><span className="dot pulse" />Online</span>}
                  <span style={{ display: "block", ...muted }}>{p.email || (p.provider === "code" ? "Joined with a code" : p.provider === "google" ? "Google account" : "Joined before sign-ins were tracked")}</span>
                </span>
                <span style={{ ...muted, textAlign: "right" }}>
                  Last seen {ago(p.last)}<br />{tlist.length} term{tlist.length === 1 ? "" : "s"} · {p.changes} change{p.changes === 1 ? "" : "s"}
                </span>
              </button>
              {open === p.uid && (
                <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 8 }}>
                  <div style={{ ...muted, marginBottom: 8 }}>First seen {when(p.first)} · Last seen {when(p.last)}</div>
                  {tlist.length === 0 ? <div style={muted}>Not in any term now.</div> : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {tlist.map(([rid, t]) => (
                        <li key={rid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                          <span style={{ flex: 1, minWidth: 160, fontWeight: 600 }}>{termNames[rid]}</span>
                          {t.role && <span className="badge">{ROLE_LABEL[t.role] || t.role}</span>}
                          <span style={muted}>{t.last ? `opened ${ago(t.last)}` : ""}{t.changes ? ` · ${t.changes} changes` : ""}</span>
                          {t.member && <Btn variant="ghost" onClick={() => remove(p, rid)}>Remove</Btn>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ─────────────────────────────── Online ───────────────────────────────
function OnlineList({ online, now }) {
  if (!online.length) return <EmptyState title="Nobody is online">People show here while they have a term open.</EmptyState>;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {online.map(o => (
        <li key={o.key} style={{ ...card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Avatar name={o.name} color={o.color} size={30} />
          <span style={{ fontWeight: 700, minWidth: 140 }}>{o.name}</span>
          <span style={{ flex: 1, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {o.terms.map(t => <span key={t.rid} className="pill">{t.name}{t.tab ? ` · ${tabLabel(t.tab)}` : ""}{t.role === "viewer" ? " · viewing" : ""}</span>)}
          </span>
          <span style={muted}>active {ago(o.at, now)}</span>
        </li>
      ))}
    </ul>
  );
}
