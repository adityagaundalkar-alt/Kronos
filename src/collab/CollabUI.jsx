import { useState, useEffect, useRef } from "react";
import { auth, ensureAuth, access, subscribeOps } from "../firebase.js";
import { ROLE_LABEL, ROLE_BLURB, normalizeCode, isValidCode, joinLink } from "../access.js";
import { loadRecentRooms, forgetRoom } from "../state.js";
import { Modal, Field, Btn, Badge, Avatar } from "../ui/kit.jsx";
import Icon from "../ui/Icon.jsx";

const roleClass = { admin: "ok", editor: "info", viewer: "warn" };
export const RolePill = ({ role }) => role ? <span className={`pill ${roleClass[role] || ""}`}>{role === "viewer" ? "View only" : ROLE_LABEL[role]}</span> : null;

const copy = async (text, toast, done = "Copied") => {
  try { await navigator.clipboard.writeText(text); toast(done, "ok", 2200); }
  catch { toast("Couldn't copy automatically. Select the text and copy it.", "warn"); }
};

// ═══════════════════════════ Create / join ═══════════════════════════
export function CollabModal({ onCreate, onJoin, onClose, defaultName, initialCode = "" }) {
  const [mode, setMode] = useState(initialCode ? "join" : "pick");
  const [roomName, setRoomName] = useState("");
  const [joinCode, setJoinCode] = useState(initialCode);
  const [userName, setUserName] = useState(auth.currentUser?.displayName || defaultName || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [known, setKnown] = useState(loadRecentRooms);

  async function submitCreate() {
    if (!userName.trim()) return setError("Enter your name so collaborators know who you are.");
    if (!roomName.trim()) return setError("Give the room a name, for example \"CS Department, Semester 1\".");
    setLoading(true); setError("");
    try { await onCreate(roomName.trim(), userName.trim()); }
    catch (e) {
      setError(e?.code === "PERMISSION_DENIED" || /permission/i.test(e?.message || "")
        ? "The database refused to create the room. Publish the latest database.rules.json in Firebase (Realtime Database, Rules) and try again."
        : "Couldn't create the room: " + (e?.message || "network error"));
    }
    setLoading(false);
  }
  async function submitJoin(codeIn = joinCode) {
    if (!userName.trim()) return setError("Enter your name so collaborators know who you are.");
    const code = normalizeCode(codeIn);
    if (!isValidCode(code)) return setError("Room codes are 6 to 12 letters and numbers.");
    setLoading(true); setError("");
    try { await ensureAuth(); await onJoin(code, userName.trim()); }
    catch (e) {
      setError(e?.message === "Room not found" ? "No room uses that code. Check it and try again. If it used to work, an admin may have changed it."
        : /permission/i.test(e?.message || "") || e?.code === "PERMISSION_DENIED" ? "That code didn't give access. Ask the room's admin for a current one."
        : "Couldn't join the room: " + (e?.message || "network error"));
    }
    setLoading(false);
  }

  return (
    <Modal title={mode === "create" ? "New shared room" : mode === "join" ? "Join a room" : "Work together"}
      subtitle={mode === "pick" ? "Everyone sees changes as they happen. No account needed to join." : undefined} onClose={onClose} width={460}>
      <div style={{ padding: 20 }}>
        <Field label="Your name" required>
          <input value={userName} onChange={e => setUserName(e.target.value)} placeholder="e.g. Dr. Alice Chen" autoComplete="name" data-autofocus={!initialCode ? true : undefined} />
        </Field>

        {mode === "pick" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" onClick={() => setMode("create")} className="callout ok" style={{ textAlign: "left", padding: "14px 16px", cursor: "pointer" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>Start a new room</div>
              <div style={{ color: "var(--muted)", marginTop: 2 }}>You become the admin and choose who can edit and who can only view.</div>
            </button>
            <button type="button" onClick={() => setMode("join")} className="callout info" style={{ textAlign: "left", padding: "14px 16px", cursor: "pointer" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent2)" }}>Join with a code</div>
              <div style={{ color: "var(--muted)", marginTop: 2 }}>Your role depends on the code you were given.</div>
            </button>
            {known.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Recent rooms on this device</div>
                {known.map(r => (
                  <div key={r.code} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <button type="button" onClick={() => { setJoinCode(r.code); submitJoin(r.code); }} disabled={loading}
                      style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: "var(--r)", border: "1px solid var(--border2)", background: "var(--bg3)", textAlign: "left", minWidth: 0 }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{r.name || "Room"}</span>
                      {r.role && <Badge color={r.role === "admin" ? "green" : r.role === "viewer" ? "yellow" : "blue"}>{r.role}</Badge>}
                    </button>
                    <Btn icon variant="ghost" label={`Forget ${r.name || "room"}`} onClick={() => { forgetRoom(r.code); setKnown(loadRecentRooms()); }}><Icon name="close" size={15} /></Btn>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === "create" && (
          <>
            <Field label="Room name" required hint="Collaborators see this when they join.">
              <input value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="e.g. CS Department, Semester 1" onKeyDown={e => e.key === "Enter" && submitCreate()} data-autofocus />
            </Field>
            <div className="callout" style={{ marginBottom: 14 }}>
              Your current timetable becomes the room's timetable. You'll get three codes: <b>admin</b> (yours), <b>editor</b> and <b>read-only</b>.
            </div>
          </>
        )}

        {mode === "join" && (
          <Field label="Room code" required>
            <input value={joinCode} onChange={e => setJoinCode(normalizeCode(e.target.value))} placeholder="XXXXXXXX" maxLength={12} inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false}
              style={{ fontFamily: "var(--mono)", fontSize: 20, letterSpacing: ".25em", textAlign: "center" }}
              onKeyDown={e => e.key === "Enter" && submitJoin()} data-autofocus={initialCode ? true : undefined} />
          </Field>
        )}

        {error && <div className="callout bad" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
        {mode !== "pick" && (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="outline" size="md" onClick={() => { setMode("pick"); setError(""); }}>Back</Btn>
            <Btn variant="primary" size="md" onClick={mode === "create" ? submitCreate : () => submitJoin()} disabled={loading} style={{ flex: 1 }}>
              {mode === "create" ? (loading ? "Creating…" : "Create room") : (loading ? "Joining…" : "Join room")}
            </Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════ Share & access ═══════════════════════════
export function ShareModal({ session, onClose, toast, onUpgrade, onAdminCodeChanged }) {
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(""); // role being changed
  const [error, setError] = useState("");
  const isAdmin = session.role === "admin";

  const load = async () => {
    try { setCodes(await access.getCodes(session.rid)); setError(""); }
    catch { setError("Couldn't load the room's codes. Check your connection."); setCodes({}); }
  };
  useEffect(() => { if (!session.legacy) load(); else setCodes({}); }, [session.rid, session.legacy]);

  const rows = ["admin", "editor", "viewer"].filter(r => isAdmin || codes?.[r]);
  const origin = typeof location !== "undefined" ? location.origin : "";

  async function change(role) {
    setBusy(role); setError("");
    try {
      const fresh = await access.rotate(session.rid, role);
      if (role === "admin") onAdminCodeChanged?.(fresh);
      await load(); setConfirm("");
      toast(role === "viewer" ? "New read-only link created. The old one has stopped working." : `New ${role} code created. The old one has stopped working.`, "ok", 5000);
    } catch (e) { setError("Couldn't change the code: " + (e?.message || "network error")); }
    setBusy("");
  }
  async function toggleViewer(on) {
    setBusy("viewer"); setError("");
    try { on ? await access.enableViewer(session.rid) : await access.disableViewer(session.rid); await load(); toast(on ? "Read-only link is on" : "Read-only link is off. Viewers can no longer open the timetable.", "ok", 4500); }
    catch (e) { setError("Couldn't change the link: " + (e?.message || "network error")); }
    setBusy("");
  }
  async function upgrade() {
    setBusy("upgrade"); setError("");
    try { await onUpgrade(); await load(); toast("Roles are on. Everyone else needs to rejoin with the room code, which is now the editor code.", "ok", 8000); }
    catch (e) { setError(/permission|denied/i.test(e?.message || e?.code || "") ? "Only the person who created this room can switch on roles." : "Couldn't switch on roles: " + (e?.message || "network error")); }
    setBusy("");
  }

  return (
    <Modal title={session.legacy ? "Share this room" : "Share and access"} subtitle={session.roomName || "Shared room"} onClose={onClose} width={560}>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {session.legacy && (
          <div className="callout info">
            <b>This room was made before roles existed.</b> Everyone with its code ({session.code}) can edit. The person who created it can switch on roles, which adds an admin code and a read-only link. The current code keeps working as the editor code.
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn variant="primary" size="md" onClick={upgrade} disabled={busy === "upgrade"}>{busy === "upgrade" ? "Switching on…" : "Switch on roles"}</Btn>
              <Btn variant="outline" size="md" onClick={() => copy(session.code, toast, "Room code copied")}><Icon name="copy" size={16} /> Copy room code</Btn>
            </div>
          </div>
        )}
        {codes === null && !session.legacy && <div className="status">Loading codes…</div>}
        {error && <div className="callout bad" role="alert">{error}</div>}

        {rows.map(role => {
          const code = codes?.[role];
          return (
            <section key={role} style={{ border: "1px solid var(--border2)", borderRadius: "var(--r2)", padding: 14, background: "var(--bg3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <RolePill role={role} />
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{ROLE_BLURB[role]}</span>
              </div>
              {code ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <code style={{ font: "600 22px var(--mono)", letterSpacing: ".18em", color: "var(--text)" }}>{code}</code>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Btn variant="outline" onClick={() => copy(joinLink(origin, code), toast, "Link copied")}><Icon name="link" size={15} /> Copy link</Btn>
                      <Btn variant="outline" onClick={() => copy(code, toast, "Code copied")}><Icon name="copy" size={15} /> Copy code</Btn>
                    </div>
                  </div>
                  {isAdmin && (
                    <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {confirm === role ? (
                        <>
                          <span style={{ fontSize: 13, color: "var(--danger)", flex: "1 1 220px" }}>
                            {role === "admin" ? "The old admin code will stop working for everyone who has it." : `Everyone who joined with the old ${role === "viewer" ? "read-only link" : "editor code"} loses access until they use the new one.`}
                          </span>
                          <Btn variant="danger" onClick={() => change(role)} disabled={busy === role}>{busy === role ? "Changing…" : "Change code"}</Btn>
                          <Btn variant="ghost" onClick={() => setConfirm("")}>Cancel</Btn>
                        </>
                      ) : (
                        <>
                          <Btn variant="ghost" onClick={() => setConfirm(role)}><Icon name="refresh" size={15} /> Change code</Btn>
                          {role === "viewer" && <Btn variant="ghost" onClick={() => toggleViewer(false)} disabled={busy === "viewer"}>Turn off link</Btn>}
                        </>
                      )}
                    </div>
                  )}
                  {role === "admin" && <div className="hint" style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Keep this one private. Admin rights belong to the browser that joined with it, so save this code to get them back on another device.</div>}
                </>
              ) : role === "viewer" && isAdmin ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 8 }}>The read-only link is off.</div>
                  <Btn variant="accent" onClick={() => toggleViewer(true)} disabled={busy === "viewer"}>Turn on read-only link</Btn>
                </div>
              ) : null}
            </section>
          );
        })}
        {!isAdmin && !session.legacy && codes && rows.length === 0 && <div className="empty"><p>No codes to show for your role.</p></div>}
        {session.role === "editor" && !session.legacy && <div className="callout">Only an admin can change codes or turn the read-only link off.</div>}
      </div>
    </Modal>
  );
}

// ═══════════════════════════ Room bar ═══════════════════════════
export function RoomBar({ session, presence, syncing, lastSyncAt, onShare, onLeave }) {
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(x => x + 1), 5000); return () => clearInterval(t); }, []);
  const others = Object.entries(presence).filter(([id]) => id !== session.userId);
  const secs = lastSyncAt ? Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000)) : null;
  return (
    <div className="roombar">
      <strong style={{ fontSize: 14, maxWidth: "28ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.roomName || "Shared room"}</strong>
      <RolePill role={session.role} />
      <div className="grow" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center" }} aria-label={`${others.length + 1} online`}>
          <span title={session.userName + " (you)"}><Avatar name={session.userName} color={session.userColor} size={24} /></span>
          {others.slice(0, 6).map(([id, p]) => <span key={id} style={{ marginLeft: -6 }}><Avatar name={p.name} color={p.color} size={24} /></span>)}
          {others.length > 6 && <span className="badge" style={{ marginLeft: 4 }}>+{others.length - 6}</span>}
        </div>
        <span className="status">{others.length === 0 ? "Just you" : `${others.length + 1} online`}</span>
        {syncing ? <span className="status"><span className="dot pulse" />Syncing</span>
          : secs !== null ? <span className="status" title="Last change received or sent"><span className="dot" />Up to date</span> : null}
      </div>
      <Btn variant="outline" onClick={onShare}><Icon name="share" size={15} /> {session.role === "viewer" ? "Share link" : "Share"}</Btn>
      <Btn variant="ghost" onClick={onLeave}><Icon name="logout" size={15} /> Leave</Btn>
    </div>
  );
}

// ═══════════════════════════ Access lost ═══════════════════════════
export function AccessLostModal({ info, onJoinAgain, onClose }) {
  return (
    <Modal title="You no longer have access" subtitle={info.roomName || "Shared room"} onClose={onClose} width={460}>
      <div style={{ padding: 20 }}>
        <p style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 14 }}>
          {info.reason === "code-changed"
            ? "An admin changed the code you used to join, or turned that link off. Ask them for the current code or link."
            : "We couldn't reconnect to the room. Check your connection, then try joining again."}
          {" "}Your timetable on this device is unchanged.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="primary" size="md" onClick={onJoinAgain}>Join with a code</Btn>
          <Btn variant="outline" size="md" onClick={onClose}>Keep working alone</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════ Activity ═══════════════════════════
export function ActivityFeed({ roomCode, presence, selfId }) {
  const [ops, setOps] = useState([]);
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!roomCode) return;
    setOps([]);
    const seen = new Set();
    const off = subscribeOps(roomCode, op => {
      if (seen.has(op.key)) return; seen.add(op.key);
      setOps(prev => [...prev, op].slice(-50));
    });
    const t = setInterval(() => setNow(x => x + 1), 10000);
    return () => { off && off(); clearInterval(t); };
  }, [roomCode]);
  const recent = [...ops].reverse().slice(0, 30);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Online now</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.entries(presence).map(([id, p]) => (
            <span key={id} className="pill" style={{ borderColor: p.color }}>
              <span className="dot" style={{ background: p.color }} />{p.name}{id === selfId ? " (you)" : ""}{p.role === "viewer" ? " · viewing" : ""}
            </span>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px", minHeight: 0 }}>
        {recent.length === 0 && <div className="empty"><h3>Quiet so far</h3><p>Changes your team makes will show up here as they happen.</p></div>}
        {recent.map((op, i) => (
          <div key={op.id || i} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <span className="dot" style={{ marginTop: 6, background: op.userId === selfId ? "var(--accent)" : "var(--muted2)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{op.userName || "Someone"}</span>
              <span style={{ color: "var(--muted)" }}> {op.type || "made a change"}</span>
              {op.detail && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 1 }}>{op.detail}</div>}
              <div style={{ font: "500 12px var(--mono)", color: "var(--muted2)", marginTop: 2 }}>{new Date(op.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
