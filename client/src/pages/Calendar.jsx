import { useMemo, useState } from 'react';
import { useApp, useData, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { Icon, Segmented, Empty } from '../components/ui.jsx';
import TaskList from '../components/TaskList.jsx';
import QuickAdd from '../components/QuickAdd.jsx';
import { moveTo } from '../components/TaskItem.jsx';
import { addDays, addMonths, weekStart, monthGrid, fmtMonth, fmtLong, fmtShort, fmtDay, weekdayShort, fmtTime } from '../lib/dates.js';

const HEAVY = 5; // open tasks on one day that flag it as overloaded

export default function Calendar() {
  const { today, openTask, types, typeColor } = useApp();
  const mutate = useMutate();
  const td = today();
  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(td);
  const [dragId, setDragId] = useState(null);
  const [dropDay, setDropDay] = useState(null);

  const range = useMemo(() => {
    if (view === 'month') { const g = monthGrid(anchor); return { from: g[0], to: g[41], days: g }; }
    if (view === 'week') { const s = weekStart(anchor); return { from: s, to: addDays(s, 6), days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) }; }
    return { from: anchor, to: anchor, days: [anchor] };
  }, [view, anchor]);
  const { data, loading } = useData(() => api.calendar(range.from, range.to), [range.from, range.to]);

  const byDay = useMemo(() => {
    const m = new Map();
    const add = (d, kind, v) => { if (!m.has(d)) m.set(d, { tasks: [], deadlines: [], milestones: [], projects: [] }); m.get(d)[kind].push(v); };
    for (const t of data?.tasks || []) add(t.scheduled_date || t.due_at.slice(0, 10), 'tasks', t);
    for (const t of data?.deadlines || []) add(t.due_at.slice(0, 10), 'deadlines', t);
    for (const ms of data?.milestones || []) add(ms.due_date, 'milestones', ms);
    for (const p of data?.projects || []) add(p.target_date, 'projects', p);
    return m;
  }, [data]);
  const get = (d) => byDay.get(d) || { tasks: [], deadlines: [], milestones: [], projects: [] };

  const step = (n) => setAnchor(view === 'month' ? addMonths(anchor, n) : addDays(anchor, view === 'week' ? 7 * n : n));
  const title = view === 'month' ? fmtMonth(anchor) : view === 'week' ? `${fmtDay(range.from)} – ${fmtShort(range.to)}` : fmtLong(anchor);

  const dragProps = (t) => ({
    draggable: true,
    onDragStart: (e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); },
    onDragEnd: () => { setDragId(null); setDropDay(null); },
  });
  const dropProps = (d) => ({
    onDragOver: (e) => { if (dragId != null) { e.preventDefault(); if (dropDay !== d) setDropDay(d); } },
    onDragLeave: () => { if (dropDay === d) setDropDay(null); },
    onDrop: (e) => {
      e.preventDefault();
      const id = Number(e.dataTransfer.getData('text/plain')) || dragId;
      const t = [...(data?.tasks || []), ...(data?.deadlines || [])].find((x) => x.id === id);
      setDragId(null); setDropDay(null);
      if (!t || (t.scheduled_date || t.due_at?.slice(0, 10)) === d) return;
      mutate(() => api.tasks.update(t.id, moveTo(t, d)), `Moved to ${fmtShort(d)}`);
    },
  });

  const Pill = ({ t, deadline, time }) => (
    <div className={`pill ${t.status === 'Completed' ? 'done' : ''} ${deadline ? 'deadline' : ''} ${dragId === t.id ? 'dragging' : ''}`} style={{ '--type': typeColor(t.category) }}
      title={`${t.title} · ${t.category}${t.due_at ? ` · due ${fmtTime(t.due_at.slice(11))}` : ''}`} onClick={(e) => { e.stopPropagation(); openTask(t.id); }} {...dragProps(t)}>
      {deadline && <Icon name="flag" />}
      {time && t.due_at && <span className="pill-time">{fmtTime(t.due_at.slice(11))}</span>}
      <span>{t.title}</span>
    </div>
  );
  const Milestone = ({ m }) => <div className="pill milestone" title={`${m.project_name} · milestone`}><Icon name="diamond" /><span>{m.title}</span></div>;
  const ProjectDue = ({ p }) => <a className="pill project" href={`#/projects/${p.id}`} title="Project target date" onClick={(e) => e.stopPropagation()}><Icon name="target" /><span>{p.name} due</span></a>;

  return (
    <>
      <div className="page-head">
        <div><div className="lbl">Calendar</div><h1>{title}</h1><div className="sub">Drag a task onto another day to reschedule it.</div></div>
        <div className="actions">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous"><Icon name="left" /></button>
          <button className="btn btn-sm" onClick={() => setAnchor(td)}>Today</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next"><Icon name="right" /></button>
          <Segmented value={view} onChange={setView} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month']]} />
        </div>
      </div>
      <div className="legend" style={{ marginBottom: 14 }}>
        {types.map((t) => <span key={t.id}><i style={{ background: t.color }} />{t.name}</span>)}
        <span><Icon name="diamond" style={{ color: 'var(--accent)' }} />Milestone</span>
        <span><Icon name="target" style={{ color: 'var(--green)' }} />Project target</span>
      </div>

      <div className={loading && data ? 'fade' : ''}>
        {view === 'month' && (
          <div className="cal-grid">
            {range.days.slice(0, 7).map((d) => <div key={d} className="cal-dow">{weekdayShort(d)}</div>)}
            {range.days.map((d) => {
              const items = get(d);
              const openCount = items.tasks.filter((t) => t.status !== 'Completed').length;
              const all = [...items.milestones.map((m) => ({ k: 'm', v: m })), ...items.projects.map((p) => ({ k: 'p', v: p })), ...items.tasks.map((t) => ({ k: 't', v: t })), ...items.deadlines.map((t) => ({ k: 'd', v: t }))];
              const shown = all.slice(0, 3);
              return (
                <div key={d} className={`cal-cell ${d.slice(0, 7) !== anchor.slice(0, 7) ? 'other' : ''} ${d === td ? 'today' : ''} ${dropDay === d ? 'drop' : ''}`} onClick={() => { setAnchor(d); setView('day'); }} {...dropProps(d)}>
                  <div className="top"><span className="day-n">{Number(d.slice(8))}</span>{openCount >= HEAVY && <span className="heavy" title={`${openCount} open tasks — consider rescheduling some`}><Icon name="alert" />{openCount}</span>}</div>
                  {shown.map((it) => it.k === 'm' ? <Milestone key={`m${it.v.id}`} m={it.v} /> : it.k === 'p' ? <ProjectDue key={`p${it.v.id}`} p={it.v} /> : <Pill key={`${it.k}${it.v.id}`} t={it.v} deadline={it.k === 'd'} />)}
                  {all.length > shown.length && <span className="more-n">+{all.length - shown.length} more</span>}
                  <div className="cal-dots">{all.slice(0, 6).map((it, i) => <i key={i} style={{ background: it.k === 'm' ? 'var(--accent)' : it.k === 'p' ? 'var(--green)' : typeColor(it.v.category) }} />)}</div>
                </div>
              );
            })}
          </div>
        )}

        {view === 'week' && (
          <div className="week-grid">
            {range.days.map((d) => {
              const items = get(d);
              const openCount = items.tasks.filter((t) => t.status !== 'Completed').length;
              return (
                <div key={d} className={`week-col ${d === td ? 'today' : ''} ${dropDay === d ? 'drop' : ''}`} {...dropProps(d)}>
                  <div className="wh" onClick={() => { setAnchor(d); setView('day'); }}><b>{weekdayShort(d)} {Number(d.slice(8))}</b>{openCount >= HEAVY ? <span className="heavy"><Icon name="alert" />{openCount}</span> : <span>{openCount || ''}</span>}</div>
                  {items.milestones.map((m) => <Milestone key={`m${m.id}`} m={m} />)}
                  {items.projects.map((p) => <ProjectDue key={`p${p.id}`} p={p} />)}
                  {items.tasks.map((t) => <Pill key={t.id} t={t} time />)}
                  {items.deadlines.map((t) => <Pill key={`d${t.id}`} t={t} deadline time />)}
                </div>
              );
            })}
          </div>
        )}

        {view === 'day' && (() => {
          const items = get(anchor);
          return (
            <div className="stack">
              <QuickAdd defaults={{ scheduled_date: anchor }} placeholder={`Add a task for ${fmtShort(anchor)}…`} />
              {(items.milestones.length > 0 || items.projects.length > 0 || items.deadlines.length > 0) && (
                <section className="card">
                  <div className="card-head"><h2><Icon name="flag" />Deadlines & milestones</h2></div>
                  <div className="stack" style={{ gap: 6 }}>
                    {items.milestones.map((m) => <div key={`m${m.id}`} className="row"><Icon name="diamond" style={{ color: 'var(--accent)' }} /><span className="grow">{m.title}</span><a href={`#/projects/${m.project_id}`} className="small">{m.project_name}</a></div>)}
                    {items.projects.map((p) => <div key={`p${p.id}`} className="row"><Icon name="target" style={{ color: 'var(--green)' }} /><span className="grow">Project target: {p.name}</span><a href={`#/projects/${p.id}`} className="small">Open</a></div>)}
                  </div>
                  {items.deadlines.length > 0 && <TaskList tasks={items.deadlines} />}
                </section>
              )}
              <section className="card">
                <div className="card-head"><h2>{fmtLong(anchor)}</h2><span className="count">{items.tasks.filter((t) => t.status !== 'Completed').length} open</span></div>
                <TaskList tasks={items.tasks} onReorder={(ids) => mutate(() => api.tasks.reorder(ids))} showDate={false} emptyText="Nothing scheduled" emptyHint="Use the box above to plan this day." emptyIcon="calendar" />
              </section>
            </div>
          );
        })()}
        {!data && !loading && <Empty title="Could not load the calendar" />}
      </div>
    </>
  );
}
