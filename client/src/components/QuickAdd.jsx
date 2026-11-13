import { useMemo, useState } from 'react';
import { Icon } from './ui.jsx';
import { useApp, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { parseQuickAdd } from '../lib/quickparse.js';
import { relDate, fmtTime } from '../lib/dates.js';

/** One-line task capture with natural-language dates. `defaults` are applied when nothing was typed for them. */
export default function QuickAdd({ defaults = {}, placeholder = 'Add a task…  e.g. "Finish the experiments by Friday 5pm !high #research"', onCreated, autoFocus = false }) {
  const { settings, today } = useApp();
  const mutate = useMutate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const td = today();
  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text, { today: td, defaultDueTime: settings?.default_due_time || '18:00' }) : null), [text, td, settings?.default_due_time]);

  const submit = async (e) => {
    e.preventDefault();
    if (!parsed?.title || busy) return;
    setBusy(true);
    const body = { ...defaults, title: parsed.title };
    if (parsed.scheduled_date) { body.scheduled_date = parsed.scheduled_date; body.due_at = parsed.due_at; }
    if (parsed.start_time) body.start_time = parsed.start_time;
    if (parsed.priority) body.priority = parsed.priority;
    if (parsed.category) body.category = parsed.category;
    const r = await mutate(() => api.tasks.create(body), 'Task added');
    setBusy(false);
    if (r) { setText(''); onCreated?.(r); }
  };

  const hasHints = parsed && (parsed.scheduled_date || parsed.start_time || parsed.priority || parsed.category);
  return (
    <form className="quick-wrap" onSubmit={submit}>
      <div className="quick">
        <Icon name="plus" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label="Quick add a task" />
        <button className="btn btn-primary btn-sm" type="submit" disabled={!parsed?.title || busy}>Add</button>
      </div>
      {hasHints && (
        <div className="quick-preview">
          <span>Understood:</span>
          {parsed.scheduled_date && <span className="chip accent"><Icon name="calendar" />{relDate(parsed.scheduled_date, td)}{parsed.due_at && !parsed.start_time ? ` · due ${fmtTime(parsed.due_at.slice(11))}` : ''}</span>}
          {parsed.start_time && <span className="chip"><Icon name="clock" />{fmtTime(parsed.start_time)}</span>}
          {parsed.priority && <span className="chip"><i className={`dot prio-${parsed.priority}`} />{parsed.priority}</span>}
          {parsed.category && <span className="chip">{parsed.category}</span>}
        </div>
      )}
    </form>
  );
}
