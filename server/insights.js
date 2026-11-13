// Read-only aggregations: dashboard, productivity insights, calendar.
import { Router } from 'express';
import { db, getSettings, bad } from './db.js';
import { nowLocal, today, addDays, addMonths, weekStart, isDate } from './time.js';
import { TASK_SELECT, TASK_DATE, TASK_ORDER, OVERDUE, hydrate } from './tasks.js';
import { RESOURCE_SELECT, hydrateResources } from './resources.js';

const count = (sql, ...p) => db.get(sql, ...p).n;

/** Consecutive days (ending today or yesterday) with at least one completed task. */
export function streak(td) {
  const days = new Set(db.all('SELECT DISTINCT substr(completed_at, 1, 10) AS d FROM tasks WHERE completed_at IS NOT NULL').map((r) => r.d));
  let n = 0;
  let d = days.has(td) ? td : addDays(td, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

const r = Router();

r.get('/dashboard', (req, res) => {
  const s = getSettings();
  const td = today();
  const now = nowLocal();
  const ws = weekStart(td);
  const tasks_today = hydrate(db.all(`${TASK_SELECT} WHERE ${TASK_DATE} = ? ${TASK_ORDER}`, td));
  res.json({
    today: td,
    now,
    display_name: s.display_name,
    tasks_today,
    overdue: hydrate(db.all(`${TASK_SELECT} WHERE ${OVERDUE} AND ${TASK_DATE} < ? ${TASK_ORDER}`, now, td)),
    upcoming: hydrate(db.all(`${TASK_SELECT} WHERE t.status != 'Completed' AND ${TASK_DATE} > ? AND ${TASK_DATE} <= ? ${TASK_ORDER} LIMIT 12`, td, addDays(td, 7))),
    recent_resources: hydrateResources(db.all(`${RESOURCE_SELECT} ORDER BY r.id DESC LIMIT 6`)),
    streak: streak(td),
    week: { done: count('SELECT COUNT(*) AS n FROM tasks WHERE completed_at >= ? AND completed_at < ?', ws, addDays(ws, 7)), goal: s.weekly_goal, start: ws, end: addDays(ws, 6) },
  });
});

r.get('/insights', (req, res) => {
  const s = getSettings();
  const td = today();
  const now = nowLocal();
  const ws = weekStart(td);
  const ms = `${td.slice(0, 8)}01`;
  const rate = (from, toEx) => {
    const x = db.get(`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'Completed'), 0) AS done FROM tasks t WHERE ${TASK_DATE} >= ? AND ${TASK_DATE} < ?`, from, toEx);
    return { total: x.total, done: x.done, rate: x.total ? Math.round((x.done / x.total) * 100) : null };
  };
  const since = addDays(td, -29);
  const perDay = new Map(db.all('SELECT substr(completed_at, 1, 10) AS d, COUNT(*) AS n FROM tasks WHERE completed_at >= ? GROUP BY d', since).map((x) => [x.d, x.n]));
  const by_day = [];
  for (let i = 29; i >= 0; i--) { const d = addDays(td, -i); by_day.push({ date: d, done: perDay.get(d) || 0 }); }
  res.json({
    today: td,
    done_today: count('SELECT COUNT(*) AS n FROM tasks WHERE completed_at >= ? AND completed_at < ?', td, addDays(td, 1)),
    remaining_today: count(`SELECT COUNT(*) AS n FROM tasks t WHERE t.status != 'Completed' AND ${TASK_DATE} = ?`, td),
    overdue: count(`SELECT COUNT(*) AS n FROM tasks t WHERE ${OVERDUE}`, now),
    week: { ...rate(ws, addDays(ws, 7)), start: ws, end: addDays(ws, 6) },
    month: { ...rate(ms, addMonths(ms, 1)), start: ms },
    weekly_goal: { done: count('SELECT COUNT(*) AS n FROM tasks WHERE completed_at >= ? AND completed_at < ?', ws, addDays(ws, 7)), goal: s.weekly_goal },
    by_day,
    by_category: db.all(`SELECT category, COALESCE(SUM(status = 'Completed' AND completed_at >= ?), 0) AS done, COALESCE(SUM(status != 'Completed'), 0) AS open_count
      FROM tasks GROUP BY category ORDER BY category`, since),
    by_priority: db.all("SELECT priority, COUNT(*) AS open_count FROM tasks WHERE status != 'Completed' GROUP BY priority"),
    upcoming: hydrate(db.all(`${TASK_SELECT} WHERE t.status != 'Completed' AND t.due_at >= ? AND t.due_at < ? ORDER BY t.due_at LIMIT 10`, now, addDays(td, 8))),
    streak: streak(td),
    total_completed: count("SELECT COUNT(*) AS n FROM tasks WHERE status = 'Completed'"),
    total_open: count("SELECT COUNT(*) AS n FROM tasks WHERE status != 'Completed'"),
    completed_30d: count('SELECT COUNT(*) AS n FROM tasks WHERE completed_at >= ?', since),
  });
});

r.get('/calendar', (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) throw bad('from and to (YYYY-MM-DD) are required');
  res.json({
    tasks: hydrate(db.all(`${TASK_SELECT} WHERE ${TASK_DATE} >= ? AND ${TASK_DATE} <= ? ${TASK_ORDER}`, from, to)),
    // deadlines falling on a different day than the task's scheduled day
    deadlines: hydrate(db.all(`${TASK_SELECT} WHERE t.due_at IS NOT NULL AND t.scheduled_date IS NOT NULL AND substr(t.due_at, 1, 10) != t.scheduled_date
      AND substr(t.due_at, 1, 10) >= ? AND substr(t.due_at, 1, 10) <= ? ORDER BY t.due_at`, from, to)),
    milestones: db.all(`SELECT m.*, p.name AS project_name, p.color AS project_color FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.due_date >= ? AND m.due_date <= ? AND p.status != 'Archived' ORDER BY m.due_date`, from, to),
    projects: db.all("SELECT id, name, color, target_date, status FROM projects WHERE target_date >= ? AND target_date <= ? AND status != 'Archived'", from, to),
  });
});

export default r;
