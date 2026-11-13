import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from './quickparse.js';

const T = '2026-11-13'; // a Friday
const p = (s) => parseQuickAdd(s, { today: T });

test('deadline by weekday (same weekday = today)', () => {
  const r = p('Finish the research paper experiments by Friday');
  assert.equal(r.title, 'Finish the research paper experiments');
  assert.equal(r.scheduled_date, '2026-11-13');
  assert.equal(r.due_at, '2026-11-13T18:00');
  const withTime = p('Finish experiments by Friday 5pm');
  assert.equal(withTime.due_at, '2026-11-13T17:00');
  assert.equal(withTime.start_time, null, 'a time after a "by" date is a deadline, not a start time');
  assert.equal(p('Lab meeting Friday 3pm').start_time, '15:00', 'a bare time without a deadline word is a start time');
});

test('tomorrow + time + priority + category', () => {
  assert.deepEqual(p('Submit assignment tomorrow at 5pm !high #academics'),
    { title: 'Submit assignment', scheduled_date: '2026-11-14', due_at: '2026-11-14T17:00', start_time: '17:00', priority: 'High', category: 'Academics' });
});

test('month day / day month / rolls into next year when past', () => {
  assert.equal(p('Read attention paper on Nov 20').scheduled_date, '2026-11-20');
  assert.equal(p('Renew passport 5 January').scheduled_date, '2027-01-05');
  assert.equal(p('Renew passport 5 January').title, 'Renew passport');
});

test('next monday, in N days, next week', () => {
  assert.equal(p('Call advisor next monday').scheduled_date, '2026-11-16');
  assert.equal(p('Call advisor monday').scheduled_date, '2026-11-16');
  assert.equal(p('Pay rent in 3 days').scheduled_date, '2026-11-16');
  assert.equal(p('Plan next week').scheduled_date, '2026-11-16');
});

test('iso date and 24h "by" time is a deadline, not a start time', () => {
  const r = p('Plan sprint on 2026-12-01 by 17:30');
  assert.equal(r.due_at, '2026-12-01T17:30');
  assert.equal(r.start_time, null);
  assert.equal(r.title, 'Plan sprint');
});

test('text without dates stays intact; bare numbers are not times', () => {
  assert.deepEqual(p('Buy 3 notebooks'), { title: 'Buy 3 notebooks', scheduled_date: null, due_at: null, start_time: null, priority: null, category: null });
  assert.equal(p('Read chapter 5').title, 'Read chapter 5');
});

test('time only defaults to today; D/M dates', () => {
  const r = p('Standup 9:30am');
  assert.equal(r.due_at, '2026-11-13T09:30');
  assert.equal(r.start_time, '09:30');
  assert.equal(p('Dentist 25/12').scheduled_date, '2026-12-25');
});
