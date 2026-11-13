import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, bad, text, oneOf, idParam, parseJson, FILES_DIR, activityTypes, defaultCategory } from './db.js';
import { nowLocal, today, addDays, addMonths, parseLocal, isDate, isTime, isDateTime, weekStart, daysBetween } from './time.js';

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
export const STATUSES = ['Not Started', 'In Progress', 'Completed'];
export const PRIO_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

// Shared SQL fragments (alias `t` = tasks). TASK_DATE is the day a task "belongs to".
export const TASK_SELECT = 'SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t LEFT JOIN projects p ON p.id = t.project_id';
export const TASK_DATE = 'COALESCE(t.scheduled_date, substr(t.due_at, 1, 10))';
const PRIO_SQL = "CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END";
export const TASK_ORDER = `ORDER BY (t.status = 'Completed'), ${TASK_DATE} IS NULL, ${TASK_DATE}, t.sort_order, ${PRIO_SQL}, t.due_at IS NULL, t.due_at, t.id`;
/** Incomplete and past its deadline (or past its scheduled day when it has no deadline). Bind: nowLocal(). */
export const OVERDUE = "t.status != 'Completed' AND COALESCE(t.due_at, t.scheduled_date || 'T23:59', '9999') < ?";

const COLS = ['title', 'notes', 'scheduled_date', 'start_time', 'due_at', 'priority', 'category', 'status', 'project_id',
  'recurrence', 'reminders', 'schedules', 'links', 'notify_whatsapp', 'sort_order', 'completed_at', 'created_at', 'updated_at'];

/** Attach subtasks/attachments and parse JSON columns. Mutates and returns the rows. */
export function hydrate(tasks) {
  if (!tasks.length) return tasks;
  const ids = tasks.map((t) => t.id);
  const ph = ids.map(() => '?').join(',');
  const by = new Map();
  for (const t of tasks) {
    t.subtasks = [];
    t.attachments = [];
    t.links = parseJson(t.links, []);
    t.reminders = parseJson(t.reminders, null);
    t.schedules = parseJson(t.schedules, []);
    t.recurrence = parseJson(t.recurrence, null);
    t.notify_whatsapp = !!t.notify_whatsapp;
    by.set(t.id, t);
  }
  for (const s of db.all(`SELECT * FROM subtasks WHERE task_id IN (${ph}) ORDER BY sort_order, id`, ...ids)) by.get(s.task_id).subtasks.push({ ...s, done: !!s.done });
  for (const a of db.all(`SELECT * FROM attachments WHERE task_id IN (${ph}) ORDER BY id`, ...ids)) by.get(a.task_id).attachments.push(a);
  return tasks;
}

export function getTask(id) {
  const t = db.get(`${TASK_SELECT} WHERE t.id = ?`, id);
  return t ? hydrate([t])[0] : null;
}

/** Insert a task row (plain column values, JSON already stringified) plus optional subtasks. Returns new id. */
export function insertTask(row, subtasks = []) {
  const r = db.run(`INSERT INTO tasks (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`, ...COLS.map((c) => row[c] ?? null));
  const id = Number(r.lastInsertRowid);
  subtasks.forEach((s, i) => db.run('INSERT INTO subtasks (task_id, title, done, sort_order) VALUES (?,?,?,?)', id, String(s.title).slice(0, 500), s.done ? 1 : 0, s.sort_order ?? i));
  return id;
}

/** Serialise a hydrated task back into insertable column values. */
const toRow = (t, overrides = {}) => ({
  ...t,
  recurrence: t.recurrence ? JSON.stringify(t.recurrence) : null,
  reminders: t.reminders ? JSON.stringify(t.reminders) : null,
  schedules: t.schedules?.length ? JSON.stringify(t.schedules) : null,
  links: JSON.stringify(t.links ?? []),
  notify_whatsapp: t.notify_whatsapp ? 1 : 0,
  ...overrides,
});

const touch = (id) => db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', nowLocal(), id);

