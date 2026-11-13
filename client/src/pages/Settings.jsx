import { useEffect, useState } from 'react';
import { useApp, useData, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { Icon, Field, Select, Segmented, Confirm, PRIORITIES } from '../components/ui.jsx';
import { ReminderChips } from '../components/TaskEditor.jsx';
import { fmtBytes } from '../lib/dates.js';

const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Dubai', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC']; } })();

function Setting({ title, desc, children }) {
  return <div className="setting"><div className="info"><b>{title}</b>{desc && <span>{desc}</span>}</div><div className="ctl">{children}</div></div>;
}

/** Text input that saves on blur / Enter. */
function SaveInput({ value, onSave, ...rest }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => { if (v !== (value ?? '')) onSave(v); };
  return <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} {...rest} />;
}

export default function Settings() {
  const { settings, reloadSettings, toast } = useApp();
  const mutate = useMutate();
  const { data: backups } = useData(api.data.backups);
  const { data: log } = useData(api.settings.notifications);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [testing, setTesting] = useState('');
  if (!settings) return <div className="loading">Loading…</div>;
  const s = settings;
  const save = async (patch) => { const r = await mutate(() => api.settings.update(patch)); if (r) await reloadSettings(); };
  const setChannel = (ch, on) => save({ channels: { ...s.channels, [ch]: on } });
  const test = async (ch) => { setTesting(ch); try { await api.settings.test(ch); toast(ch === 'browser' ? 'Sent — you should see it now' : `Test ${ch} notification sent`); } catch (e) { toast(e.message, 'error'); } setTesting(''); };
  const askPermission = async () => { if (typeof Notification === 'undefined') return; const p = await Notification.requestPermission(); setPerm(p); if (p === 'granted') toast('Browser notifications enabled'); };
  const importFile = async (file) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const r = await mutate(() => api.data.import(json));
      if (r) toast(`Imported ${r.tasks} tasks, ${r.projects} projects, ${r.resources} resources, ${r.collections} collections · ${r.skipped} already present`);
    } catch (e) { toast(e.message.includes('JSON') ? 'That file is not a valid JSON export' : e.message, 'error'); }
  };
  const restoreFile = async (file) => { if (!file) return; const r = await mutate(() => api.data.restoreFile(file), 'Database restored'); if (r) await reloadSettings(); };

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Changes save automatically.</div></div></div>
      <div className="settings-grid">
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2><Icon name="sparkle" />Personal</h2></div>
            <Setting title="Your name" desc="Used in the dashboard greeting."><SaveInput value={s.display_name} onSave={(v) => save({ display_name: v })} placeholder="e.g. Alex" /></Setting>
            <Setting title="Timezone" desc={`Server time now: ${s.server.now.replace('T', ' ')}`}>
              <SaveInput value={s.timezone} onSave={(v) => save({ timezone: v })} list="tz-list" placeholder="Asia/Dhaka" />
              <datalist id="tz-list">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
            </Setting>
            <Setting title="Theme"><Segmented value={s.theme} onChange={(v) => save({ theme: v })} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]} /></Setting>
            <Setting title="Weekly goal" desc="Tasks you aim to complete per week."><input type="number" min="0" max="1000" className="input" style={{ width: 90 }} defaultValue={s.weekly_goal} key={s.weekly_goal} onBlur={(e) => Number(e.target.value) !== s.weekly_goal && save({ weekly_goal: Number(e.target.value) })} /></Setting>
          </section>

          <section className="card">
            <div className="card-head"><h2><Icon name="tasks" />Task defaults</h2></div>
            <Setting title="Default priority"><Select className="auto" value={s.default_priority} onChange={(v) => save({ default_priority: v })} options={PRIORITIES} /></Setting>
            <Setting title="Default deadline time" desc='Used when you type a date without a time, e.g. "by Friday".'><input type="time" className="input" style={{ width: 120 }} value={s.default_due_time} onChange={(e) => e.target.value && save({ default_due_time: e.target.value })} /></Setting>
            <div className="setting" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="info"><b>Default reminders</b><span>Applied to every task that has a deadline and no custom reminders. Negative offsets fire after the deadline while the task is still open.</span></div>
              <div style={{ marginTop: 8 }}><ReminderChips value={s.default_reminders} onChange={(v) => save({ default_reminders: v })} allowDefault={false} /></div>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2><Icon name="bell" />Notifications</h2></div>
            <Setting title="Browser notifications" desc={perm === 'granted' ? 'Shown while the dashboard tab is open.' : perm === 'denied' ? 'Blocked in your browser — allow notifications for this site in the address-bar settings.' : perm === 'unsupported' ? 'Not supported by this browser.' : 'Allow notifications to see reminders even when the tab is in the background.'}>
              {perm === 'default' && <button className="btn btn-sm" onClick={askPermission}>Allow</button>}
              <button className="btn btn-sm" onClick={() => test('browser')} disabled={!!testing}>Test</button>
              <input type="checkbox" className="switch" checked={s.channels.browser} onChange={(e) => setChannel('browser', e.target.checked)} aria-label="Browser notifications" />
            </Setting>
            <Setting title="Windows desktop toasts" desc={s.integrations.desktop ? 'Native Windows notifications from the server, used when the dashboard is not open in a browser. Click one to open the task.' : 'Only available when the server runs on Windows.'}>
              <button className="btn btn-sm" onClick={() => test('desktop')} disabled={!!testing || !s.integrations.desktop}>Test</button>
              <input type="checkbox" className="switch" checked={s.channels.desktop} disabled={!s.integrations.desktop} onChange={(e) => setChannel('desktop', e.target.checked)} aria-label="Desktop toasts" />
            </Setting>
            <Setting title="Email" desc={s.integrations.email ? `Configured → ${s.integrations.email_to}` : 'Not configured. Add SMTP_HOST, SMTP_USER and SMTP_PASS to .env (see .env.example) and restart.'}>
              <button className="btn btn-sm" onClick={() => test('email')} disabled={!!testing || !s.integrations.email}>{testing === 'email' ? 'Sending…' : 'Test'}</button>
              <input type="checkbox" className="switch" checked={s.channels.email} disabled={!s.integrations.email} onChange={(e) => setChannel('email', e.target.checked)} aria-label="Email notifications" />
            </Setting>
            <Setting title="WhatsApp" desc={s.integrations.whatsapp ? `Configured via ${s.integrations.whatsapp_provider} → ${s.integrations.whatsapp_to}` : 'Not configured. Set WHATSAPP_PROVIDER and its credentials in .env (Meta Cloud API or Twilio), then restart.'}>
              <button className="btn btn-sm" onClick={() => test('whatsapp')} disabled={!!testing || !s.integrations.whatsapp}>{testing === 'whatsapp' ? 'Sending…' : 'Test'}</button>
              <input type="checkbox" className="switch" checked={s.channels.whatsapp} disabled={!s.integrations.whatsapp} onChange={(e) => setChannel('whatsapp', e.target.checked)} aria-label="WhatsApp notifications" />
            </Setting>
            <Setting title="WhatsApp for priorities at or above" desc="New tasks at this priority or higher get WhatsApp reminders by default; override per task."><Select className="auto" value={s.whatsapp_min_priority} onChange={(v) => save({ whatsapp_min_priority: v })} options={PRIORITIES} /></Setting>
            <Setting title="Morning digest" desc="A daily summary of today's tasks and anything overdue, sent through the enabled channels.">
              <input type="time" className="input" style={{ width: 120 }} value={s.digest_time || '08:00'} disabled={!s.digest_time} onChange={(e) => e.target.value && save({ digest_time: e.target.value })} />
              <input type="checkbox" className="switch" checked={!!s.digest_time} onChange={(e) => save({ digest_time: e.target.checked ? '08:00' : '' })} aria-label="Morning digest" />
            </Setting>
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head"><h2><Icon name="database" />Data</h2></div>
            <Setting title="Export" desc="Everything as JSON (re-importable), or tasks/resources as CSV for spreadsheets.">
              <a className="btn btn-sm" href="/api/data/export.json" download><Icon name="download" />JSON</a>
              <a className="btn btn-sm" href="/api/data/export/tasks.csv" download>Tasks CSV</a>
              <a className="btn btn-sm" href="/api/data/export/resources.csv" download>Resources CSV</a>
            </Setting>
            <Setting title="Import" desc="Merge a previous JSON export. Rows already present are skipped, nothing is overwritten.">
              <label className="btn btn-sm file-btn"><Icon name="upload" />Choose file<input type="file" accept=".json,application/json" onChange={(e) => { importFile(e.target.files[0]); e.target.value = ''; }} /></label>
            </Setting>
            <Setting title="Automatic daily backup" desc="Keeps the 7 most recent daily snapshots in data/backups."><input type="checkbox" className="switch" checked={s.auto_backup} onChange={(e) => save({ auto_backup: e.target.checked })} aria-label="Automatic backup" /></Setting>
            <div className="setting" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row between"><div className="info"><b>Backups</b><span>Restoring replaces all current data; a safety backup is taken first.</span></div>
                <div className="ctl">
                  <label className="btn btn-sm file-btn" title="Restore from a .db file"><Icon name="upload" />Restore file<input type="file" accept=".db" onChange={(e) => { restoreFile(e.target.files[0]); e.target.value = ''; }} /></label>
                  <button className="btn btn-sm btn-primary" onClick={() => mutate(() => api.data.createBackup(), 'Backup created')}><Icon name="database" />Back up now</button>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                {!backups?.length ? <span className="muted small">No backups yet.</span> : backups.slice(0, 12).map((b) => (
                  <div key={b.name} className="backup">
                    <span className="name" title={b.name}>{b.name}</span>
                    <span className="muted small nowrap">{fmtBytes(b.size)}</span>
                    <a className="icon-btn" href={`/api/data/backups/${encodeURIComponent(b.name)}`} download title="Download"><Icon name="download" /></a>
                    <Confirm className="btn btn-sm" label="Restore?" onConfirm={async () => { const r = await mutate(() => api.data.restore(b.name), 'Database restored'); if (r) await reloadSettings(); }}>Restore</Confirm>
                    <Confirm className="icon-btn danger" label="Sure?" onConfirm={() => mutate(() => api.data.deleteBackup(b.name))}><Icon name="trash" /></Confirm>
                  </div>
                ))}
                {backups?.length > 12 && <span className="muted small">…and {backups.length - 12} older in data/backups</span>}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2><Icon name="bell" />Recent notifications</h2><span className="count">what the reminder engine did</span></div>
            {!log?.length ? <span className="muted small">Nothing yet. Reminders appear here once a deadline approaches.</span> : (
              <div className="table-scroll"><table className="data">
                <thead><tr><th>When</th><th>Reminder</th><th>Channel</th><th>Result</th></tr></thead>
                <tbody>{log.slice(0, 40).map((n) => (
                  <tr key={n.id}><td className="nowrap">{n.created_at.replace('T', ' ')}</td><td>{n.title || n.reminder_key}</td><td>{n.channel === 'all' ? '—' : n.channel}</td><td><span className={`status-pill`}><i className="dot" style={{ background: n.status === 'sent' ? 'var(--success)' : n.status === 'failed' ? 'var(--danger)' : 'var(--text-3)' }} />{n.status}{n.detail ? <span className="muted"> · {n.detail}</span> : ''}</span></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <p className="muted small">Database: data/app.db (SQLite). Attachments: data/files. Secrets live only in .env.</p>
        </div>
      </div>
    </>
  );
}
