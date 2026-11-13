import { useApp, useData, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { Icon, Ring, Empty } from '../components/ui.jsx';
import TaskList from '../components/TaskList.jsx';
import QuickAdd from '../components/QuickAdd.jsx';
import { fmtLong } from '../lib/dates.js';

export default function Dashboard() {
  const { settings, newTask } = useApp();
  const { data, loading, error } = useData(api.dashboard);
  const mutate = useMutate();
  if (!data) return <div className="loading">{error || 'Loading your day…'}</div>;

  const total = data.tasks_today.length;
  const open = data.tasks_today.filter((t) => t.status !== 'Completed');
  const done = total - open.length;
  const hour = Number(data.now.slice(11, 13));
  const greet = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = settings?.display_name;
  const parts = [];
  if (open.length) parts.push(`${open.length} task${open.length === 1 ? '' : 's'} left today`);
  else if (total) parts.push('Everything for today is done');
  else parts.push('Nothing scheduled for today yet');
  if (data.overdue.length) parts.push(`${data.overdue.length} overdue`);
  if (data.upcoming.length) parts.push(`${data.upcoming.length} coming up this week`);

  return (
    <div className={loading ? 'fade' : ''}>
      <div className="page-head greeting">
        <div>
          <h1>{greet}{name ? `, ${name}` : ''}</h1>
          <div className="date">{fmtLong(data.today)}</div>
          <p className="summary">{parts.join(' · ')}.</p>
        </div>
        <div className="stat-row">
          <div className="stat row" style={{ gap: 12 }}>
            <Ring value={total ? done / total : 0} label={`${done}/${total}`} />
            <div><div className="label">Today</div><div className="value" style={{ fontSize: 18 }}>{total ? `${Math.round((done / total) * 100)}%` : '—'}</div></div>
          </div>
          <div className="stat">
            <div className="label"><Icon name="target" />This week</div>
            <div className="value">{data.week.done}<small>/ {data.week.goal} goal</small></div>
            <div className="meter thin" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, data.week.goal ? (data.week.done / data.week.goal) * 100 : 0)}%` }} /></div>
          </div>
          <div className="stat">
            <div className="label"><Icon name="flame" />Streak</div>
            <div className="value">{data.streak}<small>day{data.streak === 1 ? '' : 's'}</small></div>
            <div className="delta">{data.streak ? 'Keep it going' : 'Complete a task to start'}</div>
          </div>
        </div>
      </div>

      <QuickAdd defaults={{ scheduled_date: data.today }} />

      <div className="dash">
        <div className="stack">
          {data.overdue.length > 0 && (
            <section className="card">
              <div className="card-head"><h2 className="overdue"><Icon name="alert" />Needs attention <span className="count">{data.overdue.length} overdue</span></h2></div>
              <TaskList tasks={data.overdue} />
            </section>
          )}
          <section className="card">
            <div className="card-head">
              <h2>Today <span className="count">{open.length} left</span></h2>
              <button className="btn btn-ghost btn-sm" onClick={() => newTask({ scheduled_date: data.today })}><Icon name="plus" />Add</button>
            </div>
            <TaskList tasks={data.tasks_today} onReorder={(ids) => mutate(() => api.tasks.reorder(ids))} showDate={false}
              emptyText="A clear day" emptyHint="Add what you want to accomplish today using the box above." emptyIcon="sparkle" />
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Upcoming <span className="count">next 7 days</span></h2><a href="#/tasks?tab=upcoming" className="small">View all</a></div>
            <TaskList tasks={data.upcoming} compact emptyText="No deadlines this week" emptyIcon="calendar" />
          </section>
          <section className="card">
            <div className="card-head"><h2>Recently saved <span className="count">resources</span></h2><a href="#/resources" className="small">Library</a></div>
            {data.recent_resources.length ? data.recent_resources.map((r) => (
              <a key={r.id} className="res-mini" href={r.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                <div className="thumb">{r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : <Icon name={r.category === 'Video' || r.category === 'Playlist' ? 'play' : r.category === 'Paper' ? 'file' : 'globe'} />}</div>
                <div className="grow"><div className="t">{r.title}</div><div className="s">{r.site_name || r.category}{r.collection_name ? ` · ${r.collection_name}` : ''}</div></div>
              </a>
            )) : <Empty icon="resources" title="Nothing saved yet" hint="Save videos, papers and articles to read later." />}
          </section>
        </div>
      </div>
    </div>
  );
}
