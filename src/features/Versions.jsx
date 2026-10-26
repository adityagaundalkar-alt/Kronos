import { useState } from "react";
import { Btn, Badge } from "../ui/kit.jsx";
import Icon from "../ui/Icon.jsx";
import { askConfirm } from "../ui/Confirm.jsx";

const when = at => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Saved versions: save the timetable as it is now, or put an earlier one back. */
export default function VersionsPanel({ versions, canEdit, onRestore, defaultName = "" }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const { list, loading, error } = versions;

  async function saveNow() {
    setBusy("save"); setMsg("");
    const err = await versions.saveNow(name.trim() || `Saved ${when(Date.now())}`);
    setBusy(""); if (err) setMsg(err); else setName("");
  }
  async function restore(v) {
    const ok = await askConfirm({ title: "Put this version back?", message: `The timetable will go back to “${v.name}” from ${when(v.at)}.`, detail: `That version has ${v.sessions ?? "?"} sessions and ${v.courses ?? "?"} courses. Your current timetable is saved first as a version, and you can undo the restore.`, confirmLabel: "Restore this version", danger: false });
    if (!ok) return;
    setBusy(v.id); const err = await onRestore(v); setBusy(""); if (err) setMsg(err);
  }
  async function del(v) {
    if (!await askConfirm({ title: "Delete this saved version?", message: `“${v.name}” from ${when(v.at)} will be deleted for everyone in the term.`, confirmLabel: "Delete version" })) return;
    const err = await versions.remove(v.id); if (err) setMsg(err);
  }

  return (
    <section aria-labelledby="ver-h" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <h2 id="ver-h" style={{ fontSize: 15, fontWeight: 700 }}>Saved versions</h2>
        <Btn variant="ghost" size="xs" onClick={versions.refresh} disabled={loading} label="Refresh versions"><Icon name="refresh" size={14} /></Btn>
      </div>
      <p style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 10, maxWidth: 560 }}>
        Save the timetable before a big change and put it back later. Kronos also saves one for you before an import, a clear, or any change that touches many sessions. It keeps the latest {20}.
      </p>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, maxWidth: 560 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={`Name this version, e.g. “${defaultName || "Draft"} before holidays”`} aria-label="Version name" maxLength={120} style={{ flex: 1, minWidth: 200 }}
            onKeyDown={e => { if (e.key === "Enter" && !busy) saveNow(); }} />
          <Btn variant="primary" size="md" onClick={saveNow} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save version"}</Btn>
        </div>
      )}
      {(msg || error) && <div className="callout bad" role="alert" style={{ marginBottom: 10, maxWidth: 560 }}>{msg || error}</div>}
      {!loading && list.length === 0 && !error && <div style={{ fontSize: 14, color: "var(--muted)" }}>No saved versions yet.</div>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6, maxWidth: 640 }}>
        {list.map(v => (
          <li key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: "var(--r)", background: "var(--bg2)", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 600, fontSize: 14, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{v.name}{v.kind === "auto" && <Badge color="muted">Automatic</Badge>}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{when(v.at)}{v.by ? ` · ${v.by}` : ""} · {v.sessions ?? "?"} sessions, {v.courses ?? "?"} courses</div>
            </div>
            {canEdit && <>
              <Btn variant="outline" size="xs" onClick={() => restore(v)} disabled={!!busy}>{busy === v.id ? "Restoring…" : "Restore"}</Btn>
              <Btn variant="ghost" size="xs" onClick={() => del(v)} disabled={!!busy} label={`Delete ${v.name}`}><Icon name="trash" size={14} /></Btn>
            </>}
          </li>
        ))}
      </ul>
    </section>
  );
}
