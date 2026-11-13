// Thin fetch wrapper over the local API. Every call resolves to parsed JSON or throws Error(message).
const isBinary = (b) => b instanceof Blob || b instanceof ArrayBuffer;

async function req(method, url, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (isBinary(body)) init.body = body;
    else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  }
  let res;
  try { res = await fetch(url, init); } catch { throw new Error('Cannot reach the local server. Is it running?'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  dashboard: () => req('GET', '/api/dashboard'),
  insights: () => req('GET', '/api/insights'),
  calendar: (from, to) => req('GET', `/api/calendar${qs({ from, to })}`),

  tasks: {
    list: (q) => req('GET', `/api/tasks${qs(q)}`),
    get: (id) => req('GET', `/api/tasks/${id}`),
    create: (b) => req('POST', '/api/tasks', b),
    update: (id, b) => req('PATCH', `/api/tasks/${id}`, b),
    remove: (id) => req('DELETE', `/api/tasks/${id}`),
    duplicate: (id) => req('POST', `/api/tasks/${id}/duplicate`),
    reorder: (ids) => req('PUT', '/api/tasks/reorder', { ids }),
    addSubtask: (id, title) => req('POST', `/api/tasks/${id}/subtasks`, { title }),
    updateSubtask: (id, sid, b) => req('PATCH', `/api/tasks/${id}/subtasks/${sid}`, b),
    removeSubtask: (id, sid) => req('DELETE', `/api/tasks/${id}/subtasks/${sid}`),
    upload: (id, file) => req('POST', `/api/tasks/${id}/attachments`, file, { 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) }),
    removeAttachment: (id, aid) => req('DELETE', `/api/tasks/${id}/attachments/${aid}`),
  },

  projects: {
    list: () => req('GET', '/api/projects'),
    get: (id) => req('GET', `/api/projects/${id}`),
    create: (b) => req('POST', '/api/projects', b),
    update: (id, b) => req('PATCH', `/api/projects/${id}`, b),
    remove: (id) => req('DELETE', `/api/projects/${id}`),
    addMilestone: (id, b) => req('POST', `/api/projects/${id}/milestones`, b),
    updateMilestone: (id, mid, b) => req('PATCH', `/api/projects/${id}/milestones/${mid}`, b),
    removeMilestone: (id, mid) => req('DELETE', `/api/projects/${id}/milestones/${mid}`),
  },

  resources: {
    list: (q) => req('GET', `/api/resources${qs(q)}`),
    tags: () => req('GET', '/api/resources/tags'),
    metadata: (url) => req('POST', '/api/resources/metadata', { url }),
    create: (b) => req('POST', '/api/resources', b),
    update: (id, b) => req('PATCH', `/api/resources/${id}`, b),
    remove: (id) => req('DELETE', `/api/resources/${id}`),
  },

  collections: {
    list: () => req('GET', '/api/collections'),
    create: (b) => req('POST', '/api/collections', b),
    update: (id, b) => req('PATCH', `/api/collections/${id}`, b),
    remove: (id) => req('DELETE', `/api/collections/${id}`),
  },

  settings: {
    get: () => req('GET', '/api/settings'),
    update: (b) => req('PUT', '/api/settings', b),
    test: (channel) => req('POST', `/api/settings/test/${channel}`),
    activityTypes: (list) => req('PUT', '/api/settings/activity-types', list),
    notifications: () => req('GET', '/api/settings/notifications'),
  },

  data: {
    backups: () => req('GET', '/api/data/backups'),
    createBackup: () => req('POST', '/api/data/backups'),
    deleteBackup: (name) => req('DELETE', `/api/data/backups/${encodeURIComponent(name)}`),
    restore: (name) => req('POST', '/api/data/restore', { name }),
    restoreFile: (file) => req('POST', '/api/data/restore', file, { 'Content-Type': 'application/octet-stream' }),
    import: (json) => req('POST', '/api/data/import', json),
  },
};
