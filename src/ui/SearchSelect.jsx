import { useEffect, useId, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";

/** A single-choice dropdown with a search box, for long lists (courses, instructors, rooms).
 *  options: [{ value, label, hint? }]. `noneLabel` adds a first row that clears the choice (value ""). */
export default function SearchSelect({ options, value, onChange, placeholder = "Choose…", noneLabel, style, label }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null), id = useId();
  const cur = options.find(o => o.value === value);
  const close = () => { setOpen(false); setQ(""); };
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const k = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k, true);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k, true); };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (needle ? options.filter(o => `${o.label} ${o.hint || ""}`.toLowerCase().includes(needle)) : options), [options, needle]);
  const pick = v => { onChange(v); close(); };
  const row = sel => ({ width: "100%", textAlign: "left", padding: "9px 12px", display: "flex", alignItems: "center", gap: 9, fontSize: 14, background: sel ? "var(--accent-soft)" : "transparent", borderBottom: "1px solid var(--border)", minHeight: 40 });
  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => (open ? close() : setOpen(true))}
        style={{ width: "100%", textAlign: "left", background: "var(--bg2)", border: `1px solid ${open ? "var(--accent)" : "var(--border2)"}`, borderRadius: "var(--r)", padding: "6px 10px", minHeight: 38, display: "flex", alignItems: "center", gap: 6, boxShadow: open ? "var(--glow)" : "none", cursor: "pointer" }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, color: cur ? "var(--text)" : "var(--muted)" }}>{cur ? cur.label : (value === "" && noneLabel) || placeholder}</span>
        <Icon name={open ? "up" : "down"} size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />
      </button>
      {open && (
        <div id={id} role="listbox" style={{ position: "absolute", top: "100%", left: 0, right: 0, minWidth: 200, zIndex: 50, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r)", marginTop: 3, boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", maxHeight: 320 }}>
          {options.length > 7 && (
            <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" aria-label="Search" style={{ width: "100%" }} />
            </div>
          )}
          <div style={{ overflowY: "auto", minHeight: 0 }}>
            {noneLabel && !needle && <button type="button" role="option" aria-selected={value === ""} onClick={() => pick("")} style={{ ...row(value === ""), color: "var(--muted)" }}>{noneLabel}</button>}
            {shown.map(o => (
              <button key={o.value} type="button" role="option" aria-selected={o.value === value} onClick={() => pick(o.value)} style={row(o.value === value)}>
                <span style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
                {o.hint && <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{o.hint}</span>}
                {o.value === value && <Icon name="check" size={14} style={{ color: "var(--accent)" }} />}
              </button>
            ))}
            {shown.length === 0 && <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>Nothing matches “{q}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
