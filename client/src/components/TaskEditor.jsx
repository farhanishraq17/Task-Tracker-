import { useEffect, useState } from 'react';
import { Modal, Field, Select, Icon, Confirm, PRIORITIES, STATUSES } from './ui.jsx';
import { useApp, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { relDate, fmtBytes, offsetLabel, REMINDER_PRESETS } from '../lib/dates.js';

const PRIO_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

/** Reminder offsets editor. value null = "use defaults" (when allowDefault). */
export function ReminderChips({ value, defaults = [], onChange, allowDefault = true }) {
  const custom = value != null;
  const list = custom ? value : defaults;
  const editable = custom || !allowDefault;
  return (
    <div className="chips-edit">
      {list.map((m) => (
        <span key={m} className="chip">{offsetLabel(m)}{editable && <button type="button" onClick={() => onChange(list.filter((x) => x !== m))} aria-label="Remove reminder"><Icon name="x" /></button>}</span>
      ))}
      {!list.length && <span className="muted small">No reminders</span>}
      {editable && <Select className="sm auto" value="" onChange={(v) => v && onChange([...new Set([...list, Number(v)])].sort((a, b) => b - a))} options={REMINDER_PRESETS.filter((p) => !list.includes(p)).map((p) => [p, offsetLabel(p)])} placeholder="+ Add reminder" />}
      {allowDefault && (custom
        ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>Use defaults</button>
        : <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...defaults])}>Customize</button>)}
    </div>
  );
}

const blank = (draft, settings) => ({
  title: '', notes: '', scheduled_date: null, start_time: null, due_at: null, priority: settings?.default_priority || 'Medium',
  category: (settings?.activity_types || []).find((t) => t.name === 'Other')?.name || settings?.activity_types?.[0]?.name || 'Other',
  status: 'Not Started', project_id: null, recurrence: null, reminders: null, links: [], notify_whatsapp: null, subtasks: [], attachments: [], ...draft,
});

