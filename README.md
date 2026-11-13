# Productivity Command Center

A local-first personal productivity workspace that runs on your own PC at `http://localhost:3000`.
Tasks, projects, calendar, a resource library, productivity insights, and a **background reminder engine**
that keeps working while the browser is closed (Windows toasts, email, WhatsApp).

Everything is stored in a single SQLite file on your disk. No accounts, no cloud, no telemetry.

---

## Contents

1. [What it does](#what-it-does)
2. [Quick start (Windows)](#quick-start-windows)
3. [Running in the background / at startup](#running-in-the-background--at-startup)
4. [Configuration (.env)](#configuration-env)
5. [How reminders work](#how-reminders-work)
6. [Quick-add syntax](#quick-add-syntax)
7. [Data, backups, import & export](#data-backups-import--export)
8. [Architecture](#architecture)
9. [Development & tests](#development--tests)
10. [Troubleshooting](#troubleshooting)
11. [Known limitations](#known-limitations)
12. [Implementation checklist](#implementation-checklist)

---

## What it does

| Area | Highlights |
|---|---|
| **Home** | Pixel-art landing page: typed welcome with your name, live clock in your timezone, a blinking mascot with a status bubble, quick-add, tiles into every section, today's progress and streak. |
| **Dashboard** | Today's date and progress bar, today's tasks (drag to reorder), overdue "needs attention" list, upcoming 7 days, quick-add. |
| **My Tasks** | Views: Today · Next 7 days · This month · Overdue · No date · Completed · All. Search and filters (priority, category, project). Grouped by day. |
| **Task details** | Title, notes, scheduled day, start time, deadline, priority (Critical/High/Medium/Low), activity type, status, project, repeat rules (daily/weekly/monthly/custom), per-task reminders, subtasks, links, file attachments, WhatsApp opt-in. Duplicate, delete, reschedule. |
| **Activity types** | Your own list of activity types, each with a name and a color (Settings → Activity types). Colors show on every task, calendar pill and chart. Renaming keeps tasks attached; removing a type moves its tasks to "Other". |
| **Calendar** | Month / week / day views. Tasks, deadlines, milestones and project target dates. Drag a task to another day to reschedule. Overloaded days are flagged. |
| **Projects** | Long-term goals with description, start/target dates, status, color, milestones, linked tasks and resources, automatic progress %. |
| **Resource Library** | Save YouTube videos & playlists, papers, articles, docs, courses. Automatic title/thumbnail/description fetch, collections, tags, status (To Watch/To Read/In Progress/Completed), importance, search, link to a task or project. |
| **Insights** | Completed today, remaining, overdue, streak, weekly goal, weekly & monthly completion rate, completions per day (30 days), category breakdown, open tasks by priority, upcoming deadlines. |
| **Reminders** | Configurable offsets per task (e.g. 1 day, 3 h, 30 min before, at deadline, 1 h after). Browser notifications, native Windows toasts, email (SMTP), WhatsApp (Meta Cloud API or Twilio). Morning digest. Duplicate-proof. |
| **Settings** | Name, timezone, theme, weekly goal, task defaults, notification channels, digest time, export/import, backups & restore, notification log. |

---

## Quick start (Windows)

**Requirements:** [Node.js](https://nodejs.org) 22.13 or newer (the LTS installer is fine). Nothing else — the database engine is built into Node.

1. Download or clone this repository.
2. Double-click **`start.bat`**.
   It installs dependencies (first run only), builds the interface (first run only), starts the server and opens `http://localhost:3000`.
3. Keep the window open — it is the reminder engine. Press `Ctrl+C` to stop.

Manual equivalent:

```bat
npm install
npm run build
npm start
```

After pulling code changes, run `start.bat --rebuild` (or `npm run build`) once so the interface is rebuilt.

Your data lives in `data\app.db` (plus `data\backups\` and `data\files\`). The `data` folder is created automatically and is ignored by git.

---

## Running in the background / at startup

* **`start-background.vbs`** starts the server with no console window. Reminders keep firing while it runs.
* **`stop.bat`** stops it (kills whatever is listening on port 3000).
* **Start with Windows:** press `Win+R`, type `shell:startup`, press Enter, and put a shortcut to `start-background.vbs` in that folder.
  (Build the interface once with `start.bat` before relying on the background script.)

Desktop toasts only appear for the user whose session started the server, so prefer the startup-folder approach over a Task Scheduler job running as a different account.

---

## Configuration (.env)

All integrations are optional and configured through environment variables. Copy `.env.example` to `.env`, uncomment what you need, restart the server. **Never commit `.env`.**

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `HOST` | Bind address. `0.0.0.0` exposes the app to your local network (there is no login — keep it local unless you trust the network). | `127.0.0.1` |
| `DATA_DIR` | Where the database, backups and attachments live | `./data` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Outgoing mail server | — |
| `EMAIL_FROM`, `EMAIL_TO` | Sender / recipient | `SMTP_USER` |
| `WHATSAPP_PROVIDER` | `meta` or `twilio` | — |
| `WHATSAPP_TO` | Your WhatsApp number, international format (`+8801…`) | — |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` | Meta Cloud API credentials | `v21.0` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | Twilio credentials | — |

The Settings page shows whether each channel is configured and has a **Test** button for every channel.

### Email (Gmail example)

1. In your Google account enable 2-Step Verification, then create an **App Password** (Google Account → Security → App passwords).
2. In `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=you@gmail.com
   SMTP_PASS=the 16-character app password
   EMAIL_TO=you@gmail.com
   ```
3. Restart, open Settings → Notifications → Email → **Test**, then switch the channel on.

Any other SMTP provider (Outlook, university mail, Fastmail…) works the same way; use port 465 with `SMTP_SECURE=true` if your provider requires implicit TLS.

### WhatsApp — Option A: Meta WhatsApp Cloud API (free tier)

1. Create an app at <https://developers.facebook.com> → *Business* type → add the **WhatsApp** product.
2. In *WhatsApp → API Setup* note the **Phone number ID** and the test number; add your own number as a recipient and verify it.
3. Create a **permanent token**: Business Settings → System Users → add user → Generate token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions. (The temporary token on the API Setup page expires after 24 hours.)
4. In `.env`:
   ```
   WHATSAPP_PROVIDER=meta
   WHATSAPP_TOKEN=EAAG…
   WHATSAPP_PHONE_NUMBER_ID=1234567890
   WHATSAPP_TO=+8801XXXXXXXXX
   ```
5. **Important Meta rule:** a business number may send free-form text to you only inside a 24-hour window after *you* last messaged it. Send "hi" to the test number from your phone whenever the window has lapsed, or create an approved *message template* in Meta Business Manager. Reminders outside the window are rejected by Meta and show as *failed* in the Settings → Recent notifications log.

### WhatsApp — Option B: Twilio

1. Sign up at <https://www.twilio.com>, open *Messaging → Try it out → Send a WhatsApp message* and join the sandbox by sending the shown `join <word>` message from your phone.
2. In `.env`:
   ```
   WHATSAPP_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=AC…
   TWILIO_AUTH_TOKEN=…
   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   WHATSAPP_TO=+8801XXXXXXXXX
   ```
3. The sandbox has the same 24-hour session rule (re-send the join message if reminders start failing). A registered WhatsApp sender removes that limit.

---

## How reminders work

* The **reminder engine** runs inside the server process and checks every 30 seconds. It does not need the dashboard to be open.
* Every task with a **deadline** gets reminders at its offsets (its own list, or the defaults from Settings). `0` = at the deadline; negative offsets = after the deadline while the task is still incomplete ("you are falling behind").
* Tasks with a **start time** get a "Starting now" reminder.
* The optional **morning digest** (Settings → Notifications) summarises today's tasks and anything overdue.
* **Channels**
  * *Browser* — delivered live to any open dashboard tab (Server-Sent Events) as an in-app toast and, if you allowed it, a system notification.
  * *Windows desktop toast* — native notification sent by the server when **no dashboard tab is open**, so you never get the same reminder twice. Clicking it opens the task.
  * *Email* and *WhatsApp* — when configured and enabled. Per task you can choose whether WhatsApp is used; new tasks at or above the "minimum priority" in Settings get it automatically.
* **No duplicates:** every reminder is recorded per task, per offset, per channel in `notification_log`. Rescheduling a task re-arms its reminders. Failed deliveries are retried up to 3 times.
* **Nothing stale:** if the server was off when a reminder was due (older than 3 hours), it is logged as *missed* instead of being sent late. Overdue tasks stay highlighted on the dashboard regardless.
* Settings → *Recent notifications* shows exactly what was sent, skipped or failed and why.

---

## Quick-add syntax

Type naturally into any quick-add box. The parsed result is previewed before you press Enter.

| You type | Result |
|---|---|
| `Finish the research paper experiments by Friday` | Scheduled Friday, deadline Friday at your default time (18:00 by default) |
| `Submit assignment tomorrow at 5pm !high #academics` | Tomorrow, start & deadline 17:00, High priority, Academics |
| `Read attention paper on Nov 20` / `20 Nov` / `2026-11-20` / `20/11` | That date |
| `Call advisor next monday` · `in 3 days` · `next week` · `tonight` · `eom` | Relative dates |
| `Plan sprint by 17:30` | Today, deadline 17:30 (a `by/before/until` time is a deadline; `at` is a start time) |
| `!critical` `!high` `!medium` `!low` | Priority |
| `#research` `#academics` `#projects` `#personal` `#learning` | Category |

Open any task to turn it into subtasks, attach files, set repeat rules or custom reminders.

---

## Data, backups, import & export

* **Database:** `data/app.db` (SQLite, WAL mode, foreign keys on). Attachments: `data/files/`.
* **Automatic backups:** once per day while the server runs, keeping the 7 most recent in `data/backups/` (toggle in Settings).
* **Manual backup / restore:** Settings → Data. Restore replaces all current data and takes a *pre-restore* safety backup first. Uploaded files are validated (`PRAGMA integrity_check`) before anything is replaced.
* **Export:** full JSON (projects, milestones, tasks, subtasks, collections, resources, settings) and CSV for tasks and resources.
* **Import:** merges a JSON export. Rows that already exist (same title and creation time, same collection name, same resource URL) are skipped, so importing twice does not duplicate anything. An invalid row aborts the whole import with a message naming the task.
* **Timezone:** all dates are stored as local wall-clock values in your configured timezone, which defaults to this PC's clock (Asia/Dhaka on a Bangladesh-configured Windows), and the server process runs in that timezone. Change it in Settings.

---

## Architecture

```
server/               Node.js (ESM) + Express 5, no build step
  index.js            app wiring, static files, SPA fallback, startup
  db.js               node:sqlite connection, schema, settings, validators
  tasks.js            tasks, subtasks, attachments, recurrence, reorder
  projects.js         projects + milestones + progress
  resources.js        resource library, collections, URL metadata (YouTube oEmbed / Open Graph)
  insights.js         dashboard, insights, calendar aggregations
  data.js             export / import / backup / restore
  settings.js         settings, channel tests, notification log
  scheduler.js        reminder engine (30s tick), digest, auto-backup
  notify.js           browser (SSE), Windows toast (PowerShell/WinRT), email (nodemailer), WhatsApp (Meta/Twilio)
  time.js             wall-clock date helpers
  test.js             integration tests (node:test)
client/               React 19 + Vite, plain CSS (pixel design system, no UI framework)
  public/fonts/       bundled pixel fonts (Pixelify Sans, Silkscreen, VT323 — OFL) so the UI works offline
  src/App.jsx         shell, sidebar, hash routing, live reminders
  src/store.jsx       app state, data hook, mutations, activity-type colors
  src/pages/          Home · Dashboard · Tasks · Calendar · Projects · Resources · Insights · Settings
  src/components/     TaskItem · TaskList (drag & drop) · TaskEditor · QuickAdd · pixel.jsx (sprites, mascot, pixelated thumbnails, typewriter, clock, bars) · ui primitives (pixel icons)
  src/lib/            dates.js, quickparse.js (+ tests)
start.bat · start-background.vbs · stop.bat
```

**Why this stack.** The original repository was empty, so the stack was chosen for the smallest reliable footprint on a Windows PC:
one language (JavaScript), one runtime (Node), one process (API + static UI + scheduler), and SQLite through Node's built-in
`node:sqlite` module — no native build tools. Runtime dependencies are just `express` and `nodemailer`; the UI uses React
with hand-written CSS, native drag-and-drop, native date/time inputs and hand-drawn SVG charts.

**API** (all JSON under `/api`): `tasks`, `projects`, `resources`, `collections`, `settings`, `data/*`, `dashboard`, `insights`, `calendar`, `events` (SSE).

---

## Development & tests

```bat
npm run dev:server     # API on :3000 with auto-restart
npm run dev            # Vite dev server on :5173 with hot reload (proxies /api to :3000)
npm test               # 19 integration + unit tests against a throwaway database
```

Tests cover task CRUD, validation, recurrence, projects/milestones, resources/metadata parsing, attachments,
dashboard/insights/calendar, the reminder engine (dedupe, re-arm, stale skipping), export/import and backup/restore.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `start.bat` says Node is missing | Install Node.js ≥ 22.13 from nodejs.org and reopen the terminal. |
| "Port 3000 is already in use" | Run `stop.bat`, or set `PORT=3001` in `.env`. |
| Interface shows "has not been built yet" | Run `npm run build` (or `start.bat --rebuild`). |
| No Windows toasts | Check Windows *Notifications* and *Focus assist / Do not disturb*; make sure the server runs in your own user session; a dashboard tab being open suppresses toasts by design. |
| Browser notifications never appear | Settings → Notifications → **Allow**. If blocked earlier, allow them for `localhost` in the browser's site settings. |
| Email test fails | Use an app password, not your login password; check `SMTP_PORT`/`SMTP_SECURE`; some networks block port 587. |
| WhatsApp test fails with a 24-hour-window error | Message your business/sandbox number from your phone first (see WhatsApp setup). |
| Resource details don't fill in | Metadata needs internet access; the resource still saves with the URL and whatever you typed. |
| Times look shifted | Set your timezone in Settings (IANA name such as `Asia/Dhaka`). |

---

## Known limitations

* Browser notifications require a dashboard tab to be open (that is how browsers work without a push service). Windows toasts cover the closed-browser case.
* Windows toasts are implemented for Windows only (via PowerShell/WinRT). On other systems the channel is reported as unavailable.
* WhatsApp free-form messages are subject to Meta's 24-hour customer-service window (both providers). Reminders outside the window fail and are logged; use an approved template if you need unconditional delivery.
* There is no authentication: the server binds to `127.0.0.1` by default. Only change `HOST` on a network you trust.
* Attachments are stored on disk and are not included in the JSON export (back up `data/files/` or use the database backup, which stores metadata only).

---

## Implementation checklist

| Requirement | Status |
|---|---|
| Task CRUD, quick add, expand/edit, duplicate, delete, reschedule, complete | ✅ |
| Subtasks / checklists | ✅ |
| Priority, category, status, scheduled date, start time, deadline | ✅ |
| Links and file attachments | ✅ |
| Recurring tasks (daily, weekly with weekdays, monthly, custom interval) | ✅ next occurrence created on completion |
| Drag-and-drop reordering | ✅ native HTML5 DnD |
| Day / week / month task views | ✅ Tasks tabs + Calendar |
| Automatic overdue & upcoming detection | ✅ |
| Browser notifications | ✅ SSE + Notification API |
| Desktop notifications | ✅ native Windows toasts |
| Email notifications | ✅ SMTP via nodemailer, env-configured |
| WhatsApp notifications | ✅ Meta Cloud API or Twilio, env-configured, per-task opt-in |
| Per-task reminder offsets incl. after-deadline | ✅ |
| Background scheduler independent of the browser | ✅ in-process engine; background/startup scripts |
| Duplicate-notification protection | ✅ `notification_log` unique key + retry cap |
| Resource library with metadata, thumbnails, collections, tags, search, status, priority, task/project links | ✅ |
| Projects with milestones, linked tasks, progress %, status | ✅ |
| Calendar with daily/weekly/monthly views, milestones, rescheduling, overloaded-day flag | ✅ |
| Productivity insights (today, weekly/monthly rate, completions over time, categories, streak, deadlines) | ✅ |
| Settings (name, timezone, defaults, channels, theme, weekly goal) | ✅ |
| Persistent SQLite storage, backup/restore, JSON/CSV export, JSON import | ✅ |
| Asia/Dhaka timezone handling | ✅ configurable |
| Light & dark themes, responsive layout | ✅ |
| Pixel-art interface with animations, personal home page | ✅ bundled fonts, stepped borders, mascot, stepped motion |
| User-defined activity types with colors | ✅ Settings → Activity types |
| Windows startup script | ✅ `start.bat`, `start-background.vbs`, `stop.bat` |
| Tests | ✅ `npm test` |
