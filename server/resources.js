import { Router } from 'express';
import { db, bad, text, oneOf, idParam, parseJson } from './db.js';
import { nowLocal } from './time.js';
import { PRIORITIES } from './tasks.js';

export const RESOURCE_CATEGORIES = ['Video', 'Playlist', 'Website', 'Paper', 'Blog', 'Documentation', 'Course', 'Other'];
export const RESOURCE_STATUSES = ['To Watch', 'To Read', 'In Progress', 'Completed'];
export const RESOURCE_SELECT = `SELECT r.*, c.name AS collection_name, t.title AS task_title, p.name AS project_name
  FROM resources r LEFT JOIN collections c ON c.id = r.collection_id LEFT JOIN tasks t ON t.id = r.task_id LEFT JOIN projects p ON p.id = r.project_id`;

export function hydrateResources(rows) {
  for (const r of rows) r.tags = parseJson(r.tags, []);
  return rows;
}

const getResource = (id) => {
  const r = db.get(`${RESOURCE_SELECT} WHERE r.id = ?`, id);
  return r ? hydrateResources([r])[0] : null;
};

function clean(body, create = false) {
  if (!body || typeof body !== 'object') throw bad('Request body must be a JSON object');
  const out = {};
  if (create || 'url' in body) {
    const url = text(body.url, 2000, 'URL').trim();
    let u;
    try { u = new URL(url); } catch { throw bad('A valid URL is required (include https://)'); }
    if (!/^https?:$/.test(u.protocol)) throw bad('Only http(s) URLs are supported');
    out.url = url;
  }
  if ('title' in body) out.title = text(body.title, 500, 'Title').trim();
  if ('description' in body) out.description = text(body.description, 20000, 'Description');
  if ('category' in body) out.category = oneOf(body.category, RESOURCE_CATEGORIES, 'Category');
  if ('status' in body) out.status = oneOf(body.status, RESOURCE_STATUSES, 'Status');
  if ('priority' in body) out.priority = oneOf(body.priority, PRIORITIES, 'Priority');
  if ('tags' in body) {
    if (!Array.isArray(body.tags)) throw bad('Tags must be a list');
    out.tags = JSON.stringify([...new Set(body.tags.map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 30));
  }
  if ('thumbnail' in body) out.thumbnail = body.thumbnail ? text(body.thumbnail, 2000, 'Thumbnail') : null;
  if ('site_name' in body) out.site_name = body.site_name ? text(body.site_name, 200, 'Site name') : null;
  for (const [f, table, label] of [['collection_id', 'collections', 'Collection'], ['task_id', 'tasks', 'Task'], ['project_id', 'projects', 'Project']]) {
    if (!(f in body)) continue;
    if (body[f] == null || body[f] === '') { out[f] = null; continue; }
    const id = Number(body[f]);
    if (!Number.isInteger(id) || !db.get(`SELECT 1 FROM ${table} WHERE id = ?`, id)) throw bad(`${label} not found`);
    out[f] = id;
  }
  return out;
}

// ---------- metadata retrieval (internet-dependent, fails gracefully) ----------
const UA = 'Mozilla/5.0 (compatible; LocalBookmarkFetcher/1.0)';

export function youtubeInfo(u) {
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return { video: u.pathname.slice(1).split('/')[0] };
  if (host !== 'youtube.com') return null;
  const list = u.searchParams.get('list');
  if (u.pathname === '/playlist' && list) return { playlist: list };
  const v = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1];
  return v ? { video: v, playlist: list || undefined } : list ? { playlist: list } : {};
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  try { return e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m); } catch { return m; }
}).replace(/\s+/g, ' ').trim();

