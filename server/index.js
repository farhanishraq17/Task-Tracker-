import './env.js'; // must stay first: loads .env before other modules read process.env
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES_DIR, DB_PATH, getSettings, db } from './db.js';
import { applyTimezone, nowLocal } from './time.js';
import tasks from './tasks.js';
import projects from './projects.js';
import { resources, collections } from './resources.js';
import insights from './insights.js';
import data from './data.js';
import settings from './settings.js';
import { sseHandler, emailConfigured, whatsappConfigured } from './notify.js';
import { startScheduler } from './scheduler.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // local-only by default
const DIST = fileURLToPath(new URL('../client/dist/', import.meta.url));

applyTimezone(getSettings().timezone);

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

app.use('/api/tasks', tasks);
app.use('/api/projects', projects);
app.use('/api/resources', resources);
app.use('/api/collections', collections);
app.use('/api/settings', settings);
app.use('/api/data', data);
app.use('/api', insights); // /api/dashboard, /api/insights, /api/calendar
app.get('/api/events', sseHandler);
app.use('/api', (req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.path}` }));

app.use('/files', express.static(FILES_DIR));
app.use(express.static(DIST));
app.get(/.*/, (req, res) => {
  const index = path.join(DIST, 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.status(503).type('text').send('The interface has not been built yet. Run: npm run build  (or start.bat)');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(PORT, HOST, () => {
    console.log(`\n  Productivity Command Center`);
    console.log(`  → http://localhost:${PORT}`);
    console.log(`  Database: ${DB_PATH}`);
    console.log(`  Timezone: ${process.env.TZ} (server time ${nowLocal().replace('T', ' ')})`);
    console.log(`  Email: ${emailConfigured() ? 'configured' : 'not configured'} · WhatsApp: ${whatsappConfigured() ? `configured (${process.env.WHATSAPP_PROVIDER})` : 'not configured'}`);
    console.log(`  Reminder engine: running (checks every 30s)\n`);
    startScheduler();
  });
  const shutdown = () => { try { db.close(); } catch { /* already closed */ } process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
}
