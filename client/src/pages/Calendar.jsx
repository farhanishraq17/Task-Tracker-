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
  const { today, openTask } = useApp();
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
    const add = (d, item) => { if (!m.has(d)) m.set(d, { tasks: [], deadlines: [], milestones: [], projects: [] }); m.get(d)[item.kind].push(item.v); };
    for (const t of data?.tasks || []) add(t.scheduled_date || t.due_at.slice(0, 10), { kind: 'tasks', v: t });
    for (const t of data?.deadlines || []) add(t.due_at.slice(0, 10), { kind: 'deadlines', v: t });
    for (const ms of data?.milestones || []) add(ms.due_date, { kind: 'milestones', v: ms });
    for (const p of data?.projects || []) add(p.target_date, { kind: 'projects', v: p });
    return m;
  }, [data]);
  const get = (d) => byDay.get(d) || { tasks: [], deadlines: [], milestones: [], projects: [] };

  const step = (n) => setAnchor(view === 'month' ? addMonths(anchor, n) : addDays(anchor, view === 'week' ? 7 * n : n));
  const title = view === 'month' ? fmtMonth(anchor) : view === 'week' ? `${fmtDay(range.from)} – ${fmtShort(range.to)}` : fmtLong(anchor);

  // Drag a task pill onto a day to reschedule it.
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

  const Pill = ({ t, deadline }) => (
    <div className={`pill ${t.status === 'Completed' ? 'done' : ''} ${deadline ? 'deadline' : ''} ${dragId === t.id ? 'dragging' : ''}`} style={{ borderLeftColor: `var(--p-${t.priority.toLowerCase()})` }}
      title={`${t.title}${t.due_at ? ` · due ${fmtTime(t.due_at.slice(11))}` : ''}`} onClick={(e) => { e.stopPropagation(); openTask(t.id); }} {...dragProps(t)}>
      {deadline && <Icon name="flag" style={{ width: 10, height: 10 }} />}
      {t.due_at && !deadline && <span className="muted" style={{ flex: 'none' }}>{fmtTime(t.due_at.slice(11)).replace(/\s?(AM|PM)/i, (m) => m.trim().toLowerCase())}</span>}
      <span>{t.title}</span>
    </div>
  );
  const Milestone = ({ m }) => <div className="pill milestone" title={`${m.project_name} · milestone`}><Icon name="diamond" style={{ width: 10, height: 10 }} /><span>{m.title}</span></div>;
  const ProjectDue = ({ p }) => <a className="pill project" href={`#/projects/${p.id}`} title="Project target date" onClick={(e) => e.stopPropagation()}><Icon name="target" style={{ width: 10, height: 10 }} /><span>{p.name} due</span></a>;

  return (
    <>
      <div className="page-head">
        <div><h1>Calendar</h1><div className="sub">Drag a task onto another day to reschedule it.</div></div>
        <div className="actions">
          <Segmented value={view} onChange={setView} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month']]} />
        </div>
      </div>
      <div className="cal-head">
        <div className="row">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous"><Icon name="left" /></button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next"><Icon name="right" /></button>
          <h2>{title}</h2>
        </div>
        <div className="row">
          <div className="legend"><span><i style={{ background: 'var(--p-high)' }} />Task (priority color)</span><span><i style={{ background: 'var(--accent)' }} />Milestone</span><span><i style={{ background: 'var(--success)' }} />Project target</span></div>
          <button className="btn btn-sm" onClick={() => setAnchor(td)}>Today</button>
        </div>
      </div>

      <div className={loading && data ? 'fade' : ''}>
        {view === 'month' && (
          <div className="cal-grid">
            {range.days.slice(0, 7).map((d) => <div key={d} className="cal-dow">{weekdayShort(d)}</div>)}
            {range.days.map((d) => {
              const items = get(d);
              const openCount = items.tasks.filter((t) => t.status !== 'Completed').length;
              const all = [...items.milestones.map((m) => ({ k: 'm', v: m })), ...items.projects.map((p) => ({ k: 'p', v: p })), ...items.tasks.map((t) => ({ k: 't', v: t })), ...items.deadlines.map((t) => ({ k: 'd', v: t }))];
              const shown = all.slice(0, 4);
              return (
                <div key={d} className={`cal-cell ${d.slice(0, 7) !== anchor.slice(0, 7) ? 'other' : ''} ${d === td ? 'today' : ''} ${dropDay === d ? 'drop' : ''}`} onClick={() => { setAnchor(d); setView('day'); }} {...dropProps(d)}>
                  <div className="top"><span className="day-n">{Number(d.slice(8))}</span>{openCount >= HEAVY && <span className="heavy" title={`${openCount} open tasks — consider rescheduling some`}><Icon name="alert" />{openCount}</span>}</div>
                  {shown.map((it) => it.k === 'm' ? <Milestone key={`m${it.v.id}`} m={it.v} /> : it.k === 'p' ? <ProjectDue key={`p${it.v.id}`} p={it.v} /> : <Pill key={`${it.k}${it.v.id}`} t={it.v} deadline={it.k === 'd'} />)}
                  {all.length > shown.length && <span className="more-n">+{all.length - shown.length} more</span>}
                  <div className="cal-dots">{all.slice(0, 6).map((it, i) => <i key={i} style={{ background: it.k === 'm' ? 'var(--accent)' : it.k === 'p' ? 'var(--success)' : `var(--p-${it.v.priority?.toLowerCase() || 'medium'})` }} />)}</div>
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
                  <div className="wh" onClick={() => { setAnchor(d); setView('day'); }}><b>{weekdayShort(d)} {Number(d.slice(8))}</b>{openCount >= HEAVY ? <span className="heavy"><Icon name="alert" />{openCount} open</span> : <span>{openCount ? `${openCount} open` : ''}</span>}</div>
                  {items.milestones.map((m) => <Milestone key={`m${m.id}`} m={m} />)}
                  {items.projects.map((p) => <ProjectDue key={`p${p.id}`} p={p} />)}
                  {items.tasks.map((t) => <Pill key={t.id} t={t} />)}
                  {items.deadlines.map((t) => <Pill key={`d${t.id}`} t={t} deadline />)}
                  {!items.tasks.length && !items.milestones.length && !items.deadlines.length && !items.projects.length && <span className="muted small" style={{ padding: 4 }}>—</span>}
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
                    {items.projects.map((p) => <div key={`p${p.id}`} className="row"><Icon name="target" style={{ color: 'var(--success)' }} /><span className="grow">Project target: {p.name}</span><a href={`#/projects/${p.id}`} className="small">Open</a></div>)}
                  </div>
                  {items.deadlines.length > 0 && <TaskList tasks={items.deadlines} />}
                </section>
              )}
              <section className="card">
                <div className="card-head"><h2>{fmtLong(anchor)} <span className="count">{items.tasks.filter((t) => t.status !== 'Completed').length} open</span></h2></div>
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
