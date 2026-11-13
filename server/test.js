// Integration tests against a throwaway database. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'));
process.env.DATA_DIR = dir;
for (const k of ['SMTP_HOST', 'WHATSAPP_PROVIDER']) delete process.env[k]; // integrations off

const { app } = await import('./index.js');
const { db, saveSettings } = await import('./db.js');
const { tick } = await import('./scheduler.js');
const { nextOccurrence } = await import('./tasks.js');
const { parseHtmlMeta, youtubeInfo } = await import('./resources.js');
const { toLocal, today, addDays } = await import('./time.js');

let server;
let base;
before(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  saveSettings({ channels: { browser: true, desktop: false, email: false, whatsapp: false }, digest_time: '', auto_backup: false });
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function api(method, url, body) {
  const res = await fetch(base + url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let parsed;
  try { parsed = JSON.parse(txt); } catch { parsed = txt; }
  return { status: res.status, body: parsed };
}

test('tasks: quick add, update, subtasks, reorder, duplicate, complete, delete', async () => {
  const c = await api('POST', '/api/tasks', { title: 'Write intro' });
  assert.equal(c.status, 201);
  assert.equal(c.body.priority, 'Medium');
  assert.deepEqual(c.body.subtasks, []);
  const id = c.body.id;

  const u = await api('PATCH', `/api/tasks/${id}`, { priority: 'High', due_at: `${today()}T23:00`, category: 'Research', links: [{ url: 'https://example.com', label: 'ref' }] });
  assert.equal(u.status, 200);
  assert.equal(u.body.priority, 'High');
  assert.equal(u.body.links[0].label, 'ref');

  const s1 = await api('POST', `/api/tasks/${id}/subtasks`, { title: 'Outline' });
  assert.equal(s1.body.subtasks.length, 1);
  const s2 = await api('PATCH', `/api/tasks/${id}/subtasks/${s1.body.subtasks[0].id}`, { done: true });
  assert.equal(s2.body.subtasks[0].done, true);

  const t2 = await api('POST', '/api/tasks', { title: 'Second', scheduled_date: today() });
  assert.equal((await api('PUT', '/api/tasks/reorder', { ids: [t2.body.id, id] })).status, 200);
  const list = (await api('GET', '/api/tasks?view=today')).body;
  assert.ok(list.findIndex((t) => t.id === t2.body.id) < list.findIndex((t) => t.id === id), 'manual order respected');

  const dup = await api('POST', `/api/tasks/${id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal(dup.body.title, 'Write intro (copy)');
  assert.equal(dup.body.subtasks.length, 1);
  assert.equal(dup.body.subtasks[0].done, false);

  const done = await api('PATCH', `/api/tasks/${id}`, { status: 'Completed' });
  assert.ok(done.body.completed_at);
  assert.equal(done.body.next, null);

  assert.equal((await api('DELETE', `/api/tasks/${dup.body.id}`)).status, 200);
  assert.equal((await api('GET', `/api/tasks/${dup.body.id}`)).status, 404);
});

test('validation: bad input gets a 400 with a readable message', async () => {
  assert.equal((await api('POST', '/api/tasks', { title: '   ' })).status, 400);
  const r = await api('POST', '/api/tasks', { title: 'x', due_at: 'tomorrow' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /due_at/);
  assert.equal((await api('POST', '/api/tasks', { title: 'x', priority: 'Urgent' })).status, 400);
  assert.equal((await api('POST', '/api/resources', { url: 'not a url' })).status, 400);
  assert.equal((await api('PUT', '/api/settings', { timezone: 'Mars/Olympus' })).status, 400);
  assert.equal((await api('GET', '/api/nope')).status, 404);
  assert.equal((await api('GET', '/api/tasks/abc')).status, 404);
});

test('recurrence: completing spawns exactly one next occurrence', async () => {
  const td = today();
  const c = await api('POST', '/api/tasks', { title: 'Gym', scheduled_date: td, due_at: `${td}T07:00`, recurrence: { freq: 'daily', interval: 1 }, subtasks: ['Warm up'] });
  const done = await api('PATCH', `/api/tasks/${c.body.id}`, { status: 'Completed' });
  assert.ok(done.body.next);
  assert.equal(done.body.next.scheduled_date, addDays(td, 1));
  assert.equal(done.body.next.due_at, `${addDays(td, 1)}T07:00`);
  assert.equal(done.body.next.status, 'Not Started');
  assert.equal(done.body.next.subtasks[0].done, false);
  assert.equal((await api('PATCH', `/api/tasks/${c.body.id}`, { status: 'Completed' })).body.next, null);
});

test('nextOccurrence math', () => {
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-11-16'), '2026-11-18'); // Mon -> Wed
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 2, weekdays: [1] }, '2026-11-16'), '2026-11-30'); // every other Monday
  assert.equal(nextOccurrence({ freq: 'monthly', interval: 1 }, '2026-01-31'), '2026-02-28'); // clamps to month end
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1 }, '2026-11-01', '2026-11-13'), '2026-11-13'); // catches up to today
  assert.equal(nextOccurrence({ freq: 'custom', interval: 3, unit: 'weeks' }, '2026-11-13'), '2026-12-04');
});

test('projects: milestones, progress, task linking survives project deletion', async () => {
  const p = await api('POST', '/api/projects', { name: 'Thesis', target_date: '2027-03-01' });
  assert.equal(p.status, 201);
  assert.equal(p.body.progress, 0);
  const m = await api('POST', `/api/projects/${p.body.id}/milestones`, { title: 'Proposal', due_date: '2026-12-01' });
  assert.equal(m.body.milestones.length, 1);
  const t = await api('POST', '/api/tasks', { title: 'Lit review', project_id: p.body.id });
  await api('PATCH', `/api/tasks/${t.body.id}`, { status: 'Completed' });
  const md = await api('PATCH', `/api/projects/${p.body.id}/milestones/${m.body.milestones[0].id}`, { completed: true });
  assert.equal(md.body.progress, 100);
  const detail = await api('GET', `/api/projects/${p.body.id}`);
  assert.equal(detail.body.tasks.length, 1);
  assert.equal(detail.body.tasks[0].project_name, 'Thesis');
  await api('DELETE', `/api/projects/${p.body.id}`);
  assert.equal((await api('GET', `/api/tasks/${t.body.id}`)).body.project_id, null);
});

test('resources: collections, tags, search, status, metadata parsing, graceful offline fetch', async () => {
  const col = await api('POST', '/api/collections', { name: 'Agentic AI' });
  assert.equal(col.status, 201);
  const cid = col.body[0].id;
  const r1 = await api('POST', '/api/resources', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Agents talk', category: 'Video', tags: ['Agents', 'llm'], collection_id: cid });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.status, 'To Watch');
  assert.deepEqual(r1.body.tags, ['agents', 'llm']);
  assert.equal(r1.body.collection_name, 'Agentic AI');
  const r2 = await api('POST', '/api/resources', { url: 'https://arxiv.org/abs/1706.03762' });
  assert.equal(r2.body.category, 'Paper');
  assert.equal(r2.body.status, 'To Read');
  assert.equal(r2.body.title, 'arxiv.org');
  assert.equal((await api('GET', '/api/resources?tag=llm')).body.length, 1);
  assert.equal((await api('GET', '/api/resources?q=agents')).body.length, 1);
  assert.equal((await api('GET', `/api/resources?collection_id=${cid}`)).body.length, 1);
  assert.equal((await api('GET', '/api/resources/tags')).body.length, 2);
  assert.ok((await api('PATCH', `/api/resources/${r2.body.id}`, { status: 'Completed' })).body.completed_at);
  await api('DELETE', `/api/collections/${cid}`);
  assert.equal((await api('GET', '/api/resources?collection_id=none')).body.length, 2);

  assert.deepEqual(youtubeInfo(new URL('https://youtu.be/abc123xyz')), { video: 'abc123xyz' });
  assert.equal(youtubeInfo(new URL('https://www.youtube.com/playlist?list=PL123')).playlist, 'PL123');
  const meta = parseHtmlMeta('<html><head><title>Fallback</title><meta content="OG &amp; Title" property="og:title"><meta name="description" content="Desc"><meta property="og:image" content="/img.png"></head></html>', 'https://docs.example.com/guide');
  assert.equal(meta.title, 'OG & Title');
  assert.equal(meta.description, 'Desc');
  assert.equal(meta.thumbnail, 'https://docs.example.com/img.png');
  assert.equal(meta.category, 'Documentation');

  const offline = await api('POST', '/api/resources/metadata', { url: 'http://127.0.0.1:9/unreachable' });
  assert.equal(offline.status, 200);
  assert.ok(offline.body.error);
});

test('attachments: upload, download, delete', async () => {
  const t = await api('POST', '/api/tasks', { title: 'With file' });
  const up = await fetch(`${base}/api/tasks/${t.body.id}/attachments`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent('notes v1.txt') }, body: Buffer.from('hello') });
  assert.equal(up.status, 201);
  const body = await up.json();
  assert.equal(body.attachments.length, 1);
  assert.equal(body.attachments[0].filename, 'notes v1.txt');
  assert.equal(body.attachments[0].size, 5);
  assert.equal(await (await fetch(`${base}/files/${body.attachments[0].stored_name}`)).text(), 'hello');
  assert.equal((await api('DELETE', `/api/tasks/${t.body.id}/attachments/${body.attachments[0].id}`)).body.attachments.length, 0);
});

test('dashboard, insights and calendar', async () => {
  const td = today();
  const d = await api('GET', '/api/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.body.today, td);
  assert.ok(Array.isArray(d.body.tasks_today));
  assert.ok(d.body.streak >= 1);
  const i = await api('GET', '/api/insights');
  assert.equal(i.body.by_day.length, 30);
  assert.ok(i.body.done_today >= 2);
  assert.ok(i.body.week.total >= 1);
  const c = await api('GET', `/api/calendar?from=${td}&to=${addDays(td, 7)}`);
  assert.ok(c.body.tasks.length >= 1);
  assert.ok(Array.isArray(c.body.milestones));
  assert.equal((await api('GET', '/api/calendar')).status, 400);
});

test('reminder engine: fires once per offset+channel, dedupes, re-arms on reschedule, skips stale, ignores completed', async () => {
  const now = new Date();
  now.setSeconds(0, 0);
  const due = new Date(now.getTime() + 10 * 60000);
  const t = await api('POST', '/api/tasks', { title: 'Submit form', due_at: toLocal(due), reminders: [30, 0] });
  const rows = () => db.all('SELECT * FROM notification_log WHERE task_id = ? ORDER BY id', t.body.id);

  await tick(now);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].reminder_key, `due|${toLocal(due)}|30`);
  assert.equal(rows()[0].channel, 'browser');
  assert.equal(rows()[0].status, 'skipped'); // no dashboard tab connected
  await tick(now);
  assert.equal(rows().length, 1, 'no duplicate on the next tick');
  await tick(new Date(due.getTime() + 60000));
  assert.equal(rows().length, 2);
  assert.equal(rows()[1].reminder_key, `due|${toLocal(due)}|0`);

  const due2 = new Date(now.getTime() + 20 * 60000);
  await api('PATCH', `/api/tasks/${t.body.id}`, { due_at: toLocal(due2) });
  await tick(now);
  assert.equal(rows().length, 3, 'rescheduling re-arms reminders');
  assert.ok(rows()[2].reminder_key.includes(toLocal(due2)));

  const old = await api('POST', '/api/tasks', { title: 'Old', due_at: toLocal(new Date(now.getTime() - 2 * 86400e3)), reminders: [0] });
  await tick(now);
  const oldRows = db.all('SELECT channel, status, detail FROM notification_log WHERE task_id = ?', old.body.id);
  assert.equal(oldRows.length, 1, 'one row marks a stale reminder as handled for every channel');
  assert.equal(oldRows[0].channel, 'all');
  assert.ok(oldRows[0].status === 'skipped' && /already in the past/.test(oldRows[0].detail));
  await tick(now);
  assert.equal(db.all('SELECT 1 FROM notification_log WHERE task_id = ?', old.body.id).length, 1, 'stale reminder is not re-logged');

  await api('PATCH', `/api/tasks/${t.body.id}`, { status: 'Completed' });
  await tick(new Date(due2.getTime() + 60000));
  assert.equal(rows().length, 3, 'completed tasks never fire');
});

test('export/import: re-importing an export adds nothing; new rows merge; invalid rows roll back', async () => {
  const exp = await api('GET', '/api/data/export.json');
  assert.equal(exp.status, 200);
  assert.ok(exp.body.tasks.length >= 3);
  const before = db.get('SELECT COUNT(*) AS n FROM tasks').n;
  const imp = await api('POST', '/api/data/import', exp.body);
  assert.equal(imp.status, 200);
  assert.equal(imp.body.tasks, 0);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks').n, before);
  const fresh = await api('POST', '/api/data/import', { tasks: [{ title: 'Imported', created_at: '2020-01-01T10:00', subtasks: [{ title: 'a' }], priority: 'Low' }] });
  assert.equal(fresh.body.tasks, 1);
  assert.equal(fresh.body.subtasks, 1);
  assert.equal((await api('POST', '/api/data/import', { tasks: [{ title: 'Bad', due_at: 'nope' }] })).status, 400);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM tasks WHERE title = 'Bad'").n, 0);
  const csvRes = await fetch(`${base}/api/data/export/tasks.csv`);
  assert.equal(csvRes.status, 200);
  assert.match(await csvRes.text(), /Imported/);
});

test('backup, list, restore, refuse garbage', async () => {
  const b = await api('POST', '/api/data/backups');
  assert.equal(b.status, 201);
  assert.match(b.body.name, /^backup-.*\.db$/);
  assert.ok((await api('GET', '/api/data/backups')).body.some((x) => x.name === b.body.name));
  const t = await api('POST', '/api/tasks', { title: 'After backup' });
  const res = await api('POST', '/api/data/restore', { name: b.body.name });
  assert.equal(res.status, 200);
  assert.match(res.body.safety_backup, /^pre-restore-/);
  assert.equal((await api('GET', `/api/tasks/${t.body.id}`)).status, 404, 'state rolled back to the backup');
  const count = (await api('GET', '/api/tasks')).body.length;
  assert.ok(count >= 3);
  const garbage = await fetch(`${base}/api/data/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('not a database') });
  assert.equal(garbage.status, 400);
  assert.equal((await api('GET', '/api/tasks')).body.length, count, 'database untouched after refused restore');
});

test('settings: defaults, update, integration status, notification log', async () => {
  const s = await api('GET', '/api/settings');
  assert.equal(s.body.timezone, 'Asia/Dhaka');
  assert.equal(s.body.integrations.email, false);
  assert.ok(s.body.server.today);
  const u = await api('PUT', '/api/settings', { display_name: 'Alex', weekly_goal: 30, theme: 'dark', default_reminders: [60, 0, -60] });
  assert.equal(u.status, 200);
  assert.equal(u.body.display_name, 'Alex');
  assert.deepEqual(u.body.default_reminders, [60, 0, -60]);
  assert.equal((await api('PUT', '/api/settings', { weekly_goal: -1 })).status, 400);
  const log = await api('GET', '/api/settings/notifications');
  assert.ok(Array.isArray(log.body) && log.body.length > 0);
});
