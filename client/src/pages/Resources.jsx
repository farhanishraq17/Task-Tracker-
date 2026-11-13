import { useEffect, useMemo, useState } from 'react';
import { useApp, useData, useMutate } from '../store.jsx';
import { api } from '../api.js';
import { Icon, Modal, Field, Select, Empty, Menu, PRIORITIES, RESOURCE_CATEGORIES, RESOURCE_STATUSES } from '../components/ui.jsx';
import { PixelImage } from '../components/pixel.jsx';

const catIcon = (c) => ({ Video: 'play', Playlist: 'layers', Paper: 'file', Documentation: 'book', Course: 'book', Blog: 'edit' }[c] || 'globe');

function Thumb({ resource }) {
  const [broken, setBroken] = useState(false);
  return resource.thumbnail && !broken ? <PixelImage src={resource.thumbnail} alt="" onError={() => setBroken(true)} /> : <Icon name={catIcon(resource.category)} />;
}

function ResourceEditor({ resource, collections, onClose, defaults = {} }) {
  const mutate = useMutate();
  const { toast } = useApp();
  const [f, setF] = useState(resource ? { ...resource, tags: resource.tags.join(', ') } : { url: '', title: '', description: '', category: 'Website', status: 'To Read', priority: 'Medium', tags: '', thumbnail: null, site_name: null, collection_id: null, project_id: null, task_id: null, ...defaults });
  const [fetching, setFetching] = useState(false);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  useEffect(() => {
    api.projects.list().then(setProjects).catch(() => {});
    api.tasks.list({ view: 'open', limit: 300 }).then(setTasks).catch(() => {});
  }, []);

  const fetchMeta = async () => {
    if (!f.url.trim()) return;
    let url = f.url.trim();
    if (!/^[a-z]+:\/\//i.test(url)) { url = `https://${url}`; set({ url }); }
    setFetching(true);
    try {
      const m = await api.resources.metadata(url);
      set({ title: f.title || m.title || '', description: f.description || m.description || '', thumbnail: m.thumbnail || f.thumbnail, site_name: m.site_name, category: resource ? f.category : m.category || f.category, status: resource ? f.status : (['Video', 'Playlist', 'Course'].includes(m.category) ? 'To Watch' : 'To Read') });
      if (m.error) toast(m.error, 'error');
    } catch (e) { toast(e.message, 'error'); }
    setFetching(false);
  };
  const save = async () => {
    const body = { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), collection_id: f.collection_id || null, project_id: f.project_id || null, task_id: f.task_id || null };
    const r = await mutate(() => (resource ? api.resources.update(resource.id, body) : api.resources.create(body)), resource ? 'Saved' : 'Resource saved');
    if (r) onClose();
  };
  return (
    <Modal title={resource ? 'Edit resource' : 'Save a resource'} onClose={onClose} className="wide" footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!f.url.trim()}>{resource ? 'Save' : 'Add to library'}</button></>}>
      <Field label="URL" hint="Paste a YouTube video/playlist, article, paper or any link. Details are fetched automatically when possible.">
        <div className="row">
          <input className="input grow" value={f.url} onChange={(e) => set({ url: e.target.value })} onBlur={() => !resource && !f.title && fetchMeta()} onPaste={() => setTimeout(fetchMeta, 50)} placeholder="https://…" autoFocus={!resource} onKeyDown={(e) => e.key === 'Enter' && fetchMeta()} />
          <button type="button" className="btn" onClick={fetchMeta} disabled={fetching || !f.url.trim()}><Icon name="refresh" />{fetching ? 'Fetching…' : 'Fetch details'}</button>
        </div>
      </Field>
      <div className="row top" style={{ gap: 14 }}>
        {f.thumbnail && <div style={{ width: 160, aspectRatio: '16/9', flex: 'none', background: 'var(--surface-2)' }}><PixelImage src={f.thumbnail} alt="" onError={() => set({ thumbnail: null })} /></div>}
        <div className="stack grow" style={{ gap: 10 }}>
          <Field label="Title"><input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="Title" /></Field>
          <Field label="Notes"><textarea className="input" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Why it matters, what to look for…" /></Field>
        </div>
      </div>
      <div className="grid grid-3">
        <Field label="Type"><Select value={f.category} onChange={(v) => set({ category: v })} options={RESOURCE_CATEGORIES} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(v) => set({ status: v })} options={RESOURCE_STATUSES} /></Field>
        <Field label="Importance"><Select value={f.priority} onChange={(v) => set({ priority: v })} options={PRIORITIES} /></Field>
      </div>
      <div className="grid grid-3">
        <Field label="Collection"><Select value={f.collection_id ?? ''} onChange={(v) => set({ collection_id: v ? Number(v) : null })} placeholder="None" options={collections.map((c) => [c.id, c.name])} /></Field>
        <Field label="Project"><Select value={f.project_id ?? ''} onChange={(v) => set({ project_id: v ? Number(v) : null })} placeholder="None" options={projects.map((p) => [p.id, p.name])} /></Field>
        <Field label="Task"><Select value={f.task_id ?? ''} onChange={(v) => set({ task_id: v ? Number(v) : null })} placeholder="None" options={tasks.map((t) => [t.id, t.title.length > 50 ? `${t.title.slice(0, 50)}…` : t.title])} /></Field>
      </div>
      <Field label="Tags" hint="Comma-separated, e.g. transformers, survey, must-read"><input className="input" value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="tag, another tag" /></Field>
    </Modal>
  );
}

