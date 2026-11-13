import { useState } from 'react';
import { useApp, useData } from '../store.jsx';
import { api } from '../api.js';
import { Icon, Empty } from '../components/ui.jsx';
import TaskList from '../components/TaskList.jsx';
import { fmtDay, fmtShort } from '../lib/dates.js';

const PRIORITY_COLOR = { Critical: 'var(--p-critical)', High: 'var(--p-high)', Medium: 'var(--p-medium)', Low: 'var(--p-low)' };

function niceTop(max) {
  if (max <= 4) return { top: Math.max(4, max), step: 1 };
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => max / s <= 4) || 100;
  return { top: Math.ceil(max / step) * step, step };
}

/** Single-series column chart: tasks completed per day. Hover tooltip, hairline grid, labels only on the peak. */
function Columns({ data }) {
  const [hover, setHover] = useState(null);
  const W = 640; const H = 180; const padL = 26; const padR = 6; const padT = 14; const padB = 22;
  const max = Math.max(...data.map((d) => d.done), 0);
  const { top, step } = niceTop(max);
  const slot = (W - padL - padR) / data.length;
  const bw = Math.min(24, slot - 2);
  const x = (i) => padL + i * slot + (slot - bw) / 2;
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const peak = max > 0 ? data.findLastIndex((d) => d.done === max) : -1;
  const bar = (i, v) => { const h = y(0) - y(v); const r = Math.min(4, h); const x0 = x(i); return `M${x0},${y(0)} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`; };
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tasks completed per day over the last 30 days">
      <g className="grid">{ticks.map((t) => <line key={t} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />)}</g>
      <line className="axis" x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} />
      {ticks.map((t) => <text key={t} x={padL - 6} y={y(t) + 3.5} textAnchor="end">{t}</text>)}
      {data.map((d, i) => (
        <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <rect className="hit" x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} />
          {d.done > 0 && <path className={`bar ${hover != null && hover !== i ? 'dim' : ''}`} d={bar(i, d.done)} />}
          {((i % 7 === 0 && i < data.length - 3) || i === data.length - 1) && <text x={x(i) + bw / 2} y={H - 6} textAnchor="middle">{fmtDay(d.date)}</text>}
          {i === peak && hover == null && <text className="label" x={x(i) + bw / 2} y={y(d.done) - 5} textAnchor="middle">{d.done}</text>}
        </g>
      ))}
      {hover != null && (() => { const d = data[hover]; const tx = Math.min(Math.max(x(hover) + bw / 2, 60), W - 60); const ty = Math.max(y(d.done) - 30, 2); return (
        <g className="tip" pointerEvents="none"><rect x={tx - 56} y={ty} width={112} height={22} /><text x={tx} y={ty + 15} textAnchor="middle">{fmtShort(d.date)} · {d.done} done</text></g>
      ); })()}
    </svg>
  );
}

function Stat({ icon, label, value, delta, hero }) {
  return <div className={`stat ${hero ? 'hero' : ''}`}><div className="label"><Icon name={icon} />{label}</div><div className="value">{value}</div>{delta && <div className="delta">{delta}</div>}</div>;
}

function MeterRow({ name, done, total, suffix = '' }) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return <div className="meter-row"><span className="name">{name}</span><span className="fig">{total ? `${done} / ${total}${suffix} · ${pct}%` : 'No tasks in range'}</span><div className="meter"><i style={{ width: `${pct}%` }} /></div></div>;
}

