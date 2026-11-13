// App-wide state: settings, toasts, the task editor, a refresh counter, and small hooks (routing, data fetching).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { todayIn, nowIn } from './lib/dates.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// ---- hash routing: #/path?query ----
export function useHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const f = () => setHash(window.location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return useMemo(() => {
    const [path, query = ''] = (hash.replace(/^#/, '') || '/').split('?');
    return { path, params: Object.fromEntries(new URLSearchParams(query)) };
  }, [hash]);
}
export const navigate = (path) => { window.location.hash = path; };

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [editing, setEditing] = useState(null); // { id } | { draft } | null
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message, kind = 'info', extra = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, message, kind, ...extra }]);
    if (kind !== 'reminder') setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3200);
    return id;
  }, [dismiss]);

  const reloadSettings = useCallback(async () => {
    try { setSettings(await api.settings.get()); setError(null); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { reloadSettings(); }, [reloadSettings]);

  // Theme: resolve "system" to the OS preference and stamp data-theme so CSS needs only one dark block.
  const theme = settings?.theme;
  useEffect(() => {
    const t = theme || (() => { try { return localStorage.getItem('theme'); } catch { return null; } })() || 'system';
    try { localStorage.setItem('theme', t); } catch { /* private mode */ }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = t === 'system' ? (mq.matches ? 'dark' : 'light') : t; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const tz = settings?.timezone;
  const types = settings?.activity_types || [];
  const value = {
    settings, reloadSettings, error,
    types,
    typeColor: (name) => types.find((t) => t.name === name)?.color || 'var(--ink-3)',
    toasts, toast, dismiss,
    editing,
    openTask: useCallback((id) => setEditing({ id }), []),
    newTask: useCallback((draft = {}) => setEditing({ draft }), []),
    closeTask: useCallback(() => setEditing(null), []),
    version, refresh,
    today: () => todayIn(tz),
    now: () => nowIn(tz),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Fetch tied to the global refresh counter. Keeps previous data while reloading (no skeleton flash). */
export function useData(fetcher, deps = []) {
  const { version } = useApp();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const ref = useRef(fetcher);
  ref.current = fetcher;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    ref.current()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e) => alive && setState((s) => ({ data: s.data, loading: false, error: e.message })));
    return () => { alive = false; };
  }, [...deps, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** Run a mutation: toast on failure, refresh all data on success. Resolves to the result, or undefined on failure. */
export function useMutate() {
  const { toast, refresh } = useApp();
  return useCallback(async (fn, successMessage) => {
    try {
      const r = await fn();
      if (successMessage) toast(successMessage);
      refresh();
      return r;
    } catch (e) {
      toast(e.message, 'error');
      return undefined;
    }
  }, [toast, refresh]);
}
