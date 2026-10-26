import { useState, useEffect, useRef, useCallback, useId, cloneElement, isValidElement } from "react";
import Icon from "./Icon.jsx";
import { uid } from "../constants.js";

// ── Hooks ─────────────────────────────────────────────────────────
export function useMedia(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query), on = () => setM(mq.matches);
    on(); mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return m;
}

const THEME_KEY = "kronos_theme";
/** Light / dark / follow the device. Writes data-resolved on <html> so CSS and palette helpers agree. */
export function useTheme() {
  const [mode, setModeState] = useState(() => { try { return localStorage.getItem(THEME_KEY) || "system"; } catch { return "system"; } });
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  useEffect(() => {
    document.documentElement.dataset.resolved = resolved;
    document.documentElement.dataset.theme = mode;
  }, [resolved, mode]);
  const setMode = useCallback(m => { setModeState(m); try { localStorage.setItem(THEME_KEY, m); } catch { /* private mode */ } }, []);
  const toggle = useCallback(() => setMode(resolved === "dark" ? "light" : "dark"), [resolved, setMode]);
  return { mode, resolved, setMode, toggle };
}

export function useToasts() {
  const [list, setList] = useState([]);
  const push = useCallback((msg, type = "ok", ms = 3500) => {
    const id = uid();
    setList(t => [...t, { id, msg, type }]);
    setTimeout(() => setList(t => t.filter(x => x.id !== id)), ms);
  }, []);
  const dismiss = useCallback(id => setList(t => t.filter(x => x.id !== id)), []);
  return { list, push, dismiss };
}

// ── Small components ──────────────────────────────────────────────
export function Badge({ children, color = "muted", style }) {
  return <span className={`badge ${color}`} style={style}>{children}</span>;
}

export function Btn({ children, onClick, variant = "ghost", size = "sm", style, disabled = false, title = "", type = "button", icon = false, label, className = "" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title || undefined} aria-label={label}
      className={`btn ${variant} ${size} ${icon ? "icon" : ""} ${className}`} style={style}>
      {children}
    </button>
  );
}

export function Field({ label, children, required = false, hint = "" }) {
  const id = useId();
  const single = isValidElement(children) && typeof children.type === "string" && ["input", "select", "textarea"].includes(children.type);
  const control = single ? cloneElement(children, { id: children.props.id || id, "aria-describedby": hint ? id + "-h" : undefined }) : children;
  return (
    <div className="field" role={single ? undefined : "group"} aria-labelledby={single ? undefined : id + "-l"}>
      <label id={id + "-l"} htmlFor={single ? (children.props.id || id) : undefined}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {control}
      {hint && <div className="hint" id={id + "-h"}>{hint}</div>}
    </div>
  );
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Avatar({ name, color, size = 28, src, ring }) {
  const ini = String(name || "?").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  return (
    <span className="avatar" title={name} style={{ width: size, height: size, fontSize: Math.max(9, size * .38), ...(color ? { background: color + "26", color, borderColor: color } : null), ...(ring ? { boxShadow: `0 0 0 2px var(--bg2), 0 0 0 4px ${ring}` } : null) }}>
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : ini}
    </span>
  );
}

// ── Dialog: focus moves in, Tab stays inside, Esc closes, focus returns on close ─────
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Modal({ title, subtitle, onClose, children, width = 520, footer }) {
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const first = el?.querySelector("[data-autofocus]") || el?.querySelector(".dialog-body " + FOCUSABLE) || el?.querySelector(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const onKey = e => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); try { prev?.focus?.({ preventScroll: true }); } catch { /* element gone */ } };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: width }}>
        <div className="dialog-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="dialog-title" id={titleId}>{title}</h2>
            {subtitle && <div className="dialog-sub">{subtitle}</div>}
          </div>
          <Btn onClick={onClose} icon label="Close"><Icon name="close" size={18} /></Btn>
        </div>
        <div className="dialog-body">{children}</div>
        {footer}
      </div>
    </div>
  );
}

export function MultiSelect({ options, value = [], onChange, placeholder = "Select…", disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null), id = useId();
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const k = e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k, true);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k, true); };
  }, [open]);
  const selected = options.filter(o => value.includes(o.value));
  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(v => !v)}
        style={{ width: "100%", textAlign: "left", background: disabled ? "var(--bg3)" : "var(--bg2)", border: `1px solid ${open ? "var(--accent)" : "var(--border2)"}`, borderRadius: "var(--r)", padding: "6px 10px", minHeight: 38, display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", boxShadow: open ? "var(--glow)" : "none", opacity: disabled ? .65 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
        {selected.length === 0 && <span style={{ color: "var(--muted)", fontSize: 14 }}>{placeholder}</span>}
        {selected.map(o => <span key={o.value} className="badge">{o.label}</span>)}
        <Icon name={open ? "up" : "down"} size={15} style={{ marginLeft: "auto", color: "var(--muted)" }} />
      </button>
      {open && (
        <div id={id} role="listbox" aria-multiselectable="true"
          style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r)", marginTop: 3, maxHeight: 220, overflowY: "auto", boxShadow: "var(--shadow)" }}>
          {options.length === 0 && <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>Nothing to choose from yet.</div>}
          {options.map(o => {
            const sel = value.includes(o.value);
            return (
              <button key={o.value} type="button" role="option" aria-selected={sel} onClick={() => toggle(o.value)}
                style={{ width: "100%", textAlign: "left", padding: "9px 12px", display: "flex", alignItems: "center", gap: 9, fontSize: 14, background: sel ? "var(--accent-soft)" : "transparent", borderBottom: "1px solid var(--border)" }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, border: "1.5px solid " + (sel ? "var(--accent)" : "var(--border2)"), background: sel ? "var(--accent)" : "transparent", display: "grid", placeItems: "center", color: "var(--on-accent)", flexShrink: 0 }}>
                  {sel && <Icon name="check" size={12} style={{ strokeWidth: 3 }} />}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Toasts({ list, dismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => <div key={t.id} className={`toast ${t.type}`} onClick={() => dismiss(t.id)}>{t.msg}</div>)}
    </div>
  );
}
