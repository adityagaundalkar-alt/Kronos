import { Btn, EmptyState } from "../ui/kit.jsx";
import Icon from "../ui/Icon.jsx";
import { RolePill } from "../collab/CollabUI.jsx";

function TermRow({ term, opening, onOpen, onForget }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r2)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{term.name || "Untitled term"}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          <RolePill role={term.role} />
          {term.archived && <span className="pill warn">Archived</span>}
        </div>
      </div>
      <Btn variant="primary" size="md" onClick={() => onOpen(term)} disabled={opening}>{opening ? "Opening…" : term.archived ? "View" : "Open"}</Btn>
      <Btn icon variant="ghost" label={`Remove ${term.name || "term"} from this list`} onClick={() => onForget(term)}><Icon name="close" size={16} /></Btn>
    </li>
  );
}

/**
 * Where people land: pick a term to work in, start a new one, or join with a code.
 *   terms        [{ code, name, role, archived }]
 */
export default function TermsScreen({ terms, openingCode, error, user, onOpen, onForget, onNew, onJoin, onSignIn, onSignOut, onLocal }) {
  const current = terms.filter(t => !t.archived), older = terms.filter(t => t.archived);
  const list = (items) => <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8, padding: 0, margin: 0 }}>{items.map(t => <TermRow key={t.code} term={t} opening={openingCode === t.code} onOpen={onOpen} onForget={onForget} />)}</ul>;
  return (
    <main style={{ position: "fixed", inset: 0, overflowY: "auto", background: "var(--bg)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "clamp(20px, 5vw, 48px) 16px 40px" }}>
        <div className="brand" style={{ padding: 0, color: "var(--text)", marginBottom: 28 }}>
          <span className="brand-mark" aria-hidden="true">K</span><span className="brand-name">Kronos<small>2.0</small></span>
        </div>
        <h1 style={{ font: "400 clamp(30px, 6vw, 42px)/1.05 var(--serif)", marginBottom: 6 }}>Your terms</h1>
        <p style={{ color: "var(--muted)", marginBottom: 20, lineHeight: 1.5 }}>
          Each term has its own timetable that everyone on the team works in together. Older terms stay saved so you can look back at them.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
          <Btn variant="primary" size="md" onClick={onNew}><Icon name="plus" size={16} /> New term</Btn>
          <Btn variant="outline" size="md" onClick={onJoin}><Icon name="people" size={16} /> Join with a code</Btn>
        </div>
        {error && <div className="callout bad" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

        {terms.length === 0 && (
          <EmptyState title="No terms yet">Start a new term, or join your team's with the code they gave you.</EmptyState>
        )}
        {current.length > 0 && <section aria-label="Current terms" style={{ marginBottom: 24 }}><h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Current</h2>{list(current)}</section>}
        {older.length > 0 && <section aria-label="Older terms" style={{ marginBottom: 24 }}><h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Older terms</h2>{list(older)}</section>}

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
          {user ? (
            <p>Signed in as <b style={{ color: "var(--text)" }}>{user.displayName || user.email}</b>. Your terms are listed on any device you sign in on. <button type="button" onClick={onSignOut} style={{ color: "var(--accent)", textDecoration: "underline", font: "inherit" }}>Sign out</button></p>
          ) : (
            <p>This list is kept in this browser. <button type="button" onClick={onSignIn} style={{ color: "var(--accent)", textDecoration: "underline", font: "inherit" }}>Sign in with Google</button> to see your terms on any device.</p>
          )}
          <p style={{ marginTop: 8 }}><button type="button" onClick={onLocal} style={{ color: "var(--muted)", textDecoration: "underline", font: "inherit" }}>Work on this device only, without a team</button></p>
        </div>
      </div>
    </main>
  );
}
