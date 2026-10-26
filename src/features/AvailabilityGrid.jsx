import { DAYS, DAYS_FULL } from "../constants.js";

/** Tick the weekly times a person is available. Click a day or time name to toggle the whole row/column. */
export default function AvailabilityGrid({ availability = {}, onChange, slots, compact = false, disabled = false }) {
  const has = (di, id) => (availability[di] || []).includes(id);
  function toggle(di, id) {
    if (disabled) return;
    const cur = availability[di] || [];
    onChange({ ...availability, [di]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
  }
  function toggleDay(di) {
    if (disabled) return;
    const all = slots.map(s => s.id);
    onChange({ ...availability, [di]: (availability[di] || []).length === all.length ? [] : [...all] });
  }
  function toggleSlot(id) {
    if (disabled) return;
    const allHave = DAYS.every((_, d) => has(d, id));
    const next = {};
    DAYS.forEach((_, di) => {
      const cur = availability[di] || [];
      next[di] = allHave ? cur.filter(x => x !== id) : [...new Set([...cur, id])];
    });
    onChange(next);
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 3, minWidth: compact ? 290 : 360 }}>
        <thead>
          <tr>
            <th style={{ width: compact ? 74 : 96 }} />
            {DAYS.map((d, di) => (
              <th key={di} style={{ textAlign: "center", padding: "2px 2px" }}>
                <button type="button" onClick={() => toggleDay(di)} title={`Toggle all ${DAYS_FULL[di]}`} disabled={disabled}
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", padding: "4px 8px", borderRadius: "var(--r)" }}>{d}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map(slot => (
            <tr key={slot.id}>
              <td>
                <button type="button" onClick={() => toggleSlot(slot.id)} disabled={disabled} title={`Toggle ${slot.short} on every day`}
                  style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap", textAlign: "left", padding: "4px 6px 4px 0" }}>{slot.short}</button>
              </td>
              {DAYS.map((_, di) => {
                const on = has(di, slot.id);
                return (
                  <td key={di} style={{ textAlign: "center" }}>
                    <button type="button" role="checkbox" aria-checked={on} aria-label={`${DAYS_FULL[di]} ${slot.short}`} disabled={disabled} onClick={() => toggle(di, slot.id)}
                      style={{ width: compact ? 34 : 38, height: compact ? 28 : 32, borderRadius: 6, display: "grid", placeItems: "center", margin: "0 auto",
                        background: on ? "var(--accent-soft)" : "var(--bg3)", border: `1px solid ${on ? "var(--accent-line)" : "var(--border2)"}`, color: "var(--accent)" }}>
                      {on && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
