// Background reminder engine. Runs inside the server process every 30s, independent of any open browser tab.
// Idempotency: every (task, reminder_key, channel) is recorded in notification_log, so nothing is sent twice.
// Reminder keys embed the deadline, so rescheduling a task naturally re-arms its reminders.
import { db, getSettings, saveSettings } from './db.js';
import { toDate, toLocal, parseLocal, fmtDateTime, addDays } from './time.js';
import { TASK_DATE, TASK_ORDER, OVERDUE } from './tasks.js';
import { createBackup, pruneBackups } from './data.js';
import * as notify from './notify.js';

const GRACE_MS = 3 * 3600e3; // reminders older than this (server was off) are marked skipped, never sent late
const MAX_ATTEMPTS = 3;
const CHANNELS = ['browser', 'desktop', 'email', 'whatsapp'];
const baseUrl = () => `http://localhost:${process.env.PORT || 3000}`;

export function describeOffset(min) {
  if (min === 0) return 'Due now';
  const abs = Math.abs(min);
  const unit = abs % 1440 === 0 ? [abs / 1440, 'day'] : abs % 60 === 0 ? [abs / 60, 'hour'] : [abs, 'min'];
  const s = `${unit[0]} ${unit[1]}${unit[0] > 1 && unit[1] !== 'min' ? 's' : ''}`;
  return min > 0 ? `Due in ${s}` : `Overdue by ${s}`;
}

function logRow(task_id, key, channel, status, detail, title) {
  db.run(`INSERT INTO notification_log (task_id, reminder_key, channel, status, detail, title, attempts, created_at) VALUES (?,?,?,?,?,?,1,?)
    ON CONFLICT(task_id, reminder_key, channel) DO UPDATE SET status = excluded.status, detail = excluded.detail, attempts = attempts + 1, created_at = excluded.created_at`,
  task_id, key, channel, status, detail ?? null, title ?? null, toLocal(new Date()));
}

/**
 * Send one reminder through every enabled channel that has not handled it yet.
 * `handled` is a Map of "task|key|channel" -> log row, loaded once per tick.
 */
export async function dispatch({ task_id, key, title, body, url, whatsapp = true }, settings = getSettings(), handled = new Map()) {
  const done = (ch) => {
    const row = handled.get(`${task_id}|${key}|${ch}`);
    return row && (row.status !== 'failed' || row.attempts >= MAX_ATTEMPTS);
  };
  const senders = {
    browser: () => notify.sendBrowser({ task_id, key, title, body, url }),
    // Desktop toasts are the fallback for when no dashboard tab is open (avoids double-notifying).
    desktop: () => (notify.browserConnected() && settings.channels.browser ? { skipped: 'dashboard open in browser' } : notify.sendDesktop(title, body, url)),
    email: () => notify.sendEmail(title, `${body}\n\nOpen: ${url}`, notify.emailHtml(title, body, url)),
    whatsapp: () => notify.sendWhatsApp(`*${title}*\n${body}\n${url}`),
  };
  const enabled = {
    browser: settings.channels.browser,
    desktop: settings.channels.desktop,
    email: settings.channels.email && notify.emailConfigured(),
    whatsapp: settings.channels.whatsapp && notify.whatsappConfigured() && whatsapp,
  };
  const results = {};
  for (const ch of CHANNELS) {
    if (!enabled[ch] || done(ch)) continue;
    try {
      const r = await senders[ch]();
      results[ch] = r?.skipped ? 'skipped' : 'sent';
      logRow(task_id, key, ch, results[ch], r?.skipped || null, title);
    } catch (e) {
      results[ch] = e.skipped ? 'skipped' : 'failed';
      logRow(task_id, key, ch, results[ch], e.message, title);
    }
  }
  return results;
}

/** One log row (channel 'all') for a reminder that will never be sent, so the key counts as handled. */
const markSkipped = (task_id, key, reason, title) => logRow(task_id, key, 'all', 'skipped', reason, title);

/** Why a stale reminder is being skipped: the task was (re)scheduled after the reminder time, or the server was off. */
const staleReason = (task, fireAt) => (fireAt < parseLocal(task.updated_at).getTime() ? 'reminder time was already in the past when the task was scheduled' : 'missed: server was not running');

let running = false;

