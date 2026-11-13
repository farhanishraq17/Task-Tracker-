import { useEffect, useRef, useState } from 'react';
import { Icon, Menu } from './ui.jsx';
import { useApp, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { relDate, relDateTime, fmtTime, addDays, weekStart } from '../lib/dates.js';

/** Patch that moves a task to another day. The deadline keeps its time of day when it sat on the same day. */
export function moveTo(task, date) {
  const patch = { scheduled_date: date };
  if (task.due_at) {
    const oldDate = task.scheduled_date || task.due_at.slice(0, 10);
    if (!date) patch.due_at = null;
    else if (task.due_at.slice(0, 10) === oldDate) patch.due_at = date + task.due_at.slice(10);
  }
  return patch;
}

const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315];

export default function TaskItem({ task, showDate = true, compact = false, dragProps = {}, className = '' }) {
  const { today, now, openTask, toast, typeColor } = useApp();
  const mutate = useMutate();
  const td = today();
  const done = task.status === 'Completed';
  const dateStr = task.scheduled_date || task.due_at?.slice(0, 10);
  const late = !done && task.due_at && task.due_at < now();

  // Pixel spark burst when a task flips to done.
  const prevDone = useRef(done);
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    const was = prevDone.current;
    prevDone.current = done;
    if (done && !was) { setBurst(true); const t = setTimeout(() => setBurst(false), 700); return () => clearTimeout(t); }
    return undefined;
  }, [done]);

  const toggle = async (e) => {
    e.stopPropagation();
    const r = await mutate(() => api.tasks.update(task.id, { status: done ? 'Not Started' : 'Completed' }));
    if (r?.next) toast(`Repeats — next ${relDate(r.next.scheduled_date || r.next.due_at?.slice(0, 10), td)}`);
  };
  const reschedule = (date) => mutate(() => api.tasks.update(task.id, moveTo(task, date)), date ? `Moved to ${relDate(date, td)}` : 'Date cleared');

  let when = '';
  let whenClass = '';
  if (task.due_at) {
    const sameDay = task.due_at.slice(0, 10) === td;
    when = !showDate && sameDay ? fmtTime(task.due_at.slice(11)) : relDateTime(task.due_at, td);
    whenClass = late ? 'late' : sameDay ? 'today' : '';
  } else if (task.start_time) when = fmtTime(task.start_time);
  else if (showDate && dateStr) { when = relDate(dateStr, td); whenClass = dateStr < td && !done ? 'late' : ''; }

  const subDone = task.subtasks.filter((s) => s.done).length;
  const meta = [
    task.project_name,
    task.subtasks.length ? `${subDone}/${task.subtasks.length} steps` : null,
    task.status === 'In Progress' ? 'in progress' : null,
    task.recurrence ? 'repeats' : null,
    task.attachments.length ? `${task.attachments.length} file${task.attachments.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <div className={`task ${done ? 'done' : ''} ${compact ? 'compact' : ''} ${className}`} onClick={() => openTask(task.id)} {...dragProps}>
      <button type="button" className={`check ${done ? 'on' : ''}`} onClick={toggle} aria-label={done ? 'Mark as not done' : 'Mark complete'}>
        <Icon name="check" />
        {burst && <span className="burst" aria-hidden="true">{SPARKS.map((a) => <i key={a} style={{ '--a': `${a}deg` }} />)}</span>}
      </button>
      <div className="grow">
        <div className="title">
          <i className="type-dot" style={{ background: typeColor(task.category) }} title={task.category} />
          <span className="title-text">{task.title}</span>
          {!done && (task.priority === 'Critical' || task.priority === 'High') && <Icon name="flag" className={`flag prio-${task.priority}`} title={`${task.priority} priority`} />}
        </div>
        {!compact && meta.length > 0 && <div className="meta">{meta.join(' · ')}</div>}
        {compact && when && <div className={`meta when ${whenClass}`}>{late && <Icon name="alert" />}{when}</div>}
      </div>
      {!compact && when && <span className={`when ${whenClass}`}>{late && <Icon name="alert" />}{when}</span>}
      <div className="side">
        {dragProps.draggable && <span className="grip" title="Drag to reorder"><Icon name="grip" /></span>}
        <Menu items={[
          { label: 'Edit', icon: 'edit', onClick: () => openTask(task.id) },
          { label: 'Duplicate', icon: 'copy', onClick: () => mutate(() => api.tasks.duplicate(task.id), 'Duplicated') },
          'sep', { heading: 'Reschedule' },
          { label: 'Today', icon: 'calendar', onClick: () => reschedule(td) },
          { label: 'Tomorrow', icon: 'calendar', onClick: () => reschedule(addDays(td, 1)) },
          { label: 'Next Monday', icon: 'calendar', onClick: () => reschedule(addDays(weekStart(td), 7)) },
          dateStr && { label: 'Clear date', icon: 'x', onClick: () => reschedule(null) },
          'sep',
          { label: 'Delete', icon: 'trash', danger: true, confirm: true, onClick: () => mutate(() => api.tasks.remove(task.id), 'Task deleted') },
        ]} />
      </div>
    </div>
  );
}
