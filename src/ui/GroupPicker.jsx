import { useEffect, useId, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { buildGroupTree, toggleMany } from "../groups.js";

const Box = ({ on, part }) => (
  <span style={{ width: 16, height: 16, borderRadius: 4, border: "1.5px solid " + (on || part ? "var(--accent)" : "var(--border2)"), background: on ? "var(--accent)" : "transparent", display: "grid", placeItems: "center", color: on ? "var(--on-accent)" : "var(--accent)", flexShrink: 0, font: "700 11px var(--sans)" }}>
    {on ? <Icon name="check" size={12} style={{ strokeWidth: 3 }} /> : part ? "–" : null}
  </span>
);
const row = sel => ({ width: "100%", textAlign: "left", padding: "9px 12px", display: "flex", alignItems: "center", gap: 9, fontSize: 14, background: sel ? "var(--accent-soft)" : "transparent", borderBottom: "1px solid var(--border)", minHeight: 40 });

/** Pick student groups: parents first, then drill into a parent to pick its children. */
export default function GroupPicker({ groups, value = [], onChange, placeholder = "Choose groups…", showSize = false, single = false, noneLabel, style, compact = false }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState(null);
  const [q, setQ] = useState("");
  const ref = useRef(null), id = useId();
  const tree = useMemo(() => buildGroupTree(groups), [groups]);
  const label = g => `${g.name}${showSize && g.size ? ` (${g.size})` : ""}`;
  const byId = useMemo(() => new Map((groups || []).map(g => [g.id, g])), [groups]);
  const selected = value.map(v => byId.get(v)).filter(Boolean);
  const close = () => { setOpen(false); setFolder(null); setQ(""); };
  const toggle = v => { if (single) { onChange(value.includes(v) ? [] : [v]); close(); } else onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]); };

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const k = e => { if (e.key === "Escape") { e.stopPropagation(); if (folder) setFolder(null); else close(); } };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k, true);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k, true); };
  }, [open, folder]);

  const node = folder && tree.find(n => n.key === folder);
  const needle = q.trim().toLowerCase();
  const found = needle ? (groups || []).filter(g => g.name.toLowerCase().includes(needle)) : null;
  const leaf = g => { const sel = value.includes(g.id); return (
    <button key={g.id} type="button" role="option" aria-selected={sel} onClick={() => toggle(g.id)} style={row(sel)}><Box on={sel} />{label(g)}</button>); };

  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => (open ? close() : setOpen(true))}
        style={{ width: "100%", textAlign: "left", background: "var(--bg2)", border: `1px solid ${open ? "var(--accent)" : "var(--border2)"}`, borderRadius: "var(--r)", padding: "6px 10px", minHeight: 38, display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", boxShadow: open ? "var(--glow)" : "none", cursor: "pointer" }}>
        {selected.length === 0 && <span style={{ color: "var(--muted)", fontSize: 14 }}>{noneLabel || placeholder}</span>}
        {compact && selected.length > 2
          ? <span className="badge">{selected.length} groups</span>
          : selected.slice(0, 6).map(g => <span key={g.id} className="badge">{g.name}</span>)}
        {!compact && selected.length > 6 && <span className="badge">+{selected.length - 6} more</span>}
        <Icon name={open ? "up" : "down"} size={15} style={{ marginLeft: "auto", color: "var(--muted)" }} />
      </button>
      {open && (
        <div id={id} role="listbox" aria-multiselectable="true" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r)", marginTop: 3, boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", maxHeight: 320 }}>
          {(groups || []).length > 8 && (
            <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search groups…" aria-label="Search groups" style={{ width: "100%" }} />
            </div>
          )}
          <div style={{ overflowY: "auto", minHeight: 0 }}>
            {(groups || []).length === 0 && <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>Nothing to choose from yet.</div>}
            {found ? (
              found.length ? found.map(leaf) : <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>No group matches “{q}”.</div>
            ) : node ? (
              <>
                <button type="button" onClick={() => setFolder(null)} style={{ ...row(false), fontWeight: 600, color: "var(--accent)" }}><Icon name="left" size={15} />All groups<span style={{ color: "var(--muted)", fontWeight: 400 }}>/ {node.label}</span></button>
                {!single && <button type="button" onClick={() => onChange(toggleMany(value, node.children.map(c => c.id)))} style={{ ...row(false), fontWeight: 600 }}>
                  <Box on={node.children.every(c => value.includes(c.id))} part={node.children.some(c => value.includes(c.id))} />Select all {node.children.length}
                </button>}
                {node.self && leaf({ ...node.self, name: `${node.self.name} (whole group)` })}
                {node.children.map(leaf)}
              </>
            ) : [single && noneLabel && (
              <button key="__none" type="button" role="option" aria-selected={value.length === 0} onClick={() => { onChange([]); close(); }} style={{ ...row(value.length === 0), color: "var(--muted)" }}>{noneLabel}</button>
            ), ...tree.map(n => {
              if (!n.children.length) return leaf(n.self);
              const ids = n.children.map(c => c.id), nSel = ids.filter(i => value.includes(i)).length + (n.self && value.includes(n.self.id) ? 1 : 0);
              return (
                <button key={n.key} type="button" onClick={() => setFolder(n.key)} style={row(nSel > 0)} aria-label={`${n.label}, ${n.children.length} groups, ${nSel} selected`}>
                  <Icon name="people" size={16} style={{ color: "var(--muted)" }} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{n.label}</span>
                  <span style={{ color: nSel ? "var(--accent)" : "var(--muted)", fontSize: 12.5 }}>{nSel ? `${nSel} of ${n.children.length + (n.self ? 1 : 0)}` : n.children.length}</span>
                  <Icon name="right" size={15} style={{ color: "var(--muted)" }} />
                </button>
              );
            })]}
          </div>
          {selected.length > 0 && !single && (
            <div style={{ padding: "7px 12px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", fontSize: 12.5, color: "var(--muted)" }}>
              {selected.length} selected<div style={{ flex: 1 }} /><button type="button" onClick={() => onChange([])} style={{ color: "var(--accent)", fontWeight: 600 }}>Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