function metaTag(html, name) {
  const re = new RegExp(`<meta\\s+[^>]*?(?:property|name)\\s*=\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return '';
  const c = tag.match(/\scontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return c ? decodeEntities(c[1] ?? c[2]) : '';
}

export function guessCategory(u, title = '') {
  const h = u.hostname;
  const p = u.pathname.toLowerCase();
  if (/arxiv\.org|openreview\.net|semanticscholar|aclanthology|ieee\.org|springer|sciencedirect|nature\.com|acm\.org|researchgate|biorxiv|paperswithcode/.test(h) || p.endsWith('.pdf')) return 'Paper';
  if (/coursera|udemy|edx\.org|udacity|khanacademy|pluralsight|deeplearning\.ai|fast\.ai|classcentral/.test(h)) return 'Course';
  if (/^docs\.|readthedocs|developer\./.test(h) || /\/docs?(\/|$)/.test(p) || /\bdocumentation\b/i.test(title)) return 'Documentation';
  if (/medium\.com|substack\.com|dev\.to|hashnode|blog\./.test(h) || /\/blog(\/|$)/.test(p)) return 'Blog';
  return 'Website';
}

/** Pure HTML -> metadata parser (exported for tests). */
export function parseHtmlMeta(html, url) {
  const u = new URL(url);
  const title = metaTag(html, 'og:title') || metaTag(html, 'twitter:title') || decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '');
  let thumbnail = metaTag(html, 'og:image') || metaTag(html, 'twitter:image') || null;
  if (thumbnail) { try { thumbnail = new URL(thumbnail, url).href; } catch { thumbnail = null; } }
  return {
    url,
    title,
    description: metaTag(html, 'og:description') || metaTag(html, 'description') || metaTag(html, 'twitter:description') || '',
    thumbnail,
    site_name: metaTag(html, 'og:site_name') || u.hostname.replace(/^www\./, ''),
    category: guessCategory(u, title),
  };
}

async function fetchText(url, max = 1_500_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchMetadata(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw bad('Only http(s) URLs are supported');
  const yt = youtubeInfo(u);
  if (yt && (yt.video || yt.playlist)) {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } });
      if (res.ok) {
        const o = await res.json();
        return {
          url,
          title: o.title || '',
          description: o.author_name ? `by ${o.author_name}` : '',
          thumbnail: o.thumbnail_url || (yt.video ? `https://i.ytimg.com/vi/${yt.video}/hqdefault.jpg` : null),
          site_name: 'YouTube',
          category: yt.playlist && !yt.video ? 'Playlist' : 'Video',
        };
      }
    } catch { /* fall through to HTML parsing */ }
  }
  const meta = parseHtmlMeta(await fetchText(url), url);
  if (yt) meta.category = yt.playlist && !yt.video ? 'Playlist' : 'Video';
  return meta;
}

// ---------- routes ----------
export const resources = Router();

resources.get('/', (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.q) { where.push('(r.title LIKE ? OR r.description LIKE ? OR r.url LIKE ? OR r.tags LIKE ?)'); params.push(...Array(4).fill(`%${q.q}%`)); }
  for (const f of ['status', 'category', 'priority']) if (q[f]) { where.push(`r.${f} = ?`); params.push(String(q[f])); }
  for (const f of ['collection_id', 'task_id', 'project_id']) {
    if (q[f] === 'none') where.push(`r.${f} IS NULL`);
    else if (q[f]) { where.push(`r.${f} = ?`); params.push(Number(q[f])); }
  }
  if (q.tag) { where.push('r.tags LIKE ?'); params.push(`%${JSON.stringify(String(q.tag).toLowerCase())}%`); }
  const sql = `${RESOURCE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (r.status = 'Completed'), CASE r.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, r.id DESC LIMIT ?`;
  res.json(hydrateResources(db.all(sql, ...params, Math.min(Number(q.limit) || 1000, 5000))));
});

resources.get('/tags', (req, res) => {
  const counts = new Map();
  for (const row of db.all('SELECT tags FROM resources')) for (const t of parseJson(row.tags, [])) counts.set(t, (counts.get(t) || 0) + 1);
  res.json([...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)));
});

