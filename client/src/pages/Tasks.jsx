import { useEffect, useMemo, useState } from 'react';
import { useApp, useData, useHash, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { Icon, Select, Empty, PRIORITIES } from '../components/ui.jsx';
import TaskList from '../components/TaskList.jsx';
import QuickAdd from '../components/QuickAdd.jsx';
import { monthStart, monthEnd, relDate } from '../lib/dates.js';

const TABS = [['today', 'Today'], ['upcoming', 'Next 7 days'], ['month', 'This month'], ['overdue', 'Overdue'], ['unscheduled', 'No date'], ['completed', 'Completed'], ['all', 'All']];

function groupTasks(tasks, tab, td) {
  const groups = new Map();
  const push = (key, label, t, extra = {}) => { if (!groups.has(key)) groups.set(key, { key, label, tasks: [], ...extra }); groups.get(key).tasks.push(t); };
  for (const t of tasks) {
    if (tab === 'completed') { const d = t.completed_at?.slice(0, 10) || 'none'; push(d, d === 'none' ? 'Earlier' : relDate(d, td), t); continue; }
    const d = t.scheduled_date || t.due_at?.slice(0, 10);
    if (!d) push('zz-none', 'No date', t);
    else if (d < td && t.status !== 'Completed') push('00-overdue', 'Overdue', t, { overdue: true });
    else push(d, relDate(d, td), t);
  }
  const arr = [...groups.values()];
  return tab === 'completed' ? arr.sort((a, b) => b.key.localeCompare(a.key)) : arr.sort((a, b) => a.key.localeCompare(b.key));
}

export default function Tasks() {
  const { today, newTask, types } = useApp();
  const { params } = useHash();
  const [tab, setTab] = useState(params.tab || 'today');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [project, setProject] = useState('');
  const [more, setMore] = useState(false);
  const [projects, setProjects] = useState([]);
  const mutate = useMutate();
  const td = today();
  useEffect(() => { api.projects.list().then(setProjects).catch(() => {}); }, []);
  useEffect(() => { if (params.tab) setTab(params.tab); }, [params.tab]);

  const query = useMemo(() => {
    const base = { today: { view: 'today' }, upcoming: { view: 'upcoming' }, month: { from: monthStart(td), to: monthEnd(td) }, overdue: { view: 'overdue' }, unscheduled: { view: 'unscheduled' }, completed: { view: 'completed', limit: 400 }, all: {} }[tab] || {};
    return { ...base, q: q.trim(), priority, category, project_id: project };
  }, [tab, q, priority, category, project, td]);
  const key = JSON.stringify(query);
  const { data, loading, error } = useData(() => api.tasks.list(query), [key]);
  const groups = useMemo(() => groupTasks(data || [], tab, td), [data, tab, td]);
  const openCount = data ? data.filter((t) => t.status !== 'Completed').length : 0;
  const filtered = q || priority || category || project;

  return (
    <>
      <div className="page-head">
        <div><div className="lbl">Tasks</div><h1>My Tasks</h1><div className="sub">{data ? `${openCount} open in this view` : ' '}</div></div>
        <div className="actions"><button className="btn btn-primary" onClick={() => newTask(tab === 'today' ? { scheduled_date: td } : {})}><Icon name="plus" />New task</button></div>
      </div>
      <QuickAdd defaults={tab === 'today' ? { scheduled_date: td } : {}} />
      <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="filters">
        <div className="search grow" style={{ maxWidth: 300 }}><Icon name="search" /><input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" /></div>
        <Select className="auto" value={category} onChange={setCategory} options={types.map((t) => t.name)} placeholder="Any type" />
        {more && <Select className="auto" value={priority} onChange={setPriority} options={PRIORITIES} placeholder="Any priority" />}
        {more && <Select className="auto" value={project} onChange={setProject} options={projects.map((p) => [p.id, p.name])} placeholder="Any project" />}
        <button className="btn btn-ghost btn-sm" onClick={() => setMore((m) => !m)}>{more ? 'Fewer filters' : 'More filters'}</button>
        {filtered && <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setPriority(''); setCategory(''); setProject(''); }}>Clear</button>}
      </div>
      <div className={`card ${loading && data ? 'fade' : ''}`}>
        {error && <div className="error-box">{error}</div>}
        {!data ? <div className="loading">Loading…</div>
          : !data.length ? <Empty title={tab === 'overdue' ? 'Nothing overdue' : tab === 'completed' ? 'No completed tasks yet' : 'No tasks here'} hint={tab === 'today' ? 'Add one above — try “Read chapter 3 by 6pm”.' : tab === 'overdue' ? 'You are on top of everything.' : undefined} icon={tab === 'overdue' ? 'sparkle' : 'inbox'} />
            : groups.map((g) => (
              <div key={g.key}>
                <div className={`group-head ${g.overdue ? 'overdue' : ''}`}>{g.label}<span className="count">{g.tasks.length}</span></div>
                <TaskList tasks={g.tasks} onReorder={(ids) => mutate(() => api.tasks.reorder(ids))} showDate={g.overdue || tab === 'all' || tab === 'unscheduled'} />
              </div>
            ))}
      </div>
    </>
  );
}