/** One scheduler pass. `now` is injectable for tests. */
export async function tick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const s = getSettings();
    const nowMs = now.getTime();
    const todayStr = toDate(now);
    const nowStr = toLocal(now);
    const handled = new Map(db.all('SELECT task_id, reminder_key, channel, status, attempts FROM notification_log').map((r) => [`${r.task_id}|${r.reminder_key}|${r.channel}`, r]));
    const isHandled = (task_id, key) => [...CHANNELS, 'all'].some((ch) => handled.has(`${task_id}|${key}|${ch}`));

    const tasks = db.all(`SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status != 'Completed' AND (t.due_at IS NOT NULL OR (t.scheduled_date IS NOT NULL AND t.start_time IS NOT NULL) OR t.schedules IS NOT NULL)`);

    for (const t of tasks) {
      const url = `${baseUrl()}/#/tasks?task=${t.id}`;
      const meta = `${t.priority} priority${t.project_name ? ` · ${t.project_name}` : ''}`;
      if (t.due_at) {
        const dueMs = parseLocal(t.due_at).getTime();
        let offsets = s.default_reminders;
        try { if (t.reminders) offsets = JSON.parse(t.reminders); } catch { /* use defaults */ }
        for (const off of offsets) {
          const fireAt = dueMs - off * 60000;
          if (fireAt > nowMs) continue;
          const key = `due|${t.due_at}|${off}`;
          if (nowMs - fireAt > GRACE_MS) { if (!isHandled(t.id, key)) markSkipped(t.id, key, staleReason(t, fireAt), t.title); continue; }
          await dispatch({ task_id: t.id, key, title: `${describeOffset(off)}: ${t.title}`, body: `Due ${fmtDateTime(t.due_at)} · ${meta}`, url, whatsapp: !!t.notify_whatsapp }, s, handled);
        }
      }
      if (t.scheduled_date && t.start_time) {
        const startStr = `${t.scheduled_date}T${t.start_time}`;
        const startMs = parseLocal(startStr).getTime();
        if (startMs <= nowMs) {
          const key = `start|${startStr}`;
          if (nowMs - startMs > GRACE_MS) { if (!isHandled(t.id, key)) markSkipped(t.id, key, staleReason(t, startMs), t.title); }
          else await dispatch({ task_id: t.id, key, title: `Starting now: ${t.title}`, body: `Scheduled ${t.start_time} · ${meta}`, url, whatsapp: !!t.notify_whatsapp }, s, handled);
        }
      }
      // Daily / weekly schedules: every slot of yesterday and today that has come due while the task is open.
      let schedules = [];
      try { schedules = t.schedules ? JSON.parse(t.schedules) : []; } catch { /* ignore corrupt value */ }
      for (const sch of schedules) {
        for (const day of [addDays(todayStr, -1), todayStr]) {
          const times = sch.type === 'daily' ? sch.times : parseLocal(day).getDay() === sch.weekday ? [sch.time] : [];
          for (const time of times) {
            const slot = `${day}T${time}`;
            const fireAt = parseLocal(slot).getTime();
            if (fireAt > nowMs || fireAt < parseLocal(t.created_at).getTime()) continue; // future, or before the task existed
            const key = `${sch.type}|${slot}`;
            if (nowMs - fireAt > GRACE_MS) { if (!isHandled(t.id, key)) markSkipped(t.id, key, staleReason(t, fireAt), t.title); continue; }
            await dispatch({ task_id: t.id, key, title: `${sch.type === 'daily' ? 'Daily' : 'Weekly'} reminder: ${t.title}`, body: `${meta}${t.due_at ? ` · due ${fmtDateTime(t.due_at)}` : ''}`, url, whatsapp: !!t.notify_whatsapp }, s, handled);
          }
        }
      }
    }

    // Morning digest: what's on today + what's overdue.
    if (s.digest_time && nowStr.slice(11) >= s.digest_time) {
      const key = `digest|${todayStr}`;
      if (!isHandled(0, key)) {
        const todays = db.all(`SELECT t.title, t.due_at FROM tasks t WHERE t.status != 'Completed' AND ${TASK_DATE} = ? ${TASK_ORDER}`, todayStr);
        const overdue = db.all(`SELECT t.title FROM tasks t WHERE ${OVERDUE} AND ${TASK_DATE} < ? ${TASK_ORDER}`, nowStr, todayStr);
        if (!todays.length && !overdue.length) markSkipped(0, key, 'nothing scheduled today', 'Daily digest');
        else {
          const lines = [
            ...todays.slice(0, 8).map((t) => `• ${t.title}${t.due_at ? ` (${t.due_at.slice(11)})` : ''}`),
            ...(todays.length > 8 ? [`• …and ${todays.length - 8} more`] : []),
            ...(overdue.length ? ['', `Overdue: ${overdue.slice(0, 5).map((t) => t.title).join(', ')}${overdue.length > 5 ? ` +${overdue.length - 5} more` : ''}`] : []),
          ];
          await dispatch({ task_id: 0, key, title: `Today: ${todays.length} task${todays.length === 1 ? '' : 's'}${overdue.length ? ` · ${overdue.length} overdue` : ''}`, body: lines.join('\n'), url: `${baseUrl()}/` }, s, handled);
        }
      }
    }

    // Daily automatic backup (keeps the 7 most recent).
    if (s.auto_backup && s.last_backup_date !== todayStr) {
      try {
        createBackup('auto');
        pruneBackups('auto', 7);
        saveSettings({ last_backup_date: todayStr });
      } catch (e) { console.error('[scheduler] auto backup failed:', e.message); }
    }
  } finally {
    running = false;
  }
}

export function startScheduler(intervalMs = 30000) {
  const run = () => tick().catch((e) => console.error('[scheduler]', e));
  run();
  return setInterval(run, intervalMs);
}
