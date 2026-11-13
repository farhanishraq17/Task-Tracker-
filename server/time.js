// Wall-clock helpers. The server process runs in the configured timezone
// (process.env.TZ is set from settings at startup), so plain local Date methods
// already produce e.g. Asia/Dhaka wall-clock values. Stored values are local strings:
//   date -> 'YYYY-MM-DD'   time -> 'HH:MM'   datetime -> 'YYYY-MM-DDTHH:MM'
// These sort chronologically as text, so SQL comparisons work on them directly.

const pad = (n) => String(n).padStart(2, '0');

export const toDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toLocal = (d) => `${toDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const today = () => toDate(new Date());
export const nowLocal = () => toLocal(new Date());
export const stamp = () => { const d = new Date(); return `${toDate(d)}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`; };

/** Parse a local date or datetime string into a Date (interpreted in the process timezone). */
export const parseLocal = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00` : s) : null);

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseLocal(s).getTime());
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const isDateTime = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s) && !Number.isNaN(parseLocal(s).getTime());

export function addDays(ymd, n) {
  const d = parseLocal(ymd);
  d.setDate(d.getDate() + n);
  return toDate(d);
}

export function addMonths(ymd, n) {
  const [y, m, day] = ymd.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(day, last));
  return toDate(first);
}

/** Monday of the week containing ymd. */
export function weekStart(ymd) {
  const d = parseLocal(ymd);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDate(d);
}

export const daysBetween = (a, b) => Math.round((parseLocal(b) - parseLocal(a)) / 86400000);

export const isValidTimezone = (tz) => {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
};

/** Switch the whole process to a timezone. Node re-reads TZ at runtime (ICU), including on Windows. */
export function applyTimezone(tz) {
  if (!isValidTimezone(tz)) return false;
  process.env.TZ = tz;
  return true;
}

export const fmtDateTime = (s) =>
  parseLocal(s).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (s) =>
  parseLocal(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
