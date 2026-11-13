// Landing page: a personal welcome, live clock, the mascot, quick capture, and game-menu tiles into each section.
import { useApp, useData } from '../store.jsx';
import { api } from '../api.js';
import { Icon } from '../components/ui.jsx';
import { Mascot, Typewriter, Clock, PixelBar, CountUp } from '../components/pixel.jsx';
import QuickAdd from '../components/QuickAdd.jsx';
import { fmtLong, fmtTime, relDateTime } from '../lib/dates.js';

export default function Home() {
  const { settings, openTask } = useApp();
  const { data } = useData(api.dashboard);
  const { data: projects } = useData(api.projects.list);
  const { data: resources } = useData(() => api.resources.list({ limit: 2000 }));

  const name = settings?.display_name?.trim();
  const hour = Number((data?.now || settings?.server?.now || '12:00').slice(11, 13));
  const period = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
  const greet = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Up late' }[period];
  const open = data ? data.tasks_today.filter((t) => t.status !== 'Completed') : [];
  const total = data?.tasks_today.length || 0;
  const done = total - open.length;
  const overdue = data?.overdue.length || 0;
  const nextUp = open.find((t) => t.due_at || t.start_time) || open[0];
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const bubble = !data ? 'Loading your day…'
    : overdue ? `${plural(overdue, 'task')} overdue. Let's clear ${overdue === 1 ? 'it' : 'them'} first!`
      : open.length ? `${plural(open.length, 'task')} left today. You've got this.`
        : total ? 'Everything done for today. Legendary!'
          : 'A blank day. Plan something good!';
  const activeProjects = (projects || []).filter((p) => p.status === 'Active').length;
  const toRead = (resources || []).filter((r) => r.status !== 'Completed').length;

  const tiles = [
    { href: '#/dashboard', icon: 'dashboard', label: 'Dashboard', sub: data ? plural(open.length, 'task') + ' left' : '…' },
    { href: '#/tasks', icon: 'tasks', label: 'My Tasks', sub: data ? (overdue ? `${overdue} overdue` : 'nothing overdue') : '…' },
    { href: '#/calendar', icon: 'calendar', label: 'Calendar', sub: data ? `${data.upcoming.length} this week` : '…' },
    { href: '#/projects', icon: 'projects', label: 'Projects', sub: projects ? `${activeProjects} active` : '…' },
    { href: '#/resources', icon: 'resources', label: 'Library', sub: resources ? `${toRead} to read` : '…' },
    { href: '#/insights', icon: 'insights', label: 'Insights', sub: data ? `${data.streak}-day streak` : '…' },
  ];

  return (
    <div className="home">
      <section className="card hero">
        <div className="hero-text">
          <div className="eyebrow"><Icon name={period === 'morning' || period === 'afternoon' ? 'sun' : 'moon'} />{greet}</div>
          <h1 className="hero-title">Welcome back,<br /><Typewriter text={name || 'friend'} speed={110} className="hero-name" /></h1>
          <div className="hero-date">{data ? fmtLong(data.today) : ' '}</div>
          <div className="hero-clock"><Clock tz={settings?.timezone} /></div>
        </div>
        <div className="hero-mascot">
          <div className="bubble">{bubble}</div>
          <Mascot size={136} />
        </div>
      </section>

      <QuickAdd defaults={data ? { scheduled_date: data.today } : {}} autoFocus placeholder="Type a task and press Enter…  e.g. “Finish experiments by Friday 5pm !high”" />

      <nav className="tiles" aria-label="Sections">
        {tiles.map((t, i) => (
          <a key={t.href} href={t.href} className="tile" style={{ '--i': i }}>
            <Icon name={t.icon} className="tile-icon" />
            <span className="tile-label">{t.label}</span>
            <span className="tile-sub">{t.sub}</span>
          </a>
        ))}
      </nav>

      <section className="card glance">
        <div className="glance-row">
          <span className="lbl">Today</span>
          <PixelBar value={done} max={total || 1} label="Today's progress" />
          <span className="fig"><CountUp value={done} /> / {total}</span>
        </div>
        <div className="glance-row">
          <span className="lbl">Week goal</span>
          <PixelBar value={data?.week.done || 0} max={data?.week.goal || 1} color="var(--green)" label="Weekly goal" />
          <span className="fig"><CountUp value={data?.week.done || 0} /> / {data?.week.goal ?? '–'}</span>
        </div>
        <div className="glance-row">
          <span className="lbl">Streak</span>
          <span className="streak"><Icon name="flame" className="flame" /><CountUp value={data?.streak || 0} /> {data?.streak === 1 ? 'day' : 'days'}</span>
          <span className="fig muted">{data?.streak ? 'keep it alive' : 'complete a task to start'}</span>
        </div>
        {nextUp && (
          <button type="button" className="nextup" onClick={() => openTask(nextUp.id)}>
            <span className="lbl">Next up</span>
            <span className="nextup-title">{nextUp.title}</span>
            <span className="nextup-when">{nextUp.due_at ? relDateTime(nextUp.due_at, data.today) : nextUp.start_time ? fmtTime(nextUp.start_time) : 'today'}</span>
            <Icon name="right" />
          </button>
        )}
      </section>

      <p className="press-start"><Icon name="play" className="blink" />Type a task and press Enter, or pick a section above</p>
    </div>
  );
}
