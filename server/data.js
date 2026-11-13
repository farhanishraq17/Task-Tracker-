// Export / import / backup / restore.
import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, DB_PATH, BACKUP_DIR, getSettings, saveSettings, bad } from './db.js';
import { nowLocal, today, stamp, isDate, isTime, isDateTime } from './time.js';
import { TASK_SELECT, hydrate, insertTask, clean as cleanTask } from './tasks.js';
import { hydrateResources, RESOURCE_CATEGORIES, RESOURCE_STATUSES } from './resources.js';
import { PROJECT_STATUSES } from './projects.js';
import { validateSettings } from './settings.js';

// ---------- backups ----------
const safeName = (name) => {
  if (typeof name !== 'string' || !/^[\w.-]+\.db$/.test(name)) throw bad('Invalid backup name');
  return path.join(BACKUP_DIR, name);
};

export function createBackup(prefix = 'backup') {
  const name = `${prefix}-${stamp()}.db`;
  db.backup(path.join(BACKUP_DIR, name));
  return name;
}

export function listBackups() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).map((f) => {
    const st = fs.statSync(path.join(BACKUP_DIR, f));
    return { name: f, size: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

export function pruneBackups(prefix, keep) {
  for (const b of listBackups().filter((b) => b.name.startsWith(`${prefix}-`)).slice(keep)) fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true });
}

/** Replace the live database with a validated SQLite file. The current DB is backed up first. */
export function restoreFrom(src) {
  let probe;
  try {
    probe = new DatabaseSync(src, { readOnly: true });
    const ok = probe.prepare('PRAGMA integrity_check').get();
    const hasTasks = probe.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get();
    if (ok?.integrity_check !== 'ok' || !hasTasks) throw new Error('not a valid Task Tracker database');
  } catch (e) {
    throw bad(`Restore refused: ${e.message}`);
  } finally {
    probe?.close();
  }
  const safety = createBackup('pre-restore');
  db.close();
  try {
    fs.copyFileSync(src, DB_PATH);
    for (const ext of ['-wal', '-shm']) fs.rmSync(DB_PATH + ext, { force: true });
  } finally {
    db.reopen();
  }
  return safety;
}

// ---------- export / import ----------
export function exportAll() {
  const projects = db.all('SELECT * FROM projects ORDER BY id');
  for (const p of projects) p.milestones = db.all('SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order, id', p.id);
  return {
    app: 'productivity-command-center',
    version: 1,
    exported_at: nowLocal(),
    settings: getSettings(),
    projects,
    tasks: hydrate(db.all(`${TASK_SELECT} ORDER BY t.id`)),
    collections: db.all('SELECT * FROM collections ORDER BY id'),
    resources: hydrateResources(db.all('SELECT * FROM resources ORDER BY id')),
  };
}

/** Merge an export into the current database. Rows already present (same identity + created_at) are skipped. */
export function importAll(data) {
  if (!data || typeof data !== 'object' || (data.tasks && !Array.isArray(data.tasks))) throw bad('Not a valid export file');
  const now = nowLocal();
  const counts = { projects: 0, milestones: 0, tasks: 0, subtasks: 0, collections: 0, resources: 0, skipped: 0 };
  db.tx(() => {
    const pmap = new Map();
    for (const p of data.projects || []) {
      if (!p?.name) continue;
      const dup = db.get('SELECT id FROM projects WHERE name = ? AND created_at = ?', String(p.name), p.created_at ?? '');
      if (dup) { pmap.set(p.id, dup.id); counts.skipped++; continue; }
      const r = db.run('INSERT INTO projects (name, description, start_date, target_date, status, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        String(p.name).slice(0, 200), String(p.description ?? ''), isDate(p.start_date) ? p.start_date : null, isDate(p.target_date) ? p.target_date : null,
        PROJECT_STATUSES.includes(p.status) ? p.status : 'Active', p.color ?? null, p.created_at ?? now, now);
      const id = Number(r.lastInsertRowid);
      pmap.set(p.id, id);
      counts.projects++;
      for (const [i, m] of (Array.isArray(p.milestones) ? p.milestones : []).entries()) {
        if (!m?.title) continue;
        db.run('INSERT INTO milestones (project_id, title, due_date, completed_at, sort_order) VALUES (?,?,?,?,?)', id, String(m.title).slice(0, 300), isDate(m.due_date) ? m.due_date : null, isDateTime(m.completed_at) ? m.completed_at : null, i);
        counts.milestones++;
      }
    }
    // Activity types referenced by imported tasks but unknown here are added (nothing is silently remapped).
    const types = getSettings().activity_types;
    const known = new Set(types.map((x) => x.name));
    const missing = [...new Set((data.tasks || []).map((t) => (typeof t?.category === 'string' ? t.category.trim().slice(0, 40) : '')).filter((c) => c && !known.has(c)))];
    if (missing.length) saveSettings({ activity_types: [...types, ...missing.map((name, i) => ({ id: `imp${Date.now().toString(36)}${i}`, name, color: '#8a8699' }))] });
    const tmap = new Map();
    for (const t of data.tasks || []) {
      if (!t?.title) continue;
      const dup = db.get('SELECT id FROM tasks WHERE title = ? AND created_at = ?', String(t.title), t.created_at ?? '');
      if (dup) { tmap.set(t.id, dup.id); counts.skipped++; continue; }
      let row;
      try {
        row = cleanTask({ ...t, project_id: pmap.get(t.project_id) ?? null }, { create: true });
      } catch (e) {
        throw bad(`Task "${String(t.title).slice(0, 60)}": ${e.message}`);
      }
      const subtasks = (Array.isArray(t.subtasks) ? t.subtasks : []).filter((s) => s?.title);
      const id = insertTask({
        ...row,
        notes: row.notes ?? '',
        priority: row.priority ?? 'Medium',
        category: row.category ?? 'Other',
        status: row.status ?? 'Not Started',
        links: row.links ?? '[]',
        notify_whatsapp: row.notify_whatsapp ?? 0,
        sort_order: Number.isInteger(t.sort_order) ? t.sort_order : 0,
        completed_at: isDateTime(t.completed_at) ? t.completed_at : row.status === 'Completed' ? now : null,
        created_at: t.created_at ?? now,
        updated_at: now,
      }, subtasks);
      tmap.set(t.id, id);
      counts.tasks++;
      counts.subtasks += subtasks.length;
    }
    const cmap = new Map();
    for (const c of data.collections || []) {
      if (!c?.name) continue;
      const existing = db.get('SELECT id FROM collections WHERE name = ? COLLATE NOCASE', String(c.name));
      if (existing) { cmap.set(c.id, existing.id); continue; }
      const r = db.run('INSERT INTO collections (name, description, created_at) VALUES (?,?,?)', String(c.name).slice(0, 120), String(c.description ?? ''), c.created_at ?? now);
      cmap.set(c.id, Number(r.lastInsertRowid));
      counts.collections++;
    }
    for (const r of data.resources || []) {
      if (!r?.url || !r?.title) continue;
      if (db.get('SELECT 1 FROM resources WHERE url = ?', String(r.url))) { counts.skipped++; continue; }
      const status = RESOURCE_STATUSES.includes(r.status) ? r.status : 'To Read';
      db.run(`INSERT INTO resources (title, url, description, category, tags, status, priority, thumbnail, site_name, collection_id, task_id, project_id, completed_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      String(r.title).slice(0, 500), String(r.url).slice(0, 2000), String(r.description ?? ''), RESOURCE_CATEGORIES.includes(r.category) ? r.category : 'Website',
      JSON.stringify(Array.isArray(r.tags) ? r.tags.map(String) : []), status, ['Critical', 'High', 'Medium', 'Low'].includes(r.priority) ? r.priority : 'Medium',
      r.thumbnail ?? null, r.site_name ?? null, cmap.get(r.collection_id) ?? null, tmap.get(r.task_id) ?? null, pmap.get(r.project_id) ?? null,
      isDateTime(r.completed_at) ? r.completed_at : status === 'Completed' ? now : null, r.created_at ?? now, now);
      counts.resources++;
    }
    if (data.settings && typeof data.settings === 'object' && data.import_settings) {
      try { saveSettings(validateSettings(data.settings)); } catch { /* ignore invalid settings in old exports */ }
    }
  });
  return counts;
}

const csv = (rows, cols) => '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => {
  const v = r[c] ?? '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(','))].join('\r\n');

// ---------- routes ----------
const r = Router();

r.get('/export.json', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="task-tracker-export-${today()}.json"`);
  res.json(exportAll());
});

r.get('/export/tasks.csv', (req, res) => {
  const rows = hydrate(db.all(`${TASK_SELECT} ORDER BY t.id`)).map((t) => ({ ...t, project: t.project_name, subtasks: t.subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join(' | '), links: t.links.map((l) => l.url).join(' | ') }));
  res.setHeader('Content-Disposition', `attachment; filename="tasks-${today()}.csv"`);
  res.type('text/csv').send(csv(rows, ['id', 'title', 'notes', 'scheduled_date', 'start_time', 'due_at', 'priority', 'category', 'status', 'project', 'subtasks', 'links', 'completed_at', 'created_at']));
});

r.get('/export/resources.csv', (req, res) => {
  const rows = hydrateResources(db.all('SELECT r.*, c.name AS collection FROM resources r LEFT JOIN collections c ON c.id = r.collection_id ORDER BY r.id')).map((x) => ({ ...x, tags: x.tags.join(' | ') }));
  res.setHeader('Content-Disposition', `attachment; filename="resources-${today()}.csv"`);
  res.type('text/csv').send(csv(rows, ['id', 'title', 'url', 'description', 'category', 'tags', 'status', 'priority', 'collection', 'completed_at', 'created_at']));
});

r.post('/import', (req, res) => res.json(importAll(req.body)));

r.get('/backups', (req, res) => res.json(listBackups()));
r.post('/backups', (req, res) => res.status(201).json({ name: createBackup('backup'), backups: listBackups() }));
r.get('/backups/:name', (req, res) => {
  const p = safeName(req.params.name);
  if (!fs.existsSync(p)) throw bad('Backup not found', 404);
  res.download(p);
});
r.delete('/backups/:name', (req, res) => {
  fs.rmSync(safeName(req.params.name), { force: true });
  res.json(listBackups());
});

// Restore from a named backup ({ name }) or an uploaded .db file (raw application/octet-stream body).
r.post('/restore', express.raw({ type: 'application/octet-stream', limit: '2gb' }), (req, res) => {
  let src;
  if (Buffer.isBuffer(req.body) && req.body.length) {
    src = path.join(BACKUP_DIR, `upload-${stamp()}.db`);
    fs.writeFileSync(src, req.body);
  } else if (req.body?.name) {
    src = safeName(req.body.name);
    if (!fs.existsSync(src)) throw bad('Backup not found', 404);
  } else throw bad('Provide a backup name or upload a .db file');
  res.json({ ok: true, safety_backup: restoreFrom(src) });
});

export default r;