export default function Resources() {
  const mutate = useMutate();
  const [collection, setCollection] = useState(''); // '' all | 'none' | id
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | resource
  const [newCol, setNewCol] = useState('');
  const [renaming, setRenaming] = useState(null);
  const query = { q: q.trim(), status, category, tag, collection_id: collection };
  const key = JSON.stringify(query);
  const { data, loading, error } = useData(() => api.resources.list(query), [key]);
  const { data: collections } = useData(api.collections.list);
  const { data: tags } = useData(api.resources.tags);
  const total = useMemo(() => (collections || []).reduce((n, c) => n + c.count, 0), [collections]);

  const addCollection = async () => { if (!newCol.trim()) return; const r = await mutate(() => api.collections.create({ name: newCol.trim() }), 'Collection created'); if (r) setNewCol(''); };
  const setStatusOf = (r, s) => mutate(() => api.resources.update(r.id, { status: s }), s === 'Completed' ? 'Marked completed' : undefined);

  return (
    <>
      <div className="page-head">
        <div><div className="lbl">Library</div><h1>Resource Library</h1><div className="sub">Videos, playlists, papers and articles to come back to.</div></div>
        <div className="actions"><button className="btn btn-primary" onClick={() => setEditing('new')}><Icon name="plus" />Save resource</button></div>
      </div>
      <div className="res-layout">
        <aside>
          <div className="side-list">
            <button className={collection === '' ? 'active' : ''} onClick={() => setCollection('')}><span>All resources</span></button>
            <button className={collection === 'none' ? 'active' : ''} onClick={() => setCollection('none')}><span>Uncollected</span></button>
          </div>
          <div className="side-title">Collections</div>
          <div className="side-list">
            {(collections || []).map((c) => (
              <div key={c.id} className="row" style={{ gap: 0 }}>
                {renaming?.id === c.id ? (
                  <input className="input sm grow" autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    onBlur={async () => { if (renaming.name.trim() && renaming.name !== c.name) await mutate(() => api.collections.update(c.id, { name: renaming.name.trim() })); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }} />
                ) : <button className={`grow ${String(collection) === String(c.id) ? 'active' : ''}`} onClick={() => setCollection(String(c.id))}><span>{c.name}</span><span className="n">{c.done}/{c.count}</span></button>}
                <Menu items={[{ label: 'Rename', icon: 'edit', onClick: () => setRenaming({ id: c.id, name: c.name }) }, { label: 'Delete collection', icon: 'trash', danger: true, confirm: true, onClick: () => mutate(() => api.collections.remove(c.id), 'Collection deleted (resources kept)').then(() => collection === String(c.id) && setCollection('')) }]} />
              </div>
            ))}
            <div className="add-inline"><Icon name="plus" /><input value={newCol} onChange={(e) => setNewCol(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCollection()} placeholder="New collection" aria-label="New collection name" /></div>
          </div>
          {tags?.length > 0 && (
            <>
              <div className="side-title">Tags</div>
              <div className="tagrow" style={{ padding: '0 6px' }}>{tags.slice(0, 30).map((t) => <button key={t.tag} className={`tag clickable ${tag === t.tag ? 'active' : ''}`} onClick={() => setTag(tag === t.tag ? '' : t.tag)}>{t.tag} · {t.count}</button>)}</div>
            </>
          )}
        </aside>

        <div>
          <div className="filters">
            <div className="search grow" style={{ maxWidth: 300 }}><Icon name="search" /><input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search resources" /></div>
            <Select className="auto" value={status} onChange={setStatus} options={RESOURCE_STATUSES} placeholder="Any status" />
            <Select className="auto" value={category} onChange={setCategory} options={RESOURCE_CATEGORIES} placeholder="Any type" />
            {(q || status || category || tag) && <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setStatus(''); setCategory(''); setTag(''); }}>Clear</button>}
          </div>
          {error && <div className="error-box">{error}</div>}
          {!data ? <div className="loading">Loading…</div> : !data.length ? (
            <div className="card"><Empty icon="resources" title={total ? 'No matches' : 'Your library is empty'} hint={total ? 'Try different filters.' : 'Save a YouTube playlist, a paper or a tutorial you want to come back to.'}>{!total && <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} onClick={() => setEditing('new')}>Save your first resource</button>}</Empty></div>
          ) : (
            <div className={`res-grid ${loading ? 'fade' : ''}`}>
              {data.map((r, i) => (
                <div key={r.id} className={`res-card ${r.status === 'Completed' ? 'done' : ''}`} style={{ '--i': i % 12 }}>
                  <a className="res-thumb" href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.title}`}>
                    <Thumb resource={r} />
                    <span className="cat">{r.category}</span>
                  </a>
                  <div className="res-body">
                    <a className="res-title" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                    <div className="res-site">{r.site_name || new URL(r.url).hostname}{r.collection_name ? ` · ${r.collection_name}` : ''}{r.project_name ? ` · ${r.project_name}` : ''}</div>
                    {r.description && <p className="res-desc">{r.description}</p>}
                    {r.tags.length > 0 && <div className="tagrow">{r.tags.map((t) => <button key={t} className={`tag clickable ${tag === t ? 'active' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>{t}</button>)}</div>}
                    <div className="res-foot">
                      <Select className="sm auto" value={r.status} onChange={(v) => setStatusOf(r, v)} options={RESOURCE_STATUSES} aria-label="Status" />
                      {(r.priority === 'Critical' || r.priority === 'High') && <Icon name="flag" className={`prio-${r.priority}`} title={`${r.priority} importance`} />}
                      <span className="grow" />
                      <Menu items={[
                        { label: 'Edit', icon: 'edit', onClick: () => setEditing(r) },
                        { label: 'Open link', icon: 'external', onClick: () => window.open(r.url, '_blank', 'noopener') },
                        r.status !== 'Completed' && { label: 'Mark completed', icon: 'check', onClick: () => setStatusOf(r, 'Completed') },
                        'sep',
                        { label: 'Delete', icon: 'trash', danger: true, confirm: true, onClick: () => mutate(() => api.resources.remove(r.id), 'Resource deleted') },
                      ]} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {editing && <ResourceEditor resource={editing === 'new' ? null : editing} collections={collections || []} defaults={collection && collection !== 'none' ? { collection_id: Number(collection) } : {}} onClose={() => setEditing(null)} />}
    </>
  );
}
