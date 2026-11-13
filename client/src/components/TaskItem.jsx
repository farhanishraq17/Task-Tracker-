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

export default function TaskItem({ task, showDate = true, compact = false, dragProps = {}, className = '' }) {
  const { today, now, openTask, toast } = useApp();
  const mutate = useMutate();
  const td = today();
  const done = task.status === 'Completed';
  const dateStr = task.scheduled_date || task.due_at?.slice(0, 10);
  const late = !done && task.due_at && task.due_at < now();
  const subDone = task.subtasks.filter((s) => s.done).length;

  const toggle = async (e) => {
    e.stopPropagation();
    const r = await mutate(() => api.tasks.update(task.id, { status: done ? 'Not Started' : 'Completed' }));
    if (r?.next) toast(`Repeats — next occurrence ${relDate(r.next.scheduled_date || r.next.due_at?.slice(0, 10), td)}`);
  };
  const reschedule = (date) => mutate(() => api.tasks.update(task.id, moveTo(task, date)), date ? `Moved to ${relDate(date, td)}` : 'Date cleared');

  return (
    <div className={`task ${done ? 'done' : ''} ${className}`} onClick={() => openTask(task.id)} {...dragProps}>
      <button type="button" className={`check prio-${task.priority} ${done ? 'on' : ''}`} onClick={toggle} aria-label={done ? 'Mark as not done' : 'Mark complete'}><Icon name="check" /></button>
      <div className="grow">
        <div className="title">{task.title}</div>
        <div className="meta">
          {task.due_at
            ? <span className={late ? 'late' : task.due_at.slice(0, 10) === td ? 'today' : ''}><Icon name={late ? 'alert' : 'clock'} />{relDateTime(task.due_at, td)}{late ? ' · overdue' : ''}</span>
            : showDate && dateStr ? <span className={dateStr < td && !done ? 'late' : ''}><Icon name="calendar" />{relDate(dateStr, td)}</span> : null}
          {task.start_time && <span><Icon name="play" />{fmtTime(task.start_time)}</span>}
          {task.project_name && <span><i className="swatch" style={{ background: task.project_color || 'var(--accent)' }} />{task.project_name}</span>}
          {!compact && task.category !== 'Other' && <span>{task.category}</span>}
          {!compact && task.priority !== 'Medium' && <span><i className={`dot prio-${task.priority}`} />{task.priority}</span>}
          {task.status === 'In Progress' && <span className="today">In progress</span>}
          {task.recurrence && <span title="Repeats"><Icon name="repeat" /></span>}
          {task.subtasks.length > 0 && <span><Icon name="tasks" />{subDone}/{task.subtasks.length}</span>}
          {task.attachments.length > 0 && <span><Icon name="paperclip" />{task.attachments.length}</span>}
          {task.links.length > 0 && <span><Icon name="link" />{task.links.length}</span>}
        </div>
      </div>
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
