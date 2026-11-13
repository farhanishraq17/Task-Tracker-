// Pixel-art building blocks: sprites from text grids, the mascot, pixelated thumbnails,
// a typewriter, a stepped count-up, a live clock and a segmented progress bar.
import { useEffect, useRef, useState } from 'react';

/** Turn rows like ['.##.', '#..#'] into one SVG path per character (runs of equal cells are merged). */
export function gridPaths(rows) {
  const paths = {};
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') { x++; continue; }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      paths[ch] = (paths[ch] || '') + `M${x} ${y}h${run}v1H${x}z`;
      x += run;
    }
  });
  return paths;
}

/** Crisp pixel sprite. `palette` maps grid characters to colors; unknown characters use currentColor. */
export function Sprite({ rows, palette = {}, size = 64, className = '', style, title }) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const paths = gridPaths(rows);
  return (
    <svg className={className} style={style} viewBox={`0 0 ${w} ${h}`} width={size} height={(size * h) / w} shapeRendering="crispEdges"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {Object.entries(paths).map(([ch, d]) => <path key={ch} d={d} fill={palette[ch] || 'currentColor'} />)}
    </svg>
  );
}

// ---- the mascot: a pixel cat that bobs and blinks ----
const CAT = { K: '#1f1d2b', B: '#f3a953', S: '#d4873a', W: '#fffdf7', P: '#1f1d2b', N: '#ff8fa3', C: '#ffd9a8' };
const CAT_OPEN = [
  '.KK........KK.',
  '.KBK......KBK.',
  '.KBSK....KSBK.',
  '.KBBBKKKKBBBK.',
  'KBBBBBBBBBBBBK',
  'KBBWWBBBBWWBBK',
  'KBBWPBBBBPWBBK',
  'KBBBBBCCBBBBBK',
  'KBBBBBNNBBBBBK',
  '.KBBBBBBBBBBK.',
  '.KSBBBBBBBBSK.',
  '..KKKKKKKKKK..',
];
const CAT_CLOSED = CAT_OPEN.map((r, i) => (i === 5 ? 'KBBBBBBBBBBBBK' : i === 6 ? 'KBBKKBBBBKKBBK' : r));

export function Mascot({ size = 112, className = '' }) {
  return (
    <div className={`mascot ${className}`} style={{ width: size }}>
      <Sprite rows={CAT_OPEN} palette={CAT} size={size} className="mascot-frame open" title="Pixel cat mascot" />
      <Sprite rows={CAT_CLOSED} palette={CAT} size={size} className="mascot-frame closed" />
      <i className="mascot-shadow" />
    </div>
  );
}

/** Draws an image into a tiny canvas (cover-fit, 16:9) that CSS scales up with pixelated rendering. */
export function PixelImage({ src, alt = '', pixels = 80, className = '', onError }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      if (!alive || !c) return;
      c.width = pixels;
      c.height = Math.round((pixels * 9) / 16);
      const target = c.width / c.height;
      let sx = 0; let sy = 0; let sw = img.naturalWidth; let sh = img.naturalHeight;
      if (sw / sh > target) { sw = Math.round(sh * target); sx = Math.round((img.naturalWidth - sw) / 2); } else { sh = Math.round(sw / target); sy = Math.round((img.naturalHeight - sh) / 2); }
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      c.dataset.ready = '1';
    };
    img.onerror = () => { if (alive) onError?.(); };
    img.src = src;
    return () => { alive = false; };
  }, [src, pixels, onError]);
  return <canvas ref={ref} className={`pixel-img ${className}`} role={alt ? 'img' : undefined} aria-label={alt || undefined} />;
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Types `text` one character at a time with a blinking block cursor. */
export function Typewriter({ text, speed = 90, className = '', cursor = true }) {
  const [n, setN] = useState(() => (reduceMotion() ? text.length : 0));
  useEffect(() => {
    if (reduceMotion()) { setN(text.length); return undefined; }
    setN(0);
    let i = 0;
    const t = setInterval(() => { i++; setN(i); if (i >= text.length) clearInterval(t); }, speed);
    return () => clearInterval(t);
  }, [text, speed]);
  return <span className={className}>{text.slice(0, n)}{cursor && <span className="cursor" aria-hidden="true" />}</span>;
}

/** Steps a number from its previous value to the new one (12 discrete steps). */
export function useCountUp(target, duration = 600) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target || reduceMotion()) { setV(target); return undefined; }
    const steps = 12;
    let i = 0;
    const t = setInterval(() => { i++; setV(Math.round(from + (target - from) * (i / steps))); if (i >= steps) clearInterval(t); }, duration / steps);
    return () => clearInterval(t);
  }, [target, duration]);
  return v;
}
export function CountUp({ value, className }) { return <span className={className}>{useCountUp(Number(value) || 0)}</span>; }

/** Live HH:MM:SS clock in the configured timezone with a blinking colon. */
export function Clock({ tz }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  let parts;
  try { parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now); } catch { parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now); }
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '--';
  return <span className="clock" aria-label="Current time"><span>{get('hour')}</span><span className="colon">:</span><span>{get('minute')}</span><span className="colon">:</span><span className="sec">{get('second')}</span></span>;
}

/** Segmented pixel progress bar. */
export function PixelBar({ value = 0, max = 1, color, className = '', label }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`pxbar ${className}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-label={label}>
      <i style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}