export default function TaskEditor({ target, onClose }) {
  const { settings, today, toast, types, typeColor } = useApp();
  const mutate = useMutate();
  const isNew = !target.id;
  const [form, setForm] = useState(isNew ? blank(target.draft, settings) : null);
  const [projects, setProjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [sub, setSub] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');

  useEffect(() => { api.projects.list().then(setProjects).catch(() => {}); }, []);
  useEffect(() => {
    if (target.id) api.tasks.get(target.id).then(setForm).catch((e) => { toast(e.message, 'error'); onClose(); });
  }, [target.id, toast, onClose]);

  if (!form) return <Modal title="Task" onClose={onClose} className="wide"><div className="loading">Loading…</div></Modal>;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.title.trim()) { toast('Give the task a title first', 'error'); return; }
    setSaving(true);
    const body = {
      title: form.title.trim(), notes: form.notes, scheduled_date: form.scheduled_date, start_time: form.start_time, due_at: form.due_at,
      priority: form.priority, category: form.category, status: form.status, project_id: form.project_id, recurrence: form.recurrence,
      reminders: form.reminders, links: form.links,
      subtasks: form.subtasks.map((s) => ({ id: s.id > 0 ? s.id : undefined, title: s.title, done: s.done })),
    };
    if (form.notify_whatsapp !== null) body.notify_whatsapp = form.notify_whatsapp;
    const r = await mutate(() => (isNew ? api.tasks.create(body) : api.tasks.update(form.id, body)), isNew ? 'Task created' : 'Saved');
    setSaving(false);
    if (!r) return;
    if (r.next) toast(`Repeats — next occurrence ${relDate(r.next.scheduled_date || r.next.due_at?.slice(0, 10), today())}`);
    onClose();
  };

  const dueDate = form.due_at?.slice(0, 10) || '';
  const dueTime = form.due_at?.slice(11, 16) || '';
  const setDue = (d, t) => set({ due_at: d ? `${d}T${t || settings?.default_due_time || '18:00'}` : null });
  const rec = form.recurrence;
  const setRec = (freq) => set({ recurrence: freq ? { freq, interval: 1, ...(freq === 'weekly' ? { weekdays: [] } : {}), ...(freq === 'custom' ? { unit: 'days' } : {}) } : null });
  const toggleWeekday = (d) => set({ recurrence: { ...rec, weekdays: rec.weekdays.includes(d) ? rec.weekdays.filter((x) => x !== d) : [...rec.weekdays, d].sort() } });
  const addSub = () => { const t = sub.trim(); if (!t) return; set({ subtasks: [...form.subtasks, { id: -Date.now(), title: t, done: false }] }); setSub(''); };
  const addLink = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^[a-z]+:/i.test(url)) url = `https://${url}`;
    set({ links: [...form.links, { url, label: linkLabel.trim() }] });
    setLinkUrl(''); setLinkLabel('');
  };
  const upload = async (file) => { if (!file) return; const r = await mutate(() => api.tasks.upload(form.id, file), 'File attached'); if (r) set({ attachments: r.attachments }); };
  const whatsappDefault = PRIO_RANK[form.priority] <= PRIO_RANK[settings?.whatsapp_min_priority || 'High'];

  const footer = (
    <>
      {!isNew && <Confirm className="btn btn-ghost btn-danger" label="Delete permanently?" onConfirm={async () => { const r = await mutate(() => api.tasks.remove(form.id), 'Task deleted'); if (r) onClose(); }}><Icon name="trash" />Delete</Confirm>}
      {!isNew && <button type="button" className="btn btn-ghost" onClick={async () => { const r = await mutate(() => api.tasks.duplicate(form.id), 'Duplicated'); if (r) onClose(); }}><Icon name="copy" />Duplicate</button>}
      <span className="spacer" />
      <span className="muted small nowrap">Ctrl+Enter saves</span>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{isNew ? 'Create task' : 'Save changes'}</button>
    </>
  );

  return (
    <Modal title={isNew ? 'New task' : 'Task details'} onClose={onClose} className="wide" footer={footer}>
      <div className="stack" style={{ gap: 14 }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}>
        <input className="input lg" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="What needs to be done?" autoFocus={isNew} aria-label="Title" />
        <textarea className="input" value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes, context, details…" rows={3} aria-label="Notes" />

        <div className="grid grid-3">
          <Field label="Scheduled day"><input type="date" className="input" value={form.scheduled_date || ''} onChange={(e) => set({ scheduled_date: e.target.value || null })} /></Field>
          <Field label="Start time"><input type="time" className="input" value={form.start_time || ''} onChange={(e) => set({ start_time: e.target.value || null })} /></Field>
          <Field label="Status"><Select value={form.status} onChange={(v) => set({ status: v })} options={STATUSES} /></Field>
        </div>
        <div className="grid grid-3">
          <Field label="Deadline"><input type="date" className="input" value={dueDate} onChange={(e) => setDue(e.target.value, dueTime)} /></Field>
          <Field label="Deadline time"><input type="time" className="input" value={dueTime} disabled={!dueDate} onChange={(e) => setDue(dueDate, e.target.value)} /></Field>
          <Field label="Priority"><Select value={form.priority} onChange={(v) => set({ priority: v })} options={PRIORITIES} /></Field>
        </div>
        <div className="grid grid-3">
          <Field label="Activity type">
            <div className="row" style={{ gap: 8 }}>
              <i className="type-dot lg" style={{ background: typeColor(form.category) }} />
              <Select value={form.category} onChange={(v) => set({ category: v })} options={[...new Set([...types.map((t) => t.name), form.category])].filter(Boolean)} />
            </div>
          </Field>
          <Field label="Project"><Select value={form.project_id ?? ''} onChange={(v) => set({ project_id: v ? Number(v) : null })} placeholder="No project" options={projects.filter((p) => p.status !== 'Archived' || p.id === form.project_id).map((p) => [p.id, p.name])} /></Field>
          <Field label="Repeat"><Select value={rec?.freq || ''} onChange={setRec} placeholder="Does not repeat" options={[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom interval']]} /></Field>
        </div>
        {rec && (
          <div className="row wrap" style={{ fontSize: 13 }}>
            <span>Every</span>
            <input type="number" min="1" max="365" className="input sm" style={{ width: 64 }} value={rec.interval} onChange={(e) => set({ recurrence: { ...rec, interval: Math.max(1, Number(e.target.value) || 1) } })} aria-label="Interval" />
            {rec.freq === 'custom' ? <Select className="sm auto" value={rec.unit} onChange={(v) => set({ recurrence: { ...rec, unit: v } })} options={['days', 'weeks', 'months']} />
              : <span>{rec.freq === 'daily' ? 'day(s)' : rec.freq === 'weekly' ? 'week(s) on' : 'month(s)'}</span>}
            {rec.freq === 'weekly' && (
              <div className="weekdays">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => { const d = (i + 1) % 7; return <button type="button" key={i} className={rec.weekdays.includes(d) ? 'on' : ''} onClick={() => toggleWeekday(d)} aria-label={`Weekday ${d}`}>{l}</button>; })}
              </div>
            )}
            <span className="muted">The next occurrence is created when you complete this one.</span>
          </div>
        )}

        <Field label="Reminders" hint={form.due_at ? 'Relative to the deadline. Negative offsets fire after it if the task is still open.' : 'Set a deadline to receive reminders.'}>
          <ReminderChips value={form.reminders} defaults={settings?.default_reminders || []} onChange={(v) => set({ reminders: v })} />
        </Field>
        <label className="checkline">
          <input type="checkbox" checked={form.notify_whatsapp ?? whatsappDefault} onChange={(e) => set({ notify_whatsapp: e.target.checked })} />
          <span>Also send this task's reminders to WhatsApp {!settings?.integrations?.whatsapp && <span className="muted small">(not configured yet — see Settings)</span>}</span>
        </label>

        <Field label={`Subtasks${form.subtasks.length ? ` · ${form.subtasks.filter((s) => s.done).length}/${form.subtasks.length} done` : ''}`}>
          <div className="subtasks">
            {form.subtasks.map((s) => (
              <div key={s.id} className={`subtask ${s.done ? 'done' : ''}`}>
                <button type="button" className={`check ${s.done ? 'on' : ''}`} onClick={() => set({ subtasks: form.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })} aria-label="Toggle subtask"><Icon name="check" /></button>
                <input type="text" value={s.title} onChange={(e) => set({ subtasks: form.subtasks.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) })} aria-label="Subtask title" />
                <button type="button" className="icon-btn sm danger" onClick={() => set({ subtasks: form.subtasks.filter((x) => x.id !== s.id) })} aria-label="Remove subtask"><Icon name="x" /></button>
              </div>
            ))}
            <div className="add-inline"><Icon name="plus" /><input value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }} placeholder="Add a step and press Enter" aria-label="New subtask" /></div>
          </div>
        </Field>

        <Field label="Links">
          {form.links.map((l, i) => (
            <div key={i} className="link-row"><Icon name="link" className="muted" /><a href={l.url} target="_blank" rel="noreferrer">{l.label || l.url}</a>
              <button type="button" className="icon-btn sm danger" onClick={() => set({ links: form.links.filter((_, j) => j !== i) })} aria-label="Remove link"><Icon name="x" /></button></div>
          ))}
          <div className="row">
            <input className="input sm grow" placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} aria-label="Link URL" />
            <input className="input sm" style={{ width: 150 }} placeholder="Label (optional)" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} aria-label="Link label" />
            <button type="button" className="btn btn-sm" onClick={addLink} disabled={!linkUrl.trim()}>Add</button>
          </div>
        </Field>

        <Field label="Attachments">
          {isNew ? <span className="muted small">Create the task first, then attach files.</span> : (
            <>
              {form.attachments.map((a) => (
                <div key={a.id} className="link-row"><Icon name="paperclip" className="muted" /><a href={`/files/${a.stored_name}`} download={a.filename}>{a.filename}</a><span className="muted small">{fmtBytes(a.size)}</span>
                  <button type="button" className="icon-btn sm danger" onClick={async () => { const r = await mutate(() => api.tasks.removeAttachment(form.id, a.id), 'Attachment removed'); if (r) set({ attachments: r.attachments }); }} aria-label="Remove attachment"><Icon name="x" /></button></div>
              ))}
              <label className="btn btn-sm file-btn" style={{ alignSelf: 'flex-start' }}><Icon name="upload" />Attach a file<input type="file" onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} /></label>
            </>
          )}
        </Field>
      </div>
    </Modal>
  );
}