export default function Insights() {
  const { today } = useApp();
  const { data: d, loading, error } = useData(api.insights);
  const td = today();
  if (!d) return <div className="loading">{error || 'Loading…'}</div>;
  const catMax = Math.max(1, ...d.by_category.map((c) => Math.max(c.done, c.open_count)));
  const openTotal = d.by_priority.reduce((n, p) => n + p.open_count, 0);
  const prio = ['Critical', 'High', 'Medium', 'Low'].map((p) => ({ p, n: d.by_priority.find((x) => x.priority === p)?.open_count || 0 }));

  return (
    <div className={loading ? 'fade' : ''}>
      <div className="page-head"><div><h1>Productivity Insights</h1><div className="sub">How consistently you are getting things done. No points, no pressure — just the picture.</div></div></div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat icon="check" label="Completed today" value={d.done_today} hero />
        <Stat icon="clock" label="Remaining today" value={d.remaining_today} />
        <Stat icon="alert" label="Overdue" value={d.overdue} delta={d.overdue ? 'Needs attention' : 'All caught up'} />
        <Stat icon="flame" label="Current streak" value={`${d.streak} day${d.streak === 1 ? '' : 's'}`} delta={`${d.completed_30d} completed in 30 days`} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-head"><h2><Icon name="target" />Goals & completion rates</h2></div>
          <MeterRow name="Weekly goal" done={d.weekly_goal.done} total={d.weekly_goal.goal} suffix=" tasks" />
          <MeterRow name={`This week (${fmtDay(d.week.start)} – ${fmtDay(d.week.end)})`} done={d.week.done} total={d.week.total} />
          <MeterRow name="This month" done={d.month.done} total={d.month.total} />
          <p className="muted small" style={{ marginTop: 8 }}>Completion rate = completed ÷ all tasks scheduled or due in the period.</p>
        </section>
        <section className="card">
          <div className="card-head"><h2><Icon name="flag" />Open tasks by priority</h2><span className="count">{openTotal} open</span></div>
          {openTotal ? (
            <>
              <div className="segbar" role="img" aria-label="Share of open tasks by priority">{prio.filter((x) => x.n).map((x) => <i key={x.p} style={{ width: `${(x.n / openTotal) * 100}%`, background: PRIORITY_COLOR[x.p] }} title={`${x.p}: ${x.n}`} />)}</div>
              <div className="seglist">{prio.map((x) => <div key={x.p}><i className={`dot prio-${x.p}`} /><span>{x.p}</span><span className="n">{x.n} · {Math.round((x.n / openTotal) * 100)}%</span></div>)}</div>
            </>
          ) : <Empty icon="sparkle" title="No open tasks" />}
        </section>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h2><Icon name="insights" />Tasks completed per day</h2><span className="count">last 30 days · {d.completed_30d} total</span></div>
        <Columns data={d.by_day} />
        <details className="table-view"><summary>Show as table</summary>
          <div className="table-scroll"><table className="data"><thead><tr><th>Date</th><th className="num">Completed</th></tr></thead><tbody>{d.by_day.filter((x) => x.done).reverse().map((x) => <tr key={x.date}><td>{fmtShort(x.date)}</td><td className="num">{x.done}</td></tr>)}</tbody></table></div>
        </details>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h2><Icon name="layers" />By category</h2><div className="legend"><span><i style={{ background: 'var(--chart-1)' }} />Completed (30 days)</span><span><i style={{ background: 'var(--chart-muted)' }} />Open now</span></div></div>
          {d.by_category.length ? (
            <div className="hbars">
              {d.by_category.map((c) => (
                <div key={c.category} className="hbar">
                  <span className="name">{c.category}</span>
                  <div className="bars">
                    <div className="b"><i style={{ width: `${(c.done / catMax) * 100}%` }} /><span>{c.done}</span></div>
                    <div className="b open"><i style={{ width: `${(c.open_count / catMax) * 100}%` }} /><span>{c.open_count}</span></div>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty title="No tasks yet" />}
        </section>
        <section className="card">
          <div className="card-head"><h2><Icon name="clock" />Upcoming deadlines</h2><span className="count">next 7 days</span></div>
          <TaskList tasks={d.upcoming} compact emptyText="No deadlines in the next week" emptyIcon="calendar" />
        </section>
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>Lifetime: {d.total_completed} completed · {d.total_open} open · as of {fmtShort(td)}.</p>
    </div>
  );
}
