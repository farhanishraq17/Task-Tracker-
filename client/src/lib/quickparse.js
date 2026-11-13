// Natural-language quick-add parser (pure, no dependencies).
// "Finish experiments by Friday 5pm !high #research"
//   -> { title: 'Finish experiments', scheduled_date, due_at, start_time, priority: 'High', category: 'Research' }
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const PRIORITY = { critical: 'Critical', crit: 'Critical', urgent: 'Critical', high: 'High', medium: 'Medium', med: 'Medium', low: 'Low' };
export const DEFAULT_CATEGORIES = ['Academics', 'Research', 'Projects', 'Personal', 'Learning', 'Other'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const shift = (s, n) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const valid = (y, m, d) => { const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? ymd(dt) : null; };
const monthIndex = (name) => MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3)));
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const PREP = '(?:\\b(?:by|on|due|before|until|till|for)\\s+)?';
const END = '(?=[\\s,.!?])';

/** `categories` = the user's activity type names; "#res" matches "Research" by prefix (case-insensitive). */
export function parseQuickAdd(input, { today, defaultDueTime = '18:00', categories = DEFAULT_CATEGORIES } = {}) {
  today ||= ymd(new Date());
  const raw = String(input ?? '').trim();
  let text = ` ${raw} `;
  const out = { title: '', scheduled_date: null, due_at: null, start_time: null, priority: null, category: null };

  // Replace the first match with a space when handler returns a truthy value; otherwise leave the text alone.
  const eat = (re, handler) => {
    let hit = false;
    text = text.replace(re, (...m) => { if (hit) return m[0]; const r = handler(...m); if (!r) return m[0]; hit = true; return ' '; });
    return hit;
  };

  eat(/\s!(critical|crit|urgent|high|medium|med|low)\b/i, (_, p) => (out.priority = PRIORITY[p.toLowerCase()]));
  eat(/\s#([\p{L}\p{N}_-]+)/u, (_, tag) => {
    const t = tag.toLowerCase();
    const match = categories.find((c) => c.toLowerCase() === t) || categories.find((c) => c.toLowerCase().startsWith(t));
    if (!match) return false;
    out.category = match;
    return true;
  });

  let time = null;
  let timePrep = null;
  eat(new RegExp(`\\s(?:(at|by|before|until|till|@)\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?${END}`, 'i'), (_, prep, h, mm, ap) => {
    if (!mm && !ap) return false; // bare "5" is ambiguous: keep it in the title
    let H = Number(h);
    const M = Number(mm || 0);
    if (ap) { const pm = ap[0].toLowerCase() === 'p'; if (pm && H < 12) H += 12; if (!pm && H === 12) H = 0; }
    if (H > 23 || M > 59) return false;
    time = `${pad(H)}:${pad(M)}`;
    timePrep = (prep || '').toLowerCase();
    return true;
  });

  let date = null;
  let datePrep = null; // "by Friday" marks the date as a deadline, so a bare time after it is a deadline too
  const todayDow = fromYmd(today).getDay();
  const patterns = [
    [new RegExp(`\\s${PREP}(?:the\\s+)?day after tomorrow${END}`, 'i'), () => shift(today, 2)],
    [new RegExp(`\\s${PREP}(today|tonight|eod)${END}`, 'i'), (_, w) => { if (w.toLowerCase() === 'tonight' && !time) time = '20:00'; return today; }],
    [new RegExp(`\\s${PREP}(tomorrow|tmrw|tmr)${END}`, 'i'), () => shift(today, 1)],
    [new RegExp(`\\sin\\s+(\\d{1,3})\\s+(day|days|week|weeks|month|months)${END}`, 'i'), (_, n, u) => {
      const k = Number(n);
      if (u.startsWith('month')) { const d = fromYmd(today); d.setMonth(d.getMonth() + k); return ymd(d); }
      return shift(today, u.startsWith('week') ? 7 * k : k);
    }],
    [new RegExp(`\\s${PREP}next\\s+week${END}`, 'i'), () => shift(today, ((8 - todayDow) % 7) || 7)],
    [new RegExp(`\\s${PREP}(next\\s+|this\\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)${END}`, 'i'), (_, mod, day) => {
      const target = WEEKDAYS.findIndex((w) => w.startsWith(day.toLowerCase().slice(0, 3)));
      let diff = (target - todayDow + 7) % 7;
      if ((mod || '').trim().toLowerCase() === 'next') {
        if (diff === 0) diff = 7;
        const nextMonday = ((8 - todayDow) % 7) || 7;
        if (diff < nextMonday) diff += 7; // "next Friday" = Friday of next week
      }
      return shift(today, diff);
    }],
    [new RegExp(`\\s${PREP}(\\d{4})-(\\d{2})-(\\d{2})${END}`), (_, y, m, d) => valid(+y, +m, +d)],
    [new RegExp(`\\s${PREP}${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${END}`, 'i'), (_, mon, d, y) => {
      const r = valid(y ? +y : +today.slice(0, 4), monthIndex(mon) + 1, +d);
      return r && !y && r < today ? valid(+today.slice(0, 4) + 1, monthIndex(mon) + 1, +d) : r;
    }],
    [new RegExp(`\\s${PREP}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?${END}`, 'i'), (_, d, mon, y) => {
      const r = valid(y ? +y : +today.slice(0, 4), monthIndex(mon) + 1, +d);
      return r && !y && r < today ? valid(+today.slice(0, 4) + 1, monthIndex(mon) + 1, +d) : r;
    }],
    [new RegExp(`\\s${PREP}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?${END}`), (_, d, m, y) => valid(y ? (y.length === 2 ? 2000 + +y : +y) : +today.slice(0, 4), +m, +d)], // D/M[/Y]
    [new RegExp(`\\s${PREP}(?:end of (?:the )?month|eom)${END}`, 'i'), () => { const d = fromYmd(today); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }],
  ];
  for (const [re, handler] of patterns) {
    if (date) break;
    eat(re, (...m) => {
      const r = handler(...m);
      if (r) { date = r; datePrep = /^\s(by|before|until|till|due)\b/i.exec(m[0])?.[1]?.toLowerCase() || null; }
      return !!r;
    });
  }

  out.title = text.replace(/\s+/g, ' ').trim().replace(/^[,.\-–\s]+|[,.\-–\s]+$/g, '').replace(/\s+(by|on|at|due|before|until|till|for)$/i, '').trim();
  if (!out.title) out.title = raw;

  if (time) {
    date ||= today;
    if (timePrep === 'at' || timePrep === '@' || (!timePrep && !datePrep)) out.start_time = time;
    out.due_at = `${date}T${time}`;
  } else if (date) {
    out.due_at = `${date}T${defaultDueTime}`;
  }
  out.scheduled_date = date;
  return out;
}
