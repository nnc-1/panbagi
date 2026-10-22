import type { Cond, El, Paint, Spec } from './spec';
import { LIMITS } from './spec';
import type { Values } from './params';

export interface AssetData {
  mime: string;
  bytes: Uint8Array;
}
export interface FontRef {
  family: string;
  weight: number;
}
export interface Composed {
  svg: string;
  width: number;
  height: number;
  fonts: FontRef[];
}

type Vars = Record<string, string | number | boolean>;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: unknown, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24}|(rgb|hsl)a?\([0-9.,%\s/-]+\))$/;
const safeColor = (c: unknown, d: string) => (typeof c === 'string' && COLOR.test(c.trim()) ? c.trim() : d);

const parsedSvg = new WeakMap<Uint8Array, { open: string; inner: string; vb: string } | null>();

/**
 * Split a (sanitised) SVG asset into root attributes and inner markup so it can be inlined as a
 * nested <svg>. resvg re-parses every `data:image/svg+xml` image as a separate document, which
 * cost ~35ms per icon; inlining it avoids that.
 */
function splitSvg(bytes: Uint8Array) {
  if (parsedSvg.has(bytes)) return parsedSvg.get(bytes)!;
  const text = new TextDecoder().decode(bytes);
  const m = /<svg\b([^>]*)>([\s\S]*)<\/svg\s*>\s*$/i.exec(text.trim());
  let out: { open: string; inner: string; vb: string } | null = null;
  if (m) {
    const attrs = m[1].replace(/\/\s*$/, '');
    const get = (n: string) => new RegExp(`\\s${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(' ' + attrs);
    const vbm = get('viewBox');
    const wm = get('width'), hm = get('height');
    const num2 = (x: RegExpExecArray | null) => parseFloat(x?.[1] ?? x?.[2] ?? '');
    const vb = vbm ? (vbm[1] ?? vbm[2]) : Number.isFinite(num2(wm)) && Number.isFinite(num2(hm)) ? `0 0 ${num2(wm)} ${num2(hm)}` : '';
    // keep namespace declarations (xlink etc.), drop geometry attributes we set ourselves
    const keep = attrs
      .replace(/\s(x|y|width|height|viewBox|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, '')
      .replace(/\sxmlns\s*=\s*("[^"]*"|'[^']*')/i, '');
    // Inlined assets share one document, so give each asset's ids a content-based prefix:
    // two icons that both define id="a" (common in exported SVGs) must not pick up each other's gradients.
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    const p = `a${(h >>> 0).toString(36)}-`;
    const inner = m[2]
      .replace(/(\sid\s*=\s*)(["'])([^"']+)\2/gi, `$1$2${p}$3$2`)
      .replace(/url\(\s*(['"]?)#([^)'"]+)\1\s*\)/gi, `url(#${p}$2)`)
      .replace(/(\s(?:xlink:)?href\s*=\s*)(["'])#([^"']+)\2/gi, `$1$2#${p}$3$2`);
    out = { open: keep, inner, vb };
  }
  parsedSvg.set(bytes, out);
  return out;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Resolve `switch` / `steps` bindings to a plain value. */
export function bind(v: any, vars: Vars): any {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('switch' in v && v.cases) {
      const k = String(vars[v.switch]);
      return bind(k in v.cases ? v.cases[k] : v.default, vars);
    }
    if ('steps' in v && Array.isArray(v.stops)) {
      const n = Number(vars[v.steps]);
      let pick = v.default;
      let best = -Infinity;
      for (const s of v.stops) if (n >= s.gte && s.gte > best) ((best = s.gte), (pick = s.value));
      return bind(pick, vars);
    }
  }
  return v;
}

export function test(c: Cond | undefined, vars: Vars): boolean {
  if (!c) return true;
  if ('and' in c) return c.and.every((x) => test(x, vars));
  if ('or' in c) return c.or.some((x) => test(x, vars));
  if ('not' in c) return !test(c.not, vars);
  const v = vars[c.param];
  const n = Number(v);
  if (c.eq !== undefined && String(v) !== String(c.eq)) return false;
  if (c.ne !== undefined && String(v) === String(c.ne)) return false;
  if (c.lt !== undefined && !(n < c.lt)) return false;
  if (c.lte !== undefined && !(n <= c.lte)) return false;
  if (c.gt !== undefined && !(n > c.gt)) return false;
  if (c.gte !== undefined && !(n >= c.gte)) return false;
  if (c.in !== undefined && !c.in.map(String).includes(String(v))) return false;
  return true;
}

const comma = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** `{name}`, `{name|comma}`, `{name|or:없음}` substitution. Unknown names become empty. */
export function interpolate(t: string, vars: Vars): string {
  return t.replace(/\{([^{}]+)\}/g, (_, expr: string) => {
    const [name, ...filters] = expr.split('|');
    const key = name.trim();
    let v: string = String(vars[key] ?? (/^-?\d+(\.\d+)?$/.test(key) ? key : '')); // {75|pct:150} works with plain numbers too
    for (const f of filters) {
      const [fn, ...rest] = f.split(':');
      const arg = rest.join(':');
      if (fn === 'comma' && v !== '' && !isNaN(Number(v))) v = comma(Number(v));
      else if (fn === 'or' && v === '') v = arg;
      else if (fn === 'upper') v = v.toUpperCase();
      else if (fn === 'bool' && v !== '') v = v === 'true' ? arg.split('/')[0] : (arg.split('/')[1] ?? '');
      else if (fn === 'pct' && v !== '' && !isNaN(Number(v))) {
        // {hp|pct:maxhp} -> "30%": the argument is a param name or a number (default 100); a zero/missing max gives 0%
        const a = arg.trim();
        const max = Number(a === '' ? 100 : a in vars ? vars[a] : a);
        v = (Number.isFinite(max) && max > 0 ? Math.round(Math.min(1, Math.max(0, Number(v) / max)) * 100) : 0) + '%'; // same 0..100% as a bar
      }
    }
    return v;
  });
}

/** Rough text width in em: CJK/fullwidth = 1, digits & caps ~0.62, other latin ~0.55. */
export function estimateEm(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x2e80 || (c >= 0xff00 && c <= 0xffef)) w += 1;
    else if (ch === ' ') w += 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += 0.62;
    else if (/[il.,:;|!']/.test(ch)) w += 0.3;
    else w += 0.55;
  }
  return w;
}

export interface ComposeOptions {
  /** Replace the data: URI of a raster asset (the admin UI passes blob: URLs so previews stay fast). */
  imageHref?: (alias: string, asset: AssetData) => string | undefined;
  /** Text width in em from real font metrics (see metrics.ts); without it fitted text uses estimateEm. */
  measure?: (text: string, family: string, weight: number) => number;
}

export function composeSvg(spec: Spec, values: Values, assets: Map<string, AssetData>, opts: ComposeOptions = {}): Composed {
  const { canvas } = spec;
  const defs: string[] = [];
  const fonts = new Map<string, FontRef>();
  let uid = 0;
  let budget = LIMITS.maxElements * 2;

  const paint = (p: Paint | undefined, w: number, h: number, d: string): string => {
    if (p && typeof p === 'object' && 'gradient' in p) {
      const id = `g${uid++}`;
      const [a, b] = p.gradient;
      const [x2, y2] = p.dir === 'h' ? [1, 0] : [0, 1];
      defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${safeColor(a, '#000')}"/><stop offset="1" stop-color="${safeColor(b, '#000')}"/></linearGradient>`);
      return `url(#${id})`;
    }
    return safeColor(p, d);
  };

  const wrapT = (e: any, x: number, y: number, w: number, h: number, inner: string): string => {
    const op = Math.min(1, Math.max(0, num(e.opacity, 1)));
    const rot = num(e.rotate, 0);
    const attrs: string[] = [];
    if (op < 1) attrs.push(`opacity="${fmt(op)}"`);
    if (rot) attrs.push(`transform="rotate(${fmt(rot)} ${fmt(x + w / 2)} ${fmt(y + h / 2)})"`);
    return attrs.length ? `<g ${attrs.join(' ')}>${inner}</g>` : inner;
  };

  const ratioOf = (v: unknown, vars: Vars): number => {
    const r = typeof v === 'string' && v in vars ? Number(vars[v]) : Number(v);
    return Number.isFinite(r) ? r : 0;
  };

  const renderEl = (raw: El, vars: Vars, depth: number): string => {
    if (--budget < 0) return '';
    if (!test(raw.when, vars)) return '';
    // Resolve all bindings on flat properties (children / when stay untouched).
    const e: any = {};
    for (const [k, v] of Object.entries(raw)) e[k] = k === 'children' || k === 'when' ? v : bind(v, vars);
    const x = num(e.x), y = num(e.y);

    switch (e.type) {
      case 'shape': {
        const w = num(e.w), h = num(e.h);
        const sw = num(e.strokeWidth, e.stroke ? 1 : 0);
        const stroke = e.stroke ? ` stroke="${safeColor(e.stroke, 'none')}" stroke-width="${fmt(sw)}"` : '';
        let el: string;
        if (e.shape === 'ellipse')
          el = `<ellipse cx="${fmt(x + w / 2)}" cy="${fmt(y + h / 2)}" rx="${fmt(w / 2)}" ry="${fmt(h / 2)}" fill="${paint(e.fill, w, h, 'none')}"${stroke}/>`;
        else if (e.shape === 'line')
          el = `<line x1="${fmt(x)}" y1="${fmt(y)}" x2="${fmt(x + w)}" y2="${fmt(y + h)}"${stroke || ' stroke="#000"'} stroke-linecap="round"/>`;
        else
          el = `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(num(e.radius))}" fill="${paint(e.fill, w, h, 'none')}"${stroke}/>`;
        return wrapT(e, x, y, w, h, el);
      }
      case 'image': {
        const asset = assets.get(String(e.asset ?? ''));
        if (!asset) return '';
        const w = num(e.w), h = num(e.h);
        const par = e.fit === 'stretch' ? 'none' : e.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
        const svgParts = asset.mime === 'image/svg+xml' ? splitSvg(asset.bytes) : null;
        let el: string;
        if (svgParts?.vb) {
          // nested <svg> clips to its own viewport, so `cover` needs no clipPath
          el = `<svg${svgParts.open} x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" viewBox="${esc(svgParts.vb)}" preserveAspectRatio="${par}">${svgParts.inner}</svg>`;
        } else {
          const href = opts.imageHref?.(String(e.asset ?? ''), asset) ?? `data:${asset.mime};base64,${b64(asset.bytes)}`;
          el = `<image x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="${par}" href="${href}"/>`;
          if (e.fit === 'cover') {
            const id = `c${uid++}`;
            defs.push(`<clipPath id="${id}"><rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}"/></clipPath>`);
            el = `<g clip-path="url(#${id})">${el}</g>`;
          }
        }
        return wrapT(e, x, y, w, h, el);
      }
      case 'text': {
        const text = interpolate(String(e.text ?? ''), vars).replace(/[\r\n]+/g, ' ');
        if (!text) return '';
        const family = String(e.font ?? '');
        const weight = num(e.weight, 400);
        let size = num(e.size, 16);
        const fit = e.fit === 'shrink' || e.fit === 'clip' ? e.fit : undefined;
        const h0 = num(e.h, size * 1.3); // a fitted text keeps its box height while the letters shrink
        if (e.maxWidth > 0) size = Math.min(size, (e.maxWidth / Math.max(estimateEm(text), 0.01)) * (1 + 0)); // shrink to fit
        if (size <= 0) return '';
        fonts.set(`${family}|${weight}`, { family, weight });
        const w = num(e.w, e.maxWidth || 0);
        let clip = fit === 'clip' && w > 0;
        if (fit === 'shrink' && w > 0) {
          const em = opts.measure?.(text, family, weight) ?? estimateEm(text);
          const gaps = num(e.letterSpacing) * Math.max(0, [...text].length - 1);
          const min = Math.max(1, num(e.minSize, 1));
          if (em * size + gaps > w) size = Math.max(min, Math.min(size, Math.floor(((w - gaps) / Math.max(em, 0.01)) * 100) / 100)); // floored: the svg keeps 2 decimals
          if (e.h > 0 && size * 1.2 > e.h) size = Math.max(min, e.h / 1.2);
          clip = em * size + gaps > w + 0.5; // still too wide at the smallest size: cut the rest
        }
        const h = fit ? h0 : num(e.h, size * 1.3);
        const align = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start';
        const tx = e.align === 'center' ? x + w / 2 : e.align === 'right' ? x + w : x;
        const ty = y + h / 2 + size * 0.35;
        const ls = e.letterSpacing ? ` letter-spacing="${fmt(num(e.letterSpacing))}"` : '';
        const ff = family ? ` font-family="${esc(family)}"` : '';
        let el = `<text x="${fmt(tx)}" y="${fmt(ty)}" font-size="${fmt(size)}" font-weight="${weight}" text-anchor="${align}" fill="${safeColor(e.fill, '#fff')}"${ff}${ls}>${esc(text)}</text>`;
        if (clip) {
          const id = `c${uid++}`;
          defs.push(`<clipPath id="${id}"><rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}"/></clipPath>`);
          el = `<g clip-path="url(#${id})">${el}</g>`;
        }
        if (w) return wrapT(e, x, y, w, h, el);
        // no width: turn around the estimated middle of the text, not its anchor point
        const ew = estimateEm(text) * size;
        return wrapT(e, align === 'middle' ? x - ew / 2 : align === 'end' ? x - ew : x, y, ew, h, el);
      }
      case 'bar': {
        const w = num(e.w), h = num(e.h);
        const max = ratioOf(e.max ?? 100, vars) || 1;
        const r = Math.min(1, Math.max(0, ratioOf(e.value, vars) / max));
        const rad = Math.min(num(e.radius), w / 2, h / 2);
        const track = `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(rad)}" fill="${paint(e.track, w, h, '#000')}"/>`;
        let fill = '';
        const fw = e.vertical ? w : w * r, fh = e.vertical ? h * r : h;
        if (r > 0) {
          const fy = e.vertical ? y + h - fh : y;
          fill = `<rect x="${fmt(x)}" y="${fmt(fy)}" width="${fmt(fw)}" height="${fmt(fh)}" rx="${fmt(Math.min(rad, fw / 2, fh / 2))}" fill="${paint(e.fill, fw, fh, '#4c4')}"/>`;
        }
        return wrapT(e, x, y, w, h, track + fill);
      }
      case 'group': {
        if (depth >= LIMITS.maxDepth) return '';
        const inner = (e.children ?? []).map((c: El) => renderEl(c, vars, depth + 1)).join('');
        return wrapT(e, x, y, 0, 0, `<g transform="translate(${fmt(x)} ${fmt(y)})">${inner}</g>`);
      }
      case 'repeat': {
        if (depth >= LIMITS.maxDepth) return '';
        const cap = Math.min(num(e.max, LIMITS.maxRepeat), LIMITS.maxRepeat);
        const n = Math.max(0, Math.min(cap, Math.floor(ratioOf(e.count, vars))));
        let out = '';
        const tpl = JSON.stringify(e.children ?? []);
        for (let i = 0; i < n; i++) {
          // `$i` inside any child string becomes the 1-based index, so `{a$i}` reads param a1, a2, ...
          const v2 = { ...vars, i: i + 1, i0: i };
          const kids: El[] = JSON.parse(tpl.replaceAll('$i', String(i + 1)));
          const inner = kids.map((c) => renderEl(c, v2, depth + 1)).join('');
          out += `<g transform="translate(${fmt(x + i * num(e.dx))} ${fmt(y + i * num(e.dy))})">${inner}</g>`;
        }
        return out;
      }
    }
    return '';
  };

  const body = spec.elements.map((el) => renderEl(el, values as Vars, 0)).join('');
  const { w, h } = canvas;
  const bg = canvas.background ? `<rect width="${w}" height="${h}" fill="${safeColor(canvas.background, 'none')}"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${bg}${body}</svg>`;
  return { svg, width: w, height: h, fonts: [...fonts.values()] };
}
