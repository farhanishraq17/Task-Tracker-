// Small UI primitives: icons, modal, menu, fields, empty state, confirm button, shared enums.
import { useEffect, useRef, useState } from 'react';
import { gridPaths } from './pixel.jsx';

// Hand-drawn pixel icons ('#' = filled cell). Non-square grids are fine; the viewBox follows the grid.
const PIXEL = {
  home: ['....##....', '...####...', '..##..##..', '.##....##.', '##......##', '.#......#.', '.#..##..#.', '.#..##..#.', '.#..##..#.', '.########.'],
  dashboard: ['####.####', '#..#.#..#', '#..#.#..#', '####.####', '.........', '####.####', '#..#.#..#', '#..#.#..#', '####.####'],
  tasks: ['##.......', '##.######', '.........', '##.......', '##.######', '.........', '##.......', '##.######'],
  calendar: ['.#.....#.', '#########', '#.......#', '#########', '#.#.#.#.#', '#.#.#.#.#', '#########', '#.#.#...#', '#########'],
  projects: ['.........', '####.....', '#...#####', '#.......#', '#.......#', '#.......#', '#.......#', '#########'],
  resources: ['.#######.', '.#.....#.', '.#.....#.', '.#.....#.', '.#.....#.', '.#.....#.', '.#..#..#.', '.#.#.#.#.', '.##...##.'],
  insights: ['#........', '#......##', '#......##', '#...##.##', '#...##.##', '#.#.##.##', '#.#.##.##', '#.#.##.##', '#########'],
  settings: ['..##.....', '#########', '..##.....', '.........', '.....##..', '#########', '.....##..', '.........', '..##.....', '#########', '..##.....'],
  check: ['.......#', '......##', '.....##.', '#...##..', '##.##...', '.###....', '..#.....'],
  plus: ['...#...', '...#...', '...#...', '#######', '...#...', '...#...', '...#...'],
  x: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
  bell: ['....#....', '...###...', '..#...#..', '..#...#..', '..#...#..', '.#.....#.', '.#.....#.', '#########', '...###...'],
  flame: ['....#....', '...##....', '..###....', '..####...', '.#####.#.', '.####..##', '.###.####', '.########', '..######.', '...####..'],
  sparkle: ['....#....', '....#....', '..#.#.#..', '...###...', '#########', '...###...', '..#.#.#..', '....#....', '....#....'],
  sun: ['....#....', '.#..#..#.', '..#####..', '..#...#..', '###...###', '..#...#..', '..#####..', '.#..#..#.', '....#....'],
  moon: ['...####..', '..##.....', '.##......', '.##......', '.##......', '.##......', '..##.....', '...####..'],
  alert: ['....#....', '....#....', '...#.#...', '...#.#...', '..#.#.#..', '..#.#.#..', '.#.....#.', '.#..#..#.', '#########'],
  clock: ['..#####..', '.#.....#.', '#...#...#', '#...#...#', '#...##..#', '#.......#', '#.......#', '.#.....#.', '..#####..'],
  search: ['..###....', '.#...#...', '#.....#..', '#.....#..', '#.....#..', '.#...#...', '..###.#..', '.....###.', '......##.'],
  trash: ['...###...', '#########', '.#.....#.', '.#.#.#.#.', '.#.#.#.#.', '.#.#.#.#.', '.#.#.#.#.', '.#.....#.', '.#######.'],
  left: ['...#...', '..#....', '.#.....', '#######', '.#.....', '..#....', '...#...'],
  right: ['...#...', '....#..', '.....#.', '#######', '.....#.', '....#..', '...#...'],
  down: ['.......', '#.....#', '.#...#.', '..#.#..', '...#...', '.......', '.......'],
  arrow: ['...#...', '....#..', '.....#.', '#######', '.....#.', '....#..', '...#...'],
  play: ['#......', '###....', '#####..', '#######', '#####..', '###....', '#......'],
  target: ['..#####..', '.#.....#.', '#..###..#', '#.#...#.#', '#.#.#.#.#', '#.#...#.#', '#..###..#', '.#.....#.', '..#####..'],
  inbox: ['#########', '#.......#', '#.......#', '#.......#', '##.....##', '#.#####.#', '#.......#', '#.......#', '#########'],
  grip: ['#.#', '...', '#.#', '...', '#.#'],
  repeat: ['.######.#', '#......##', '........#', '.........', '.........', '#........', '##......#', '#.######.', '.........'],
  more: ['.........', '.........', '.........', '.........', '##..##..#', '##..##..#', '.........', '.........', '.........'],
  diamond: ['....#....', '...###...', '..#####..', '.#######.', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  flag: ['#........', '#######..', '#......#.', '#......#.', '#######..', '#........', '#........', '#........', '#........'],
  link: ['..###....', '.#...#...', '#..#..#..', '#.#.#.#..', '#..#..#..', '.#...#...', '..###....'],
  paperclip: ['.###.....', '#...#....', '#...#....', '#.#.#....', '#.#.#....', '#.#.#....', '#...#....', '#####....'],
  copy: ['######...', '#....#...', '#..######', '#..#....#', '#..#....#', '####....#', '...#....#', '...######'],
  edit: ['......##.', '.....#..#', '....#..#.', '...#..#..', '..#..#...', '.#..#....', '##.#.....', '####.....'],
  external: ['.....####', '.......##', '......#.#', '.....#..#', '....#....', '#####....', '#...#....', '#...#....', '#####....'],
  download: ['....#....', '....#....', '....#....', '..#.#.#..', '...###...', '....#....', '.........', '#########'],
  upload: ['....#....', '...###...', '..#.#.#..', '....#....', '....#....', '....#....', '.........', '#########'],
  refresh: ['..#####..', '.#.....#.', '#.......#', '........#', '.....####', '......##.', '.......#.', '.........', '.........'],
  layers: ['....#....', '..#####..', '#########', '..#####..', '....#....', '..#####..', '#########', '..#####..', '....#....'],
  file: ['######...', '#....##..', '#....###.', '#......#.', '#......#.', '#......#.', '#......#.', '########.'],
  globe: ['..#####..', '.#..#..#.', '#...#...#', '#########', '#...#...#', '#...#...#', '.#..#..#.', '..#####..'],
  book: ['.#######.', '##......#', '#.#.....#', '#.#.....#', '#.#.....#', '#.#.....#', '##......#', '.#######.'],
  mail: ['#########', '##.....##', '#.#...#.#', '#..#.#..#', '#...#...#', '#.......#', '#########'],
  message: ['.#######.', '#.......#', '#.......#', '#.......#', '.#######.', '..#......', '.#.......', '#........'],
  monitor: ['#########', '#.......#', '#.......#', '#.......#', '#########', '....#....', '..#####..'],
  zap: ['....##...', '...##....', '..##.....', '.#####...', '....##...', '...##....', '..##.....'],
  archive: ['#########', '#.......#', '#########', '.#.....#.', '.#.###.#.', '.#.....#.', '.#.....#.', '.#######.'],
  pause: ['##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##'],
  database: ['.#######.', '#.......#', '.#######.', '#.......#', '.#######.', '#.......#', '.#######.'],
  circle: ['..###..', '.#...#.', '#.....#', '#.....#', '#.....#', '.#...#.', '..###..'],
  tasksq: ['#########', '#.......#', '#......##', '#.....##.', '#.#..##.#', '#.####..#', '#..##...#', '#.......#', '#########'],
};

const pixelCache = new Map();
function pixelPath(name) {
  if (!pixelCache.has(name)) {
    const rows = PIXEL[name];
    pixelCache.set(name, { d: gridPaths(rows)['#'] || '', w: Math.max(...rows.map((r) => r.length)), h: rows.length });
  }
  return pixelCache.get(name);
}

export function Icon({ name, className = '', ...rest }) {
  const px = pixelPath(PIXEL[name] ? name : 'circle');
  return (
    <svg className={`icon ${className}`} viewBox={`0 0 ${px.w} ${px.h}`} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true" {...rest}>
      <path d={px.d} />
    </svg>
  );
}

export function Modal({ title, onClose, children, footer, className = '' }) {
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', f);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', f); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="lbl">{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** <select> helper. options: array of strings or [value, label] pairs. */
export function Select({ value, onChange, options, placeholder, className = '', ...rest }) {
  return (
    <select className={`input ${className}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
    </select>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <button key={v} type="button" className={v === value ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>; })}
    </div>
  );
}

export function Empty({ icon = 'inbox', title, hint, children }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      {title && <b>{title}</b>}
      {hint && <span>{hint}</span>}
      {children}
    </div>
  );
}

/** Dropdown menu. items: [{ label, icon, onClick, danger, confirm }] or 'sep' or { heading }. `confirm` items need a second click. */
export function Menu({ items, trigger = <Icon name="more" />, className = '' }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) { setArmed(null); return undefined; }
    const f = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open]);
  return (
    <div className={`menu ${className}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="More actions" aria-expanded={open}>{trigger}</button>
      {open && (
        <div className="menu-list" role="menu">
          {items.filter(Boolean).map((it, i) => it === 'sep' ? <div key={i} className="sep" /> : it.heading ? <div key={i} className="label">{it.heading}</div> : (
            <button key={i} type="button" role="menuitem" className={it.danger ? 'danger' : ''}
              onClick={() => { if (it.confirm && armed !== i) { setArmed(i); return; } setOpen(false); it.onClick(); }}>
              {it.icon && <Icon name={it.icon} />}{armed === i ? 'Click again to confirm' : it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Button that asks for a second click to confirm (no browser dialogs). */
export function Confirm({ onConfirm, children, label = 'Confirm?', className = 'btn btn-danger', disabled }) {
  const [arm, setArm] = useState(false);
  useEffect(() => { if (!arm) return undefined; const t = setTimeout(() => setArm(false), 3000); return () => clearTimeout(t); }, [arm]);
  return (
    <button type="button" className={className} disabled={disabled} onClick={(e) => { e.stopPropagation(); if (arm) { setArm(false); onConfirm(); } else setArm(true); }}>
      {arm ? label : children}
    </button>
  );
}

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
export const CATEGORIES = ['Academics', 'Research', 'Projects', 'Personal', 'Learning', 'Other'];
export const STATUSES = ['Not Started', 'In Progress', 'Completed'];
export const PROJECT_STATUSES = ['Active', 'On Hold', 'Completed', 'Archived'];
export const RESOURCE_CATEGORIES = ['Video', 'Playlist', 'Website', 'Paper', 'Blog', 'Documentation', 'Course', 'Other'];
export const RESOURCE_STATUSES = ['To Watch', 'To Read', 'In Progress', 'Completed'];
export const PROJECT_COLORS = ['#5b4bd6', '#2a78d6', '#1baf7a', '#eda100', '#ff7a52', '#e34948', '#e87ba4', '#6b6b78'];