resources.post('/metadata', async (req, res) => {
  const url = text(req.body?.url, 2000, 'URL').trim();
  try { new URL(url); } catch { throw bad('A valid URL is required (include https://)'); }
  try {
    res.json(await fetchMetadata(url));
  } catch (e) {
    // Graceful: return what we know so the resource can still be saved offline.
    const u = new URL(url);
    res.json({ url, title: '', description: '', thumbnail: null, site_name: u.hostname.replace(/^www\./, ''), category: guessCategory(u), error: `Could not fetch metadata (${e.message})` });
  }
});

resources.post('/', (req, res) => {
  const v = clean(req.body, true);
  const now = nowLocal();
  const category = v.category ?? guessCategory(new URL(v.url));
  const status = v.status ?? (['Video', 'Playlist', 'Course'].includes(category) ? 'To Watch' : 'To Read');
  const result = db.run(`INSERT INTO resources (title, url, description, category, tags, status, priority, thumbnail, site_name, collection_id, task_id, project_id, completed_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    v.title || new URL(v.url).hostname.replace(/^www\./, ''), v.url, v.description ?? '', category, v.tags ?? '[]', status, v.priority ?? 'Medium',
    v.thumbnail ?? null, v.site_name ?? null, v.collection_id ?? null, v.task_id ?? null, v.project_id ?? null, status === 'Completed' ? now : null, now, now);
  res.status(201).json(getResource(Number(result.lastInsertRowid)));
});

resources.patch('/:id', (req, res) => {
  const id = idParam(req.params.id);
  const existing = getResource(id);
  if (!existing) throw bad('Resource not found', 404);
  const v = clean(req.body);
  if (v.status && v.status !== existing.status) v.completed_at = v.status === 'Completed' ? nowLocal() : null;
  if ('title' in v && !v.title) delete v.title; // never blank a title
  const keys = Object.keys(v);
  if (keys.length) db.run(`UPDATE resources SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => v[k]), nowLocal(), id);
  res.json(getResource(id));
});

resources.delete('/:id', (req, res) => {
  if (!db.run('DELETE FROM resources WHERE id = ?', idParam(req.params.id)).changes) throw bad('Resource not found', 404);
  res.json({ ok: true });
});

// ---------- collections ----------
export const collections = Router();

const collectionRows = () => db.all(`SELECT c.*, (SELECT COUNT(*) FROM resources r WHERE r.collection_id = c.id) AS count,
  (SELECT COUNT(*) FROM resources r WHERE r.collection_id = c.id AND r.status = 'Completed') AS done FROM collections c ORDER BY c.name`);

collections.get('/', (req, res) => res.json(collectionRows()));

collections.post('/', (req, res) => {
  const name = text(req.body?.name, 120, 'Collection name').trim();
  if (!name) throw bad('Collection name is required');
  if (db.get('SELECT 1 FROM collections WHERE name = ? COLLATE NOCASE', name)) throw bad('A collection with that name already exists');
  db.run('INSERT INTO collections (name, description, created_at) VALUES (?,?,?)', name, text(req.body?.description, 2000, 'Description'), nowLocal());
  res.status(201).json(collectionRows());
});

collections.patch('/:id', (req, res) => {
  const id = idParam(req.params.id);
  const c = db.get('SELECT * FROM collections WHERE id = ?', id);
  if (!c) throw bad('Collection not found', 404);
  const name = 'name' in (req.body || {}) ? text(req.body.name, 120, 'Collection name').trim() : c.name;
  if (!name) throw bad('Collection name is required');
  if (db.get('SELECT 1 FROM collections WHERE name = ? COLLATE NOCASE AND id != ?', name, id)) throw bad('A collection with that name already exists');
  db.run('UPDATE collections SET name = ?, description = ? WHERE id = ?', name, 'description' in (req.body || {}) ? text(req.body.description, 2000, 'Description') : c.description, id);
  res.json(collectionRows());
});

collections.delete('/:id', (req, res) => {
  if (!db.run('DELETE FROM collections WHERE id = ?', idParam(req.params.id)).changes) throw bad('Collection not found', 404);
  res.json(collectionRows()); // resources keep existing with collection_id = NULL
});
