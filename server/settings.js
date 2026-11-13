import { Router } from 'express';
import { db, getSettings, saveSettings, bad, oneOf, text, DEFAULT_SETTINGS } from './db.js';
import { nowLocal, today, isTime, isValidTimezone, applyTimezone } from './time.js';
import { PRIORITIES } from './tasks.js';
import * as notify from './notify.js';

export function validateSettings(p) {
  if (!p || typeof p !== 'object') throw bad('Request body must be a JSON object');
  const out = {};
  if ('display_name' in p) out.display_name = String(p.display_name ?? '').trim().slice(0, 80);
  if ('timezone' in p) {
    if (!isValidTimezone(p.timezone)) throw bad('Unknown timezone — use an IANA name such as Asia/Dhaka');
    out.timezone = p.timezone;
  }
  if ('default_priority' in p) out.default_priority = oneOf(p.default_priority, PRIORITIES, 'Default priority');
  if ('default_due_time' in p) {
    if (!isTime(p.default_due_time)) throw bad('Default due time must be HH:MM');
    out.default_due_time = p.default_due_time;
  }
  if ('default_reminders' in p) {
    if (!Array.isArray(p.default_reminders) || p.default_reminders.length > 12 || !p.default_reminders.every((m) => Number.isInteger(m) && Math.abs(m) <= 43200)) {
      throw bad('Default reminders must be a list of up to 12 minute offsets');
    }
    out.default_reminders = [...new Set(p.default_reminders)].sort((a, b) => b - a);
  }
  if ('channels' in p) {
    if (!p.channels || typeof p.channels !== 'object') throw bad('channels must be an object');
    out.channels = Object.fromEntries(Object.keys(DEFAULT_SETTINGS.channels).map((c) => [c, !!p.channels[c]]));
  }
  if ('whatsapp_min_priority' in p) out.whatsapp_min_priority = oneOf(p.whatsapp_min_priority, PRIORITIES, 'WhatsApp minimum priority');
  if ('theme' in p) out.theme = oneOf(p.theme, ['system', 'light', 'dark'], 'Theme');
  if ('weekly_goal' in p) {
    const n = Number(p.weekly_goal);
    if (!Number.isInteger(n) || n < 0 || n > 1000) throw bad('Weekly goal must be a whole number between 0 and 1000');
    out.weekly_goal = n;
  }
  if ('digest_time' in p) {
    if (p.digest_time && !isTime(p.digest_time)) throw bad('Digest time must be HH:MM');
    out.digest_time = p.digest_time || '';
  }
  if ('auto_backup' in p) out.auto_backup = !!p.auto_backup;
  return out;
}

const full = () => ({
  ...getSettings(),
  integrations: {
    email: notify.emailConfigured(),
    email_to: notify.emailConfigured() ? (process.env.EMAIL_TO || process.env.SMTP_USER) : null,
    whatsapp: notify.whatsappConfigured(),
    whatsapp_provider: notify.whatsappConfigured() ? process.env.WHATSAPP_PROVIDER : null,
    whatsapp_to: process.env.WHATSAPP_TO || null, // shown even before a provider is configured
    desktop: process.platform === 'win32',
  },
  server: { now: nowLocal(), today: today(), timezone: process.env.TZ, platform: process.platform },
});

const r = Router();

r.get('/', (req, res) => res.json(full()));

r.put('/', (req, res) => {
  const patch = validateSettings(req.body);
  saveSettings(patch);
  if (patch.timezone) applyTimezone(patch.timezone);
  res.json(full());
});

/** Replace the activity-type list. Renamed types carry their tasks along; tasks of removed types fall back to "Other". */
r.put('/activity-types', (req, res) => {
  const list = req.body;
  if (!Array.isArray(list) || !list.length) throw bad('Keep at least one activity type');
  if (list.length > 40) throw bad('That is a lot of activity types — keep it under 40');
  const seen = new Set();
  const clean = list.map((t, i) => {
    const name = text(t?.name, 40, 'Activity type name').trim();
    if (!name) throw bad('Every activity type needs a name');
    if (seen.has(name.toLowerCase())) throw bad(`"${name}" appears twice`);
    seen.add(name.toLowerCase());
    const color = /^#[0-9a-fA-F]{6}$/.test(t?.color || '') ? t.color.toLowerCase() : '#8a8699';
    const id = typeof t?.id === 'string' && /^[\w-]{1,40}$/.test(t.id) ? t.id : `t${Date.now().toString(36)}${i}`;
    return { id, name, color };
  });
  db.tx(() => {
    for (const prev of getSettings().activity_types) {
      const next = clean.find((t) => t.id === prev.id);
      if (next && next.name !== prev.name) db.run('UPDATE tasks SET category = ? WHERE category = ?', next.name, prev.name);
    }
    const names = clean.map((t) => t.name);
    const fallback = (clean.find((t) => t.name === 'Other') || clean[0]).name;
    db.run(`UPDATE tasks SET category = ? WHERE category NOT IN (${names.map(() => '?').join(',')})`, fallback, ...names);
    saveSettings({ activity_types: clean });
  });
  res.json(full());
});

r.post('/test/:channel', async (req, res) => {
  const ch = oneOf(req.params.channel, ['browser', 'desktop', 'email', 'whatsapp'], 'Channel');
  const title = 'Test notification';
  const body = `Your reminders are working. Sent ${nowLocal().replace('T', ' at ')}.`;
  const url = `http://localhost:${process.env.PORT || 3000}/`;
  try {
    if (ch === 'browser') notify.sendBrowser({ task_id: 0, key: `test|${Date.now()}`, title, body, url });
    else if (ch === 'desktop') await notify.sendDesktop(title, body, url);
    else if (ch === 'email') await notify.sendEmail(title, `${body}\n\n${url}`, notify.emailHtml(title, body, url));
    else await notify.sendWhatsApp(`*${title}*\n${body}`);
  } catch (e) {
    throw bad(`${ch} test failed: ${e.message}`, 502); // surface the provider's own message to the Settings page
  }
  res.json({ ok: true });
});

r.get('/notifications', (req, res) => {
  res.json(db.all('SELECT * FROM notification_log ORDER BY id DESC LIMIT ?', Math.min(Number(req.query.limit) || 60, 500)));
});

export default r;
