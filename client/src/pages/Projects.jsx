import { useState } from 'react';
import { useApp, useData, useMutate, navigate } from '../store.jsx';
import { api } from '../api.js';
import { Icon, Modal, Field, Select, Empty, Confirm, PROJECT_STATUSES, PROJECT_COLORS } from '../components/ui.jsx';
import TaskList from '../components/TaskList.jsx';
import QuickAdd from '../components/QuickAdd.jsx';
import { relDate, fmtShort, daysBetween } from '../lib/dates.js';

const statusChip = (s) => ({ Active: 'accent', 'On Hold': 'soon', Completed: 'success', Archived: '' }[s] || '');

function ProjectEditor({ project, onClose }) {
  const mutate = useMutate();
  const [f, setF] = useState(project || { name: '', description: '', start_date: '', target_date: '', status: 'Active', color: PROJECT_COLORS[0] });
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    const body = { name: f.name, description: f.description, start_date: f.start_date || null, target_date: f.target_date || null, status: f.status, color: f.color };
    const r = await mutate(() => (project ? api.projects.update(project.id, body) : api.projects.create(body)), project ? 'Project saved' : 'Project created');
    if (r) { onClose(); if (!project) navigate(`/projects/${r.id}`); }
  };
  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose} footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!f.name.trim()}>{project ? 'Save' : 'Create project'}</button></>}>
      <Field label="Name"><input className="input lg" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Thesis: multimodal agents" autoFocus onKeyDown={(e) => e.key === 'Enter' && f.name.trim() && save()} /></Field>
      <Field label="Description"><textarea className="input" value={f.description || ''} onChange={(e) => set({ description: e.target.value })} rows={3} placeholder="Goal, scope, definition of done…" /></Field>
      <div className="grid grid-3">
        <Field label="Start date"><input type="date" className="input" value={f.start_date || ''} onChange={(e) => set({ start_date: e.target.value })} /></Field>
        <Field label="Target completion"><input type="date" className="input" value={f.target_date || ''} onChange={(e) => set({ target_date: e.target.value })} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(v) => set({ status: v })} options={PROJECT_STATUSES} /></Field>
      </div>
      <Field label="Color"><div className="color-row">{PROJECT_COLORS.map((c) => <button key={c} type="button" className={f.color === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Color ${c}`} />)}</div></Field>
    </Modal>
  );
}

export default function Projects() {
  const { today } = useApp();
  const { data, loading, error } = useData(api.projects.list);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const td = today();
  const list = (data || []).filter((p) => showArchived || p.status !== 'Archived');
  return (
    <>
      <div className="page-head">
        <div><h1>Projects</h1><div className="sub">Long-term goals, broken into milestones and tasks.</div></div>
        <div className="actions">
          <label className="checkline small muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      {!data ? <div className="loading">Loading…</div> : !list.length ? <div className="card"><Empty icon="projects" title="No projects yet" hint="Create one for a thesis, an exam, a course or an app you're building." /></div> : (
        <div className={`grid grid-3 ${loading ? 'fade' : ''}`}>
          {list.map((p) => {
            const left = p.target_date ? daysBetween(td, p.target_date) : null;
            return (
              <div key={p.id} className="card project-card" onClick={() => navigate(`/projects/${p.id}`)}>
                <div className="row between top">
                  <h3><i className="swatch" style={{ background: p.color || 'var(--accent)' }} />{p.name}</h3>
                  <span className={`chip ${statusChip(p.status)}`}>{p.status}</span>
                </div>
                {p.description && <p className="desc">{p.description}</p>}
                <div className="meter"><i style={{ width: `${p.progress}%` }} /></div>
                <div className="foot">
                  <span>{p.progress}% · {p.task_done}/{p.task_total} tasks · {p.milestones.filter((m) => m.completed_at).length}/{p.milestones.length} milestones</span>
                  {p.target_date && p.status !== 'Completed' && <span className={left < 0 ? 'prio-Critical' : ''}>{left < 0 ? `${-left}d overdue` : left === 0 ? 'Due today' : `${left}d left`}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {creating && <ProjectEditor onClose={() => setCreating(false)} />}
    </>
  );
}

export function ProjectDetail({ id }) {
  const { today } = useApp();
  const mutate = useMutate();
  const { data: p, loading, error } = useData(() => api.projects.get(id), [id]);
  const [editing, setEditing] = useState(false);
  const [msTitle, setMsTitle] = useState('');
  const [msDate, setMsDate] = useState('');
  const td = today();
  if (error) return <div className="error-box">{error} <a href="#/projects">Back to projects</a></div>;
  if (!p) return <div className="loading">Loading…</div>;
  const addMilestone = async () => { if (!msTitle.trim()) return; const r = await mutate(() => api.projects.addMilestone(p.id, { title: msTitle.trim(), due_date: msDate || null }), 'Milestone added'); if (r) { setMsTitle(''); setMsDate(''); } };
  const openTasks = p.tasks.filter((t) => t.status !== 'Completed');

  return (
    <div className={loading ? 'fade' : ''}>
      <a href="#/projects" className="small muted row" style={{ gap: 4, marginBottom: 10 }}><Icon name="left" />All projects</a>
      <div className="page-head">
        <div>
          <h1 className="row"><i className="swatch" style={{ background: p.color || 'var(--accent)', width: 14, height: 14 }} />{p.name}</h1>
          <div className="sub row wrap" style={{ gap: 8 }}>
            {p.start_date && <span>Started {fmtShort(p.start_date)}</span>}
            {p.target_date && <span>· Target {fmtShort(p.target_date)}{p.status !== 'Completed' && (() => { const n = daysBetween(td, p.target_date); return ` (${n < 0 ? `${-n} days overdue` : n === 0 ? 'today' : `in ${n} days`})`; })()}</span>}
          </div>
          {p.description && <p style={{ marginTop: 8, color: 'var(--text-2)', maxWidth: 720, whiteSpace: 'pre-wrap' }}>{p.description}</p>}
        </div>
        <div className="actions">
          <Select className="auto" value={p.status} onChange={(v) => mutate(() => api.projects.update(p.id, { status: v }), `Marked ${v}`)} options={PROJECT_STATUSES} />
          <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" />Edit</button>
          <Confirm className="btn btn-danger" label="Delete project?" onConfirm={async () => { const r = await mutate(() => api.projects.remove(p.id), 'Project deleted (tasks were kept)'); if (r) navigate('/projects'); }}><Icon name="trash" /></Confirm>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 8 }}><b>Progress</b><span className="muted">{p.progress}% · {p.task_done}/{p.task_total} tasks · {p.milestones.filter((m) => m.completed_at).length}/{p.milestones.length} milestones</span></div>
        <div className="meter"><i style={{ width: `${p.progress}%` }} /></div>
      </div>

      <div className="dash">
        <section className="card">
          <div className="card-head"><h2>Tasks <span className="count">{openTasks.length} open</span></h2></div>
          <QuickAdd defaults={{ project_id: p.id }} placeholder="Add a task to this project…" />
          <TaskList tasks={p.tasks} onReorder={(ids) => mutate(() => api.tasks.reorder(ids))} emptyText="No tasks yet" emptyHint="Break the project into concrete next actions." />
        </section>
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2><Icon name="diamond" />Milestones</h2></div>
            {p.milestones.map((m) => (
              <div key={m.id} className={`milestone ${m.completed_at ? 'done' : ''}`}>
                <button type="button" className={`check ${m.completed_at ? 'on' : ''}`} style={{ marginTop: 0 }} onClick={() => mutate(() => api.projects.updateMilestone(p.id, m.id, { completed: !m.completed_at }))} aria-label="Toggle milestone"><Icon name="check" /></button>
                <span className="t">{m.title}</span>
                {m.due_date && <span className={`d ${!m.completed_at && m.due_date < td ? 'late' : ''}`}>{relDate(m.due_date, td)}</span>}
                <button className="icon-btn sm danger" onClick={() => mutate(() => api.projects.removeMilestone(p.id, m.id), 'Milestone removed')} aria-label="Remove milestone"><Icon name="x" /></button>
              </div>
            ))}
            <div className="row" style={{ marginTop: 8 }}>
              <input className="input sm grow" placeholder="New milestone…" value={msTitle} onChange={(e) => setMsTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMilestone()} aria-label="Milestone title" />
              <input type="date" className="input sm" style={{ width: 150 }} value={msDate} onChange={(e) => setMsDate(e.target.value)} aria-label="Milestone date" />
              <button className="btn btn-sm" onClick={addMilestone} disabled={!msTitle.trim()}>Add</button>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><h2><Icon name="resources" />Linked resources</h2><a href="#/resources" className="small">Library</a></div>
            {p.resources.length ? p.resources.map((r) => (
              <a key={r.id} className="res-mini" href={r.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                <div className="thumb">{r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : <Icon name="globe" />}</div>
                <div className="grow"><div className="t">{r.title}</div><div className="s">{r.status} · {r.category}</div></div>
              </a>
            )) : <span className="muted small">Link a resource to this project from the Resource Library.</span>}
          </section>
        </div>
      </div>
      {editing && <ProjectEditor project={p} onClose={() => setEditing(false)} />}
    </div>
  );
}
