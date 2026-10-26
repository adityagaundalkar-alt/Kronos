import { useState, useContext, useMemo } from "react";
import { CollabCtx } from "../collab/context.js";
import { Btn, Badge, Avatar, Segmented, EmptyState } from "../ui/kit.jsx";
import Icon from "../ui/Icon.jsx";
import { ago, canDeleteComment, canResolveComment, MAX_COMMENT } from "../comments.js";
import { getPalette, DAYS_FULL } from "../constants.js";
import { timeLabel } from "../timeslots.js";

const ROLE_TAG = { admin: "Admin", editor: "Editor", viewer: "Viewer" };

function Composer({ apptId, api, placeholder = "Write a comment…" }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    const ok = await api.add(apptId, text);
    setSending(false);
    if (ok) setText("");
  }
  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value.slice(0, MAX_COMMENT))} placeholder={placeholder} rows={2}
        aria-label="New comment" onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: "var(--muted2)" }}>{text.length > MAX_COMMENT - 200 ? `${MAX_COMMENT - text.length} characters left` : "Ctrl+Enter to post"}</span>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={send} disabled={!text.trim() || sending}>{sending ? "Posting…" : "Post comment"}</Btn>
      </div>
    </div>
  );
}

function Comment({ c, selfUid, role, api }) {
  const [confirming, setConfirming] = useState(false);
  const mine = c.uid === selfUid;
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border)", opacity: c.resolved ? .62 : 1 }}>
      <Avatar name={c.name} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{c.name}{mine ? " (you)" : ""}</strong>
          {c.role && c.role !== "editor" && <Badge color={c.role === "viewer" ? "yellow" : "green"}>{ROLE_TAG[c.role] || c.role}</Badge>}
          <span style={{ fontSize: 12, color: "var(--muted2)" }} title={new Date(c.at).toLocaleString()}>{ago(c.at)}</span>
          {c.resolved && <Badge color="green"><Icon name="check" size={11} /> Resolved</Badge>}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 2 }}>{c.text}</div>
        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          {canResolveComment(c, selfUid, role) && (
            <Btn variant="ghost" size="xs" onClick={() => api.setResolved(c, !c.resolved)}>{c.resolved ? "Reopen" : "Mark resolved"}</Btn>
          )}
          {canDeleteComment(c, selfUid, role) && (confirming
            ? <><Btn variant="danger" size="xs" onClick={() => api.remove(c)}>Delete comment</Btn><Btn variant="ghost" size="xs" onClick={() => setConfirming(false)}>Keep</Btn></>
            : <Btn variant="ghost" size="xs" onClick={() => setConfirming(true)}>Delete</Btn>)}
        </div>
      </div>
    </div>
  );
}

/** The discussion under one session. */
export function CommentsPanel({ apptId }) {
  const { session, comments, api } = useContext(CollabCtx);
  const list = comments.byAppt[apptId] || [];
  if (!session) {
    return <div className="callout">Comments are for shared rooms. Start or join a room from <b>Work together</b> and your team can discuss each session here.</div>;
  }
  return (
    <section aria-label="Comments">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon name="chat" size={16} />
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Comments</h3>
        {list.length > 0 && <Badge>{list.length}</Badge>}
      </div>
      {list.length === 0 && <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 10 }}>No comments yet. Ask a question or flag a problem with this session.</div>}
      {list.map(c => <Comment key={c.id} c={c} selfUid={session.uid} role={session.role} api={api} />)}
      <div style={{ marginTop: 10 }}><Composer apptId={apptId} api={api} /></div>
    </section>
  );
}

/** Every open (or every) comment in the room, grouped by session. */
export function CommentsTab({ state, onOpenAppt }) {
  const { session, comments } = useContext(CollabCtx);
  const [show, setShow] = useState("open");
  const { appointments, courses, slots } = state;

  const groups = useMemo(() => {
    const out = [];
    Object.entries(comments.byAppt).forEach(([apptId, list]) => {
      const visible = show === "open" ? list.filter(c => !c.resolved) : list;
      if (!visible.length) return;
      out.push({ apptId, appt: appointments[apptId], list: visible, last: Math.max(...visible.map(c => c.at || 0)) });
    });
    return out.sort((a, b) => b.last - a.last);
  }, [comments.byAppt, show, appointments]);

  if (!session) {
    return <div style={{ padding: 22 }}><EmptyState title="Comments live in shared rooms">Start or join a room to let your team, instructors and students comment on sessions.</EmptyState></div>;
  }
  const totalOpen = Object.values(comments.open).reduce((a, b) => a + b, 0);
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px 22px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <Segmented label="Show" value={show} onChange={setShow} options={[{ value: "open", label: `Open${totalOpen ? ` (${totalOpen})` : ""}` }, { value: "all", label: "All" }]} />
        <span style={{ color: "var(--muted)", fontSize: 14 }}>Open a session to reply.</span>
      </div>
      {groups.length === 0 && <EmptyState title={show === "open" ? "Nothing waiting" : "No comments yet"}>{show === "open" ? "Every comment has been resolved." : "Open a session and use the comments box to start a conversation."}</EmptyState>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
        {groups.map(g => {
          const pal = getPalette(g.appt?.courseId, courses);
          return (
            <section key={g.apptId} style={{ border: "1px solid var(--border2)", borderLeft: `4px solid ${pal.accent}`, borderRadius: "var(--r2)", background: "var(--bg2)", padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {g.appt ? (
                  <>
                    <span style={{ font: "600 13px var(--mono)", color: pal.accent }}>{g.appt.courseCode}</span>
                    <strong style={{ fontSize: 15 }}>{g.appt.courseName}</strong>
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>Week {g.appt.weekNum}, {DAYS_FULL[g.appt.dayIdx]}, {timeLabel(g.appt, slots)}</span>
                    <div style={{ flex: 1 }} />
                    <Btn variant="outline" onClick={() => onOpenAppt(g.appt)}>Open session</Btn>
                  </>
                ) : <span style={{ color: "var(--muted)" }}>This session was deleted</span>}
              </div>
              {g.list.map(c => (
                <div key={c.id} style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8, opacity: c.resolved ? .6 : 1 }}>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}><strong style={{ color: "var(--text)" }}>{c.name}</strong> · {ago(c.at)}{c.resolved ? " · resolved" : ""}</div>
                  <div style={{ fontSize: 14, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
