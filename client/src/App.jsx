import { useEffect } from 'react';
import { AppProvider, useApp, useHash } from './store.jsx';
import { api } from './api.js';
import { Icon } from './components/ui.jsx';
import TaskEditor from './components/TaskEditor.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tasks from './pages/Tasks.jsx';
import Calendar from './pages/Calendar.jsx';
import Projects, { ProjectDetail } from './pages/Projects.jsx';
import Resources from './pages/Resources.jsx';
import Insights from './pages/Insights.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['/', 'Dashboard', 'dashboard'],
  ['/tasks', 'My Tasks', 'tasks'],
  ['/calendar', 'Calendar', 'calendar'],
  ['/projects', 'Projects', 'projects'],
  ['/resources', 'Resource Library', 'resources'],
  ['/insights', 'Insights', 'insights'],
  ['/settings', 'Settings', 'settings'],
];

export default function App() {
  return <AppProvider><Shell /></AppProvider>;
}

function Shell() {
  const { settings, error, editing, openTask, closeTask, toast, reloadSettings } = useApp();
  const { path, params } = useHash();

  // Deep link: #/tasks?task=12 (used by notifications) opens the task.
  useEffect(() => { if (params.task) openTask(Number(params.task)); }, [params.task, openTask]);

  // Live reminders from the server (Server-Sent Events). EventSource reconnects by itself.
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('reminder', (e) => {
      const r = JSON.parse(e.data);
      toast(r.body, 'reminder', { title: r.title, task_id: r.task_id });
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(r.title, { body: r.body, tag: r.key });
          n.onclick = () => { window.focus(); if (r.task_id) openTask(r.task_id); };
        } catch { /* notifications unavailable in this context */ }
      }
    });
    return () => es.close();
  }, [toast, openTask]);

  if (!settings && !error) return <div className="loading-screen">Loading…</div>;

  let page;
  if (path.startsWith('/projects/')) page = <ProjectDetail id={Number(path.split('/')[2])} />;
  else page = { '/': <Dashboard />, '/tasks': <Tasks />, '/calendar': <Calendar />, '/projects': <Projects />, '/resources': <Resources />, '/insights': <Insights />, '/settings': <Settings /> }[path] || <Dashboard />;

  return (
    <div className="app">
      <Sidebar path={path} settings={settings} reloadSettings={reloadSettings} />
      <main className="main" key={path.split('/')[1] || 'home'}>
        {error && <div className="error-box" style={{ marginBottom: 16 }}>{error} — start the server with <code>npm start</code> (or start.bat) and reload.</div>}
        {page}
      </main>
      {editing && <TaskEditor target={editing} onClose={closeTask} />}
      <Toasts />
    </div>
  );
}

function Sidebar({ path, settings, reloadSettings }) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const toggleTheme = async () => {
    try { await api.settings.update({ theme: dark ? 'light' : 'dark' }); await reloadSettings(); } catch { /* offline: ignore */ }
  };
  return (
    <aside className="sidebar">
      <div className="brand"><div className="logo"><Icon name="check" /></div><span>Command Center</span></div>
      <nav className="nav">
        {NAV.map(([href, label, icon]) => (
          <a key={href} href={`#${href}`} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}>
            <Icon name={icon} /><span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className="tz">{settings?.timezone || ''}</span>
        <button className="icon-btn" onClick={toggleTheme} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-label="Toggle theme">
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
      </div>
    </aside>
  );
}

function Toasts() {
  const { toasts, dismiss, openTask } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => { if (t.kind === 'reminder') { if (t.task_id) openTask(t.task_id); dismiss(t.id); } }}>
          {t.kind === 'reminder' && <Icon name="bell" style={{ color: 'var(--accent)', marginTop: 2 }} />}
          <div className="body">{t.title && <b>{t.title}</b>}{t.message}</div>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); dismiss(t.id); }} aria-label="Dismiss"><Icon name="x" /></button>
        </div>
      ))}
    </div>
  );
}