/** Replace a task's subtasks with `list` ([{id?, title, done}] or strings); existing ids are updated, missing ones deleted. */
function syncSubtasks(taskId, list) {
  const keep = [];
  list.forEach((s, i) => {
    const title = text(typeof s === 'string' ? s : s?.title, 500, 'Subtask title').trim();
    if (!title) return;
    const done = s?.done ? 1 : 0;
    if (Number.isInteger(s?.id) && db.get('SELECT 1 FROM subtasks WHERE id = ? AND task_id = ?', s.id, taskId)) {
      db.run('UPDATE subtasks SET title = ?, done = ?, sort_order = ? WHERE id = ?', title, done, i, s.id);
      keep.push(s.id);
    } else {
      keep.push(Number(db.run('INSERT INTO subtasks (task_id, title, done, sort_order) VALUES (?,?,?,?)', taskId, title, done, i).lastInsertRowid));
    }
  });
  db.run(`DELETE FROM subtasks WHERE task_id = ? ${keep.length ? `AND id NOT IN (${keep.map(() => '?').join(',')})` : ''}`, taskId, ...keep);
}

// ---------- validation ----------
export function cleanRecurrence(r) {
  if (!r || typeof r !== 'object') throw bad('Recurrence must be an object');
  const freq = oneOf(r.freq, ['daily', 'weekly', 'monthly', 'custom'], 'Recurrence frequency');
  const out = { freq, interval: Math.min(365, Math.max(1, Math.trunc(Number(r.interval)) || 1)) };
  if (freq === 'weekly') out.weekdays = [...new Set((Array.isArray(r.weekdays) ? r.weekdays : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (freq === 'custom') out.unit = oneOf(r.unit || 'days', ['days', 'weeks', 'months'], 'Recurrence unit');
  return out;
}

/** Schedule-based reminders: { type: 'daily', times: ['09:00', ...] } or { type: 'weekly', weekday: 0-6, time: 'HH:MM' }. */
export function cleanSchedules(list) {
  if (!Array.isArray(list) || list.length > 10) throw bad('Reminder schedules must be a list of up to 10 entries');
  return list.map((s) => {
    if (s?.type === 'daily') {
      const times = [...new Set((Array.isArray(s.times) ? s.times : []).filter(isTime))].sort();
      if (!times.length) throw bad('A daily reminder needs at least one time (HH:MM)');
      if (times.length > 12) throw bad('A daily reminder can have at most 12 times');
      return { type: 'daily', times };
    }
    if (s?.type === 'weekly') {
      const weekday = Number(s.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw bad('A weekly reminder needs a weekday (0 = Sunday … 6 = Saturday)');
      if (!isTime(s.time)) throw bad('A weekly reminder needs a time (HH:MM)');
      return { type: 'weekly', weekday, time: s.time };
    }
    throw bad('Reminder type must be "daily" or "weekly"');
  });
}

/** Validate/coerce a request body into column values. Unknown keys are ignored. */
export function clean(body, { create = false } = {}) {
  if (!body || typeof body !== 'object') throw bad('Request body must be a JSON object');
  const out = {};
  if (create || 'title' in body) {
    const title = text(body.title, 500, 'Title').trim();
    if (!title) throw bad('Title is required');
    out.title = title;
  }
  if ('notes' in body) out.notes = text(body.notes, 20000, 'Notes');
  if ('scheduled_date' in body) {
    if (body.scheduled_date && !isDate(body.scheduled_date)) throw bad('scheduled_date must be YYYY-MM-DD');
    out.scheduled_date = body.scheduled_date || null;
  }
  if ('start_time' in body) {
    if (body.start_time && !isTime(body.start_time)) throw bad('start_time must be HH:MM');
    out.start_time = body.start_time || null;
  }
  if ('due_at' in body) {
    if (body.due_at && !isDateTime(body.due_at)) throw bad('due_at must be YYYY-MM-DDTHH:MM');
    out.due_at = body.due_at || null;
  }
  if ('priority' in body) out.priority = oneOf(body.priority, PRIORITIES, 'Priority');
  if ('category' in body) out.category = oneOf(body.category, activityTypes().map((t) => t.name), 'Activity type');
  if ('status' in body) out.status = oneOf(body.status, STATUSES, 'Status');
  if ('project_id' in body) {
    if (body.project_id == null || body.project_id === '') out.project_id = null;
    else {
      const id = Number(body.project_id);
      if (!Number.isInteger(id) || !db.get('SELECT 1 FROM projects WHERE id = ?', id)) throw bad('Project not found');
      out.project_id = id;
    }
  }
  if ('recurrence' in body) out.recurrence = body.recurrence ? JSON.stringify(cleanRecurrence(body.recurrence)) : null;
  if ('reminders' in body) {
    if (body.reminders == null) out.reminders = null;
    else {
      if (!Array.isArray(body.reminders) || body.reminders.length > 12 || !body.reminders.every((m) => Number.isInteger(m) && Math.abs(m) <= 43200)) {
        throw bad('Reminders must be a list of up to 12 minute offsets (within 30 days)');
      }
      out.reminders = JSON.stringify([...new Set(body.reminders)].sort((a, b) => b - a));
    }
  }
  if ('schedules' in body) {
    out.schedules = body.schedules == null || (Array.isArray(body.schedules) && !body.schedules.length) ? null : JSON.stringify(cleanSchedules(body.schedules));
  }
  if ('links' in body) {
    if (!Array.isArray(body.links) || body.links.length > 30) throw bad('Links must be a list (max 30)');
    out.links = JSON.stringify(body.links.map((l) => {
      const url = text(typeof l === 'string' ? l : l?.url, 2000, 'Link URL').trim();
      if (!url) throw bad('Link URL is required');
      return { url, label: text(l?.label, 200, 'Link label').trim() };
    }));
  }
  if ('notify_whatsapp' in body) out.notify_whatsapp = body.notify_whatsapp ? 1 : 0;
  return out;
}

// ---------- recurrence ----------
/** Next occurrence date after `base` ('YYYY-MM-DD'), skipping forward until >= notBefore when given. */
export function nextOccurrence(rec, base, notBefore) {
  const step = (d) => {
    if (rec.freq === 'daily') return addDays(d, rec.interval);
    if (rec.freq === 'monthly' || (rec.freq === 'custom' && rec.unit === 'months')) return addMonths(d, rec.interval);
    if (rec.freq === 'custom') return addDays(d, rec.unit === 'weeks' ? 7 * rec.interval : rec.interval);
    const days = rec.weekdays?.length ? rec.weekdays : [parseLocal(d).getDay()];
    for (let i = 1; i <= 7 * rec.interval + 7; i++) {
      const cand = addDays(d, i);
      if (!days.includes(parseLocal(cand).getDay())) continue;
      if ((daysBetween(weekStart(d), weekStart(cand)) / 7) % rec.interval === 0) return cand;
    }
    return addDays(d, 7 * rec.interval);
  };
  let next = step(base);
  for (let i = 0; i < 1000 && notBefore && next < notBefore; i++) next = step(next);
  return next;
}

/** Create the following occurrence of a completed recurring task. Returns the new hydrated task or null. */
export function spawnNext(task) {
  const base = task.scheduled_date || task.due_at?.slice(0, 10);
  if (!task.recurrence || !base) return null;
  const next = nextOccurrence(task.recurrence, base, today());
  const shift = daysBetween(base, next);
  const now = nowLocal();
  const id = insertTask(toRow(task, {
    scheduled_date: task.scheduled_date ? next : null,
    due_at: task.due_at ? addDays(task.due_at.slice(0, 10), shift) + task.due_at.slice(10) : null,
    status: 'Not Started',
    completed_at: null,
    created_at: now,
    updated_at: now,
  }), task.subtasks.map((s) => ({ ...s, done: false })));
  return getTask(id);
}

// ---------- routes ----------
const r = Router();

r.get('/', (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  const now = nowLocal();
  const td = today();
  switch (q.view) {
    case 'today': where.push(`(${TASK_DATE} = ? OR (${OVERDUE}))`); params.push(td, now); break;
    case 'overdue': where.push(`(${OVERDUE})`); params.push(now); break;
    case 'upcoming': where.push(`t.status != 'Completed' AND ${TASK_DATE} > ? AND ${TASK_DATE} <= ?`); params.push(td, addDays(td, 7)); break;
    case 'unscheduled': where.push(`t.status != 'Completed' AND ${TASK_DATE} IS NULL`); break;
    case 'completed': where.push("t.status = 'Completed'"); break;
    case 'open': where.push("t.status != 'Completed'"); break;
    default: break;
  }
  if (q.from) { where.push(`${TASK_DATE} >= ?`); params.push(String(q.from)); }
  if (q.to) { where.push(`${TASK_DATE} <= ?`); params.push(String(q.to)); }
  if (q.project_id) { where.push('t.project_id = ?'); params.push(Number(q.project_id)); }
  for (const f of ['status', 'category', 'priority']) if (q[f]) { where.push(`t.${f} = ?`); params.push(String(q[f])); }
  if (q.q) { where.push('(t.title LIKE ? OR t.notes LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  const limit = Math.min(Number(q.limit) || 1000, 5000);
  res.json(hydrate(db.all(`${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${TASK_ORDER} LIMIT ?`, ...params, limit)));
});

r.post('/', (req, res) => {
  const s = getSettings();
  const t = clean(req.body, { create: true });
  const now = nowLocal();
  const priority = t.priority ?? s.default_priority;
  const id = db.tx(() => insertTask({
    ...t,
    notes: t.notes ?? '',
    priority,
    category: t.category ?? defaultCategory(),
    status: t.status ?? 'Not Started',
    links: t.links ?? '[]',
    notify_whatsapp: t.notify_whatsapp ?? (PRIO_RANK[priority] <= PRIO_RANK[s.whatsapp_min_priority] ? 1 : 0),
    sort_order: db.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tasks').n,
    completed_at: t.status === 'Completed' ? now : null,
    created_at: now,
    updated_at: now,
  }, (Array.isArray(req.body.subtasks) ? req.body.subtasks : [])
    .map((st) => (typeof st === 'string' ? { title: st } : st))
    .filter((st) => st && typeof st.title === 'string' && st.title.trim())));
  res.status(201).json(getTask(id));
});

r.put('/reorder', (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) throw bad('ids must be an array of integers');
  db.tx(() => ids.forEach((id, i) => db.run('UPDATE tasks SET sort_order = ? WHERE id = ?', i, id)));
  res.json({ ok: true });
});

r.get('/:id', (req, res) => {
  const t = getTask(idParam(req.params.id));
  if (!t) throw bad('Task not found', 404);
  res.json(t);
});

r.patch('/:id', (req, res) => {
  const id = idParam(req.params.id);
  const existing = getTask(id);
  if (!existing) throw bad('Task not found', 404);
  const t = clean(req.body);
  const now = nowLocal();
  let next = null;
  db.tx(() => {
    if (t.status && t.status !== existing.status) t.completed_at = t.status === 'Completed' ? now : null;
    const keys = Object.keys(t);
    if (keys.length) db.run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => t[k]), now, id);
    if (Array.isArray(req.body.subtasks)) { syncSubtasks(id, req.body.subtasks); touch(id); }
    if (t.status === 'Completed' && existing.status !== 'Completed') next = spawnNext(getTask(id));
  });
  res.json({ ...getTask(id), next });
});

r.delete('/:id', (req, res) => {
  const t = getTask(idParam(req.params.id));
  if (!t) throw bad('Task not found', 404);
  for (const a of t.attachments) fs.rmSync(path.join(FILES_DIR, a.stored_name), { force: true });
  db.run('DELETE FROM tasks WHERE id = ?', t.id);
  res.json({ ok: true });
});

r.post('/:id/duplicate', (req, res) => {
  const t = getTask(idParam(req.params.id));
  if (!t) throw bad('Task not found', 404);
  const now = nowLocal();
  const id = db.tx(() => insertTask(
    toRow(t, { title: `${t.title} (copy)`, status: 'Not Started', completed_at: null, sort_order: t.sort_order + 1, created_at: now, updated_at: now }),
    t.subtasks.map((s) => ({ ...s, done: false })),
  ));
  res.status(201).json(getTask(id));
});

// ---- subtasks ----
r.post('/:id/subtasks', (req, res) => {
  const id = idParam(req.params.id);
  if (!db.get('SELECT 1 FROM tasks WHERE id = ?', id)) throw bad('Task not found', 404);
  const title = text(req.body?.title, 500, 'Subtask title').trim();
  if (!title) throw bad('Subtask title is required');
  const n = db.get('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM subtasks WHERE task_id = ?', id).n;
  db.run('INSERT INTO subtasks (task_id, title, done, sort_order) VALUES (?,?,0,?)', id, title, n);
  touch(id);
  res.status(201).json(getTask(id));
});

r.patch('/:id/subtasks/:sid', (req, res) => {
  const id = idParam(req.params.id);
  const sid = idParam(req.params.sid);
  const s = db.get('SELECT * FROM subtasks WHERE id = ? AND task_id = ?', sid, id);
  if (!s) throw bad('Subtask not found', 404);
  const title = 'title' in (req.body || {}) ? text(req.body.title, 500, 'Subtask title').trim() : s.title;
  if (!title) throw bad('Subtask title is required');
  const done = 'done' in (req.body || {}) ? (req.body.done ? 1 : 0) : s.done;
  const order = Number.isInteger(req.body?.sort_order) ? req.body.sort_order : s.sort_order;
  db.run('UPDATE subtasks SET title = ?, done = ?, sort_order = ? WHERE id = ?', title, done, order, sid);
  touch(id);
  res.json(getTask(id));
});

r.delete('/:id/subtasks/:sid', (req, res) => {
  const id = idParam(req.params.id);
  const sid = idParam(req.params.sid);
  if (!db.run('DELETE FROM subtasks WHERE id = ? AND task_id = ?', sid, id).changes) throw bad('Subtask not found', 404);
  touch(id);
  res.json(getTask(id));
});

// ---- attachments (raw body upload; filename in x-filename header) ----
r.post('/:id/attachments', express.raw({ type: () => true, limit: '200mb' }), (req, res) => {
  const id = idParam(req.params.id);
  if (!db.get('SELECT 1 FROM tasks WHERE id = ?', id)) throw bad('Task not found', 404);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Empty upload');
  let raw = req.get('x-filename') || 'file';
  try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
  const filename = path.basename(raw).replace(/[^\w.\- ()[\]]/g, '_').slice(0, 150) || 'file';
  const stored = `${id}-${Date.now()}-${filename}`;
  fs.writeFileSync(path.join(FILES_DIR, stored), req.body);
  db.run('INSERT INTO attachments (task_id, filename, stored_name, size, created_at) VALUES (?,?,?,?,?)', id, filename, stored, req.body.length, nowLocal());
  touch(id);
  res.status(201).json(getTask(id));
});

r.delete('/:id/attachments/:aid', (req, res) => {
  const id = idParam(req.params.id);
  const a = db.get('SELECT * FROM attachments WHERE id = ? AND task_id = ?', idParam(req.params.aid), id);
  if (!a) throw bad('Attachment not found', 404);
  fs.rmSync(path.join(FILES_DIR, a.stored_name), { force: true });
  db.run('DELETE FROM attachments WHERE id = ?', a.id);
  touch(id);
  res.json(getTask(id));
});

export default r;
