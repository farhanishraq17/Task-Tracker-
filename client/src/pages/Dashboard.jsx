import { useApp, useData, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { Icon } from '../components/ui.jsx';
import { PixelBar, CountUp } from '../components/pixel.jsx';
import TaskList from '../components/TaskList.jsx';
import QuickAdd from '../components/QuickAdd.jsx';
import { fmtLong } from '../lib/dates.js';

export default function Dashboard() {
  const { newTask } = useApp();
  const { data, loading, error } = useData(api.dashboard);
  const mutate = useMutate();
  if (!data) return <div className="loading">{error || 'Loading…'}</div>;

  const total = data.tasks_today.length;
  const open = data.tasks_today.filter((t) => t.status !== 'Completed');
  const done = total - open.length;
  const parts = [
    open.length ? `${open.length} task${open.length === 1 ? '' : 's'} left today` : total ? 'Everything done for today' : 'Nothing planned yet',
    data.overdue.length ? `${data.overdue.length} overdue` : null,
    `${data.week.done} of ${data.week.goal} this week`,
  ].filter(Boolean);

  return (
    <div className={loading ? 'fade' : ''}>
      <div className="page-head">
        <div>
          <div className="lbl">Dashboard</div>
          <h1>{fmtLong(data.today)}</h1>
          <div className="sub">{parts.join(' · ')}</div>
        </div>
        <div className="actions"><button className="btn btn-primary" onClick={() => newTask({ scheduled_date: data.today })}><Icon name="plus" />New task</button></div>
      </div>

      <div className="progress-line">
        <PixelBar value={done} max={total || 1} label="Today's progress" />
        <span className="fig"><CountUp value={done} /> / {total} done</span>
      </div>

      <QuickAdd defaults={{ scheduled_date: data.today }} />

      <div className="dash">
        <section className="card">
          <div className="card-head"><h2>Today</h2><span className="count">{open.length} left</span></div>
          <TaskList tasks={data.tasks_today} onReorder={(ids) => mutate(() => api.tasks.reorder(ids))} showDate={false}
            emptyText="A clear day" emptyHint="Add what you want to accomplish today." emptyIcon="sparkle" />
        </section>
        <div className="stack">
          {data.overdue.length > 0 && (
            <section className="card">
              <div className="card-head"><h2 className="overdue"><Icon name="alert" />Needs attention</h2><span className="count">{data.overdue.length}</span></div>
              <TaskList tasks={data.overdue} compact />
            </section>
          )}
          <section className="card">
            <div className="card-head"><h2>Upcoming</h2><a href="#/tasks?tab=upcoming" className="small">All</a></div>
            <TaskList tasks={data.upcoming} compact emptyText="Nothing due this week" emptyIcon="calendar" />
          </section>
        </div>
      </div>
    </div>
  );
}
