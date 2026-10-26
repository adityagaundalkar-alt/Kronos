// Time helpers for slots and optional per-session custom times.
//
// A slot (e.g. Morning "09:00 – 12:00") is the grid cell a session lives in.
// A session may optionally carry its own `start` / `end` ("HH:MM"), e.g. 10:00-11:30.
// Without them it occupies its whole slot. Slots whose label has no parsable
// times (e.g. just "Morning") behave as before: whole-slot, same-slot clashes only.

const pad = n => String(n).padStart(2, "0");

/** "09:30" -> 570, or null if not a valid time. */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/** 570 -> "09:30" */
export const fromMinutes = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

/** Parse a slot label like "09:00 – 12:00" (en dash, em dash or hyphen). */
export function slotRange(slot) {
  const m = /(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/.exec(slot?.label || "");
  if (!m) return null;
  const start = toMinutes(m[1]), end = toMinutes(m[2]);
  return start != null && end != null && start < end ? { start, end } : null;
}

/** The session's own valid custom range, or null. */
export function customRange(appt) {
  const start = toMinutes(appt?.start), end = toMinutes(appt?.end);
  return start != null && end != null && start < end ? { start, end } : null;
}

/** Effective time range of a session: custom times, else its slot's window, else null (unknown). */
export function apptRange(appt, slots) {
  const c = customRange(appt);
  if (c) return { ...c, custom: true };
  const r = slotRange((slots || []).find(s => s.id === appt?.timeId));
  return r ? { ...r, custom: false } : null;
}

/**
 * Do two sessions occupy overlapping time?
 * - Different week/day: never.
 * - Both have known times: real time overlap, even across slots (11:00-13:30 vs 13:00-16:00 clash).
 * - Otherwise (unparsable slot): they clash only if they are in the same slot.
 * Back-to-back sessions (one ends exactly when the next starts) do not clash.
 */
export function sessionsOverlap(a, b, slots) {
  if (a.weekNum !== b.weekNum || a.dayIdx !== b.dayIdx) return false;
  const ra = apptRange(a, slots), rb = apptRange(b, slots);
  if (ra && rb) return ra.start < rb.end && rb.start < ra.end;
  return a.timeId === b.timeId;
}

/** "10:00–11:30" for a custom-time session; "" otherwise. */
export function customLabel(appt) {
  const c = customRange(appt);
  return c ? `${fromMinutes(c.start)}–${fromMinutes(c.end)}` : "";
}

/** Human label for a session's time: custom range if set, else the slot's label, else the slot id. */
export function timeLabel(appt, slots) {
  return customLabel(appt) || (slots || []).find(s => s.id === appt?.timeId)?.label || appt?.timeId || "";
}

/** Sort key (minutes from midnight) so sessions in one cell appear in time order. */
export function startKey(appt, slots) {
  return apptRange(appt, slots)?.start ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Validate custom times typed in the form.
 * Returns { ok, message, outsideSlot }. `outsideSlot` is only a warning:
 * the session is still allowed, it just sticks out of the slot's window.
 */
export function validateCustomTimes(start, end, slot) {
  const s = toMinutes(start), e = toMinutes(end);
  if (s == null || e == null) return { ok: false, message: "Enter both a start and an end time.", outsideSlot: false };
  if (s >= e) return { ok: false, message: "The end time must be after the start time.", outsideSlot: false };
  const r = slotRange(slot);
  return { ok: true, message: "", outsideSlot: !!r && (s < r.start || e > r.end) };
}
