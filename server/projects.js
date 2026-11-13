import { Router } from 'express';
import { db, bad, text, oneOf, idParam } from './db.js';
import { nowLocal, isDate } from './time.js';
import { TASK_SELECT, TASK_ORDER, hydrate } from './tasks.js';
import { RESOURCE_SELECT, hydrateResources } from './resources.js';

export const PROJECT_STATUSES = ['Active', 'On Hold', 'Completed', 'Archived'];

/** Add milestones + task counts + progress % to a project row. */
export function summarize(p) {
  const c = db.get("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'Completed'), 0) AS done FROM tasks WHERE project_id = ?", p.id);
  p.milestones = db.all('SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date IS NULL, due_date, sort_order, id', p.id);
  const mdone = p.milestones.filter((m) => m.completed_at).length;
  const total = c.total + p.milestones.length;
  p.task_total = c.total;
  p.task_done = c.done;
  p.progress = total ? Math.round(((c.done + mdone) / total) * 100) : p.status === 'Completed' ? 100 : 0;
  p.next_due = db.get("SELECT MIN(COALESCE(due_at, scheduled_date)) AS d FROM tasks WHERE project_id = ? AND status != 'Completed'", p.id).d;
  return p;
}

function clean(body, create = false) {
  if (!body || typeof body !== 'object') throw bad('Request body must be a JSON object');
  const out = {};
  if (create || 'name' in body) {
    const name = text(body.name, 200, 'Project name').trim();
    if (!name) throw bad('Project name is required');
    out.name = name;
  }
  if ('description' in body) out.description = text(body.description, 20000, 'Description');
  for (const f of ['start_date', 'target_date']) {
    if (f in body) {
      if (body[f] && !isDate(body[f])) throw bad(`${f} must be YYYY-MM-DD`);
      out[f] = body[f] || null;
    }
  }
  if ('status' in body) out.status = oneOf(body.status, PROJECT_STATUSES, 'Status');
  if ('color' in body) out.color = body.color && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
  return out;
}

const getProject = (id) => db.get('SELECT * FROM projects WHERE id = ?', id);

const r = Router();

r.get('/', (req, res) => {
  res.json(db.all("SELECT * FROM projects ORDER BY (status = 'Archived'), (status = 'Completed'), target_date IS NULL, target_date, id").map(summarize));
});

r.post('/', (req, res) => {
  const p = clean(req.body, true);
  const now = nowLocal();
  const result = db.run('INSERT INTO projects (name, description, start_date, target_date, status, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    p.name, p.description ?? '', p.start_date ?? null, p.target_date ?? null, p.status ?? 'Active', p.color ?? null, now, now);
  res.status(201).json(summarize(getProject(Number(result.lastInsertRowid))));
});

r.get('/:id', (req, res) => {
  const p = getProject(idParam(req.params.id));
  if (!p) throw bad('Project not found', 404);
  summarize(p);
  p.tasks = hydrate(db.all(`${TASK_SELECT} WHERE t.project_id = ? ${TASK_ORDER}`, p.id));
  p.resources = hydrateResources(db.all(`${RESOURCE_SELECT} WHERE r.project_id = ? ORDER BY r.id DESC`, p.id));
  res.json(p);
});

r.patch('/:id', (req, res) => {
  const id = idParam(req.params.id);
  if (!getProject(id)) throw bad('Project not found', 404);
  const p = clean(req.body);
  const keys = Object.keys(p);
  if (keys.length) db.run(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => p[k]), nowLocal(), id);
  res.json(summarize(getProject(id)));
});

r.delete('/:id', (req, res) => {
  if (!db.run('DELETE FROM projects WHERE id = ?', idParam(req.params.id)).changes) throw bad('Project not found', 404);
  res.json({ ok: true }); // tasks keep existing with project_id = NULL (FK ON DELETE SET NULL)
});

// ---- milestones ----
r.post('/:id/milestones', (req, res) => {
  const id = idParam(req.params.id);
  if (!getProject(id)) throw bad('Project not found', 404);
  const title = text(req.body?.title, 300, 'Milestone title').trim();
  if (!title) throw bad('Milestone title is required');
  const due = req.body?.due_date || null;
  if (due && !isDate(due)) throw bad('due_date must be YYYY-MM-DD');
  const n = db.get('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM milestones WHERE project_id = ?', id).n;
  db.run('INSERT INTO milestones (project_id, title, due_date, sort_order) VALUES (?,?,?,?)', id, title, due, n);
  res.status(201).json(summarize(getProject(id)));
});

r.patch('/:id/milestones/:mid', (req, res) => {
  const id = idParam(req.params.id);
  const m = db.get('SELECT * FROM milestones WHERE id = ? AND project_id = ?', idParam(req.params.mid), id);
  if (!m) throw bad('Milestone not found', 404);
  const b = req.body || {};
  const title = 'title' in b ? text(b.title, 300, 'Milestone title').trim() : m.title;
  if (!title) throw bad('Milestone title is required');
  let due = m.due_date;
  if ('due_date' in b) {
    if (b.due_date && !isDate(b.due_date)) throw bad('due_date must be YYYY-MM-DD');
    due = b.due_date || null;
  }
  const completed_at = 'completed' in b ? (b.completed ? m.completed_at || nowLocal() : null) : m.completed_at;
  db.run('UPDATE milestones SET title = ?, due_date = ?, completed_at = ? WHERE id = ?', title, due, completed_at, m.id);
  res.json(summarize(getProject(id)));
});

r.delete('/:id/milestones/:mid', (req, res) => {
  const id = idParam(req.params.id);
  if (!db.run('DELETE FROM milestones WHERE id = ? AND project_id = ?', idParam(req.params.mid), id).changes) throw bad('Milestone not found', 404);
  res.json(summarize(getProject(id)));
});

export default r;
