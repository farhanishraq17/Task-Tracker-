// Date helpers for the wall-clock strings the API uses ('YYYY-MM-DD', 'HH:MM', 'YYYY-MM-DDTHH:MM').
// Strings are treated as plain calendar values; "today"/"now" are computed in the configured timezone.

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromYmd = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const fromLocal = (s) => { const d = fromYmd(s); if (s.length > 10) { const [h, m] = s.slice(11, 16).split(':').map(Number); d.setHours(h, m); } return d; };

/** 'YYYY-MM-DDTHH:MM' for the current instant in timezone tz (falls back to the browser's zone). */
export function nowIn(tz) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date()).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  } catch {
    const d = new Date();
    return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
export const todayIn = (tz) => nowIn(tz).slice(0, 10);

export const addDays = (s, n) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const addMonths = (s, n) => { const d = fromYmd(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return ymd(d); };
export const weekStart = (s) => { const d = fromYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }; // Monday
export const monthStart = (s) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s) => { const d = fromYmd(s); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
export const daysBetween = (a, b) => Math.round((fromYmd(b) - fromYmd(a)) / 86400000);

/** 42-cell month grid (Monday first) for the month containing s. */
export function monthGrid(s) {
  const first = monthStart(s);
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const fmt = (d, opts) => new Intl.DateTimeFormat(undefined, opts).format(d);
export const fmtTime = (hhmm) => { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); return fmt(new Date(2000, 0, 1, h, m), { hour: 'numeric', minute: '2-digit' }); };
export const fmtLong = (s) => fmt(fromYmd(s), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtMonth = (s) => fmt(fromYmd(s), { month: 'long', year: 'numeric' });
export const fmtShort = (s) => fmt(fromYmd(s), { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtDay = (s) => fmt(fromYmd(s), { day: 'numeric', month: 'short' });
export const weekdayShort = (s) => fmt(fromYmd(s), { weekday: 'short' });

/** Human label for a date relative to today: Today / Tomorrow / Yesterday / weekday (within 6 days) / short date. */
export function relDate(s, today) {
  if (!s) return '';
  const diff = daysBetween(today, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return fmt(fromYmd(s), { weekday: 'long' });
  const sameYear = s.slice(0, 4) === today.slice(0, 4);
  return fmt(fromYmd(s), sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Deadline label, e.g. "Today, 5:00 PM" / "Tomorrow, 9:00 AM" / "Fri 20 Nov, 6:00 PM". */
export const relDateTime = (dt, today) => (dt ? `${relDate(dt.slice(0, 10), today)}, ${fmtTime(dt.slice(11, 16))}` : '');

/** Describe how far a deadline is from now: "in 3 h", "in 2 days", "2 h overdue". */
export function dueDistance(dt, now) {
  const mins = Math.round((fromLocal(dt) - fromLocal(now)) / 60000);
  const abs = Math.abs(mins);
  const unit = abs >= 1440 ? `${Math.round(abs / 1440)} day${Math.round(abs / 1440) === 1 ? '' : 's'}` : abs >= 60 ? `${Math.round(abs / 60)} h` : `${abs} min`;
  return mins >= 0 ? `in ${unit}` : `${unit} overdue`;
}

export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Reminder offset (minutes before deadline) -> label. */
export function offsetLabel(min) {
  if (min === 0) return 'At deadline';
  const abs = Math.abs(min);
  const u = abs % 10080 === 0 ? [abs / 10080, 'week'] : abs % 1440 === 0 ? [abs / 1440, 'day'] : abs % 60 === 0 ? [abs / 60, 'hour'] : [abs, 'minute'];
  const s = `${u[0]} ${u[1]}${u[0] === 1 ? '' : 's'}`;
  return min > 0 ? `${s} before` : `${s} after`;
}
export const REMINDER_PRESETS = [10080, 2880, 1440, 180, 60, 30, 10, 0, -60, -1440];
