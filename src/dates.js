// Date helpers. All dates are handled as LOCAL calendar dates ("YYYY-MM-DD"),
// never via toISOString(), which converts to UTC and shifts the day in
// timezones such as Asia/Bangkok (before 07:00) or the Americas.

const pad = n => String(n).padStart(2, "0");

/** Format a Date as a local "YYYY-MM-DD" string. */
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Parse "YYYY-MM-DD" as local midnight. Falls back to `new Date(s)` for other input. */
export function parseISO(s) {
  if (s instanceof Date) return new Date(s.getTime());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return new Date(s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export const addDays = (d, n) => {
  const r = parseISO(d);
  r.setDate(r.getDate() + n);
  return r;
};

/** Monday (local midnight) of the week containing `d`. Sunday belongs to the week that just ended. */
export function mondayOf(d = new Date()) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

export const fmt = d =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
export const fmtLong = d =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

/** Start date of teaching week `wn` (week 0 = orientation, the week before week 1). */
export function getWeekStart(w1, wn) {
  const off = wn === 0 ? -7 : (wn - 1) * 7;
  return addDays(w1, off);
}

export const slotDate = (w1, wn, di) => addDays(getWeekStart(w1, wn), di);
