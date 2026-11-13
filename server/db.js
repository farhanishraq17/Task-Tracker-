import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const FILES_DIR = path.join(DATA_DIR, 'files');
for (const d of [DATA_DIR, BACKUP_DIR, FILES_DIR]) fs.mkdirSync(d, { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  scheduled_date TEXT,
  start_time TEXT,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'Medium',
  category TEXT NOT NULL DEFAULT 'Other',
  status TEXT NOT NULL DEFAULT 'Not Started',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  recurrence TEXT,
  reminders TEXT,
  schedules TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  notify_whatsapp INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_sched ON tasks(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Website',
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'To Read',
  priority TEXT NOT NULL DEFAULT 'Medium',
  thumbnail TEXT,
  site_name TEXT,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL,
  reminder_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  title TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, reminder_key, channel)
);
`;

function open() {
  const c = new DatabaseSync(DB_PATH);
  c.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  c.exec(SCHEMA);
  // Migrations for databases created by earlier versions.
  const taskCols = c.prepare('PRAGMA table_info(tasks)').all().map((r) => r.name);
  if (!taskCols.includes('schedules')) c.exec('ALTER TABLE tasks ADD COLUMN schedules TEXT');
  return c;
}

let conn = open();

// node:sqlite refuses undefined/boolean bindings; normalise them.
const bind = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

let txDepth = 0;
export const db = {
  all: (sql, ...p) => conn.prepare(sql).all(...bind(p)),
  get: (sql, ...p) => conn.prepare(sql).get(...bind(p)),
  run: (sql, ...p) => conn.prepare(sql).run(...bind(p)),
  exec: (sql) => conn.exec(sql),
  /** Run fn inside a transaction. Nested calls join the outer transaction. */
  tx(fn) {
    if (txDepth > 0) return fn();
    txDepth++;
    conn.exec('BEGIN');
    try { const r = fn(); conn.exec('COMMIT'); return r; } catch (e) { conn.exec('ROLLBACK'); throw e; } finally { txDepth--; }
  },
  /** Consistent snapshot copy of the live database (SQLite VACUUM INTO). */
  backup(dest) { conn.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); },
  close() { conn.close(); },
  reopen() { conn = open(); },
};

const deviceTimezone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dhaka'; } catch { return 'Asia/Dhaka'; } })();

/** Activity types are user-defined (name + color) and edited in Settings; tasks store the type name. */
export const DEFAULT_ACTIVITY_TYPES = [
  { id: 'academics', name: 'Academics', color: '#2a78d6' },
  { id: 'research', name: 'Research', color: '#5b4bd6' },
  { id: 'projects', name: 'Projects', color: '#1baf7a' },
  { id: 'personal', name: 'Personal', color: '#ff7a52' },
  { id: 'learning', name: 'Learning', color: '#eda100' },
  { id: 'other', name: 'Other', color: '#8a8699' },
];

export const DEFAULT_SETTINGS = {
  display_name: 'Ishraq', // greeting name; change it in Settings
  timezone: deviceTimezone, // follows this PC's clock unless changed in Settings
  activity_types: DEFAULT_ACTIVITY_TYPES,
  default_priority: 'Medium',
  default_due_time: '18:00',
  default_reminders: [1440, 180, 30, 0], // minutes before deadline; 0 = at deadline; negative = after
  channels: { browser: true, desktop: true, email: false, whatsapp: false },
  whatsapp_min_priority: 'High', // new tasks at/above this priority get WhatsApp reminders by default
  theme: 'system',
  weekly_goal: 25,
  digest_time: '08:00', // '' disables the morning digest
  auto_backup: true,
};

export function getSettings() {
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const row of db.all('SELECT key, value FROM settings')) {
    try { s[row.key] = JSON.parse(row.value); } catch { /* corrupt value: keep default */ }
  }
  return s;
}

export function saveSettings(patch) {
  db.tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
    }
  });
  return getSettings();
}

export const activityTypes = () => {
  const list = getSettings().activity_types;
  return Array.isArray(list) && list.length ? list : DEFAULT_ACTIVITY_TYPES;
};
/** The type new tasks get when none is given: "Other" if it exists, else the first type. */
export const defaultCategory = () => { const t = activityTypes(); return (t.find((x) => x.name === 'Other') || t[0]).name; };

// ---- shared validation helpers (throw -> JSON 4xx via the error handler in index.js) ----
export const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export const text = (v, max, name) => {
  if (v == null) return '';
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  if (v.length > max) throw bad(`${name} is too long (max ${max} characters)`);
  return v;
};

export const oneOf = (v, list, name) => {
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
};

export const idParam = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1) throw bad('Invalid id', 404);
  return id;
};

export const parseJson = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
