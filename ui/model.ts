// Spec editing helpers: element paths, bounding boxes for the canvas, param renames.
import { bind, estimateEm, interpolate, test, wrapLines } from '../src/compose';
import type { El, Spec } from '../src/spec';
import type { Values } from '../src/params';

export type Path = number[];

export const TYPE_LABEL: Record<El['type'], string> = {
  text: '글자',
  image: '이미지',
  shape: '도형',
  bar: '게이지',
  repeat: '반복',
  group: '그룹',
};

export const clone = <T>(v: T): T => structuredClone(v);
export const samePath = (a: Path | null, b: Path | null) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
export const isAncestor = (a: Path, b: Path) => a.length < b.length && a.every((x, i) => x === b[i]);

export function listAt(spec: Spec, parent: Path): El[] {
  let list = spec.elements;
  for (const i of parent) list = (list[i] as any).children;
  return list;
}

export function getAt(spec: Spec, path: Path): El | undefined {
  if (!path.length) return undefined;
  return listAt(spec, path.slice(0, -1))?.[path[path.length - 1]];
}

/** Returns a new spec with fn applied to the element at path. */
export function updateAt(spec: Spec, path: Path, fn: (e: any) => void): Spec {
  const s = clone(spec);
  const e = getAt(s, path);
  if (e) fn(e);
  return s;
}

export function removeAt(spec: Spec, path: Path): Spec {
  const s = clone(spec);
  listAt(s, path.slice(0, -1)).splice(path[path.length - 1], 1);
  return s;
}

export function insertAt(spec: Spec, parent: Path, index: number, el: El): { spec: Spec; path: Path } {
  const s = clone(spec);
  const list = listAt(s, parent);
  const i = Math.max(0, Math.min(index, list.length));
  list.splice(i, 0, el);
  return { spec: s, path: [...parent, i] };
}

/** Move element `from` to position `index` in `parent` (index counted before removal). */
export function moveTo(spec: Spec, from: Path, parent: Path, index: number): { spec: Spec; path: Path } | null {
  if (samePath(from, parent) || isAncestor(from, parent)) return null; // can't drop into itself
  const el = clone(getAt(spec, from)!);
  const fromParent = from.slice(0, -1);
  const fromIdx = from[from.length - 1];
  let s = removeAt(spec, from);
  // removing shifts later siblings (and the target parent path) up by one
  const adj = (p: Path) => {
    const q = [...p];
    if (q.length > fromParent.length && samePath(q.slice(0, fromParent.length), fromParent) && q[fromParent.length] > fromIdx) q[fromParent.length]--;
    return q;
  };
  const newParent = fromParent.length === 0 && parent.length === 0 ? [] : adj(parent);
  let i = index;
  if (samePath(newParent, fromParent) && fromIdx < index) i--;
  return insertAt(s, newParent, i, el);
}

export function newElement(type: El['type'], spec: Spec): El {
  const cx = Math.round(spec.canvas.w / 2 - 60), cy = Math.round(spec.canvas.h / 2 - 20);
  switch (type) {
    case 'text':
      return { type, name: '글자', x: cx, y: cy, w: 120, h: 32, text: '글자', size: 20, fill: '#ffffff' };
    case 'shape':
      return { type, name: '도형', x: cx, y: cy, w: 120, h: 60, radius: 8, fill: '#3a2a1e', stroke: '#d9b45b', strokeWidth: 2 };
    case 'image':
      return { type, name: '이미지', x: cx, y: cy, w: 48, h: 48, asset: Object.keys(spec.assets ?? {})[0] ?? '', fit: 'contain' };
    case 'bar': {
      const p = Object.entries(spec.params).find(([, d]) => d.type === 'number')?.[0];
      return { type, name: '게이지', x: cx, y: cy, w: 160, h: 12, radius: 6, value: p ?? 50, max: 100, fill: '#4fbf5a', track: '#0d0805' };
    }
    case 'repeat':
      return { type, name: '반복', x: cx, y: cy, count: 3, dx: 30, dy: 0, children: [{ type: 'shape', shape: 'ellipse', w: 24, h: 24, fill: '#e0b13c' }] };
    case 'group':
      return { type, name: '그룹', x: cx, y: cy, children: [] };
  }
}

/** a text element that wraps inside its box */
export function newTextBox(spec: Spec): El {
  const cx = Math.round(spec.canvas.w / 2 - 100), cy = Math.round(spec.canvas.h / 2 - 40);
  return { type: 'text', name: '글상자', x: cx, y: cy, w: 200, h: 80, text: '여러 줄 글상자예요. 박스 너비에 맞춰 줄이 바뀌어요.', size: 16, fill: '#ffffff', wrap: true };
}

export function elLabel(e: El): string {
  if (e.name) return e.name;
  if (e.type === 'text' && typeof e.text === 'string') return e.text.slice(0, 24) || '글자';
  if (e.type === 'image' && typeof e.asset === 'string') return e.asset || '이미지';
  return TYPE_LABEL[e.type];
}

// ---- boxes (canvas coordinates) ---------------------------------------------------------------

export interface Box {
  path: Path;
  /** unrotated box, before any rotation (canvas coordinates) */
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  /** where the box's center ends up once every rotation is applied, and its total angle (degrees) */
  cx: number;
  cy: number;
  rot: number;
  /** rotation inherited from enclosing groups (the element's own `rotate` excluded) */
  prot: number;
}

type Pt = (x: number, y: number) => [number, number];
const IDENT: Pt = (x, y) => [x, y];
/** rotate a point by `deg` around (cx, cy), the way SVG rotate(deg cx cy) does */
export function rotatePt(x: number, y: number, deg: number, cx: number, cy: number): [number, number] {
  if (!deg) return [x, y];
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Approximate layout of every element, in drawing order. Children of repeat use the first copy. */
export function layout(spec: Spec, values: Values): Box[] {
  const out: Box[] = [];
  // tf maps this level's (unrotated) canvas coordinates to the final picture; rot is the angle it adds
  const walk = (els: El[], base: Path, ox: number, oy: number, vars: Values, visible: boolean, tf: Pt, rot: number): { x0: number; y0: number; x1: number; y1: number } | null => {
    let u: { x0: number; y0: number; x1: number; y1: number } | null = null;
    const grow = (b: { x: number; y: number; w: number; h: number }) => {
      u = u ? { x0: Math.min(u.x0, b.x), y0: Math.min(u.y0, b.y), x1: Math.max(u.x1, b.x + b.w), y1: Math.max(u.y1, b.y + b.h) } : { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
    };
    // the element's own rotation turns around its center, so the center itself only moves with the parents
    const place = (path: Path, b: { x: number; y: number; w: number; h: number }, vis: boolean, own: number, map: Pt = tf, base = rot): Box => {
      const [cx, cy] = map(b.x + b.w / 2, b.y + b.h / 2);
      return { path, ...b, visible: vis, cx, cy, rot: base + own, prot: rot };
    };
    els.forEach((raw, i) => {
      const path = [...base, i];
      const vis = visible && test(raw.when, vars as any);
      const e: any = {};
      for (const [k, v] of Object.entries(raw)) e[k] = k === 'children' || k === 'when' ? v : bind(v, vars as any);
      const x = ox + n(e.x), y = oy + n(e.y);
      const own = e.type === 'repeat' ? 0 : n(e.rotate);
      let b: Box;
      if (e.type === 'group' || e.type === 'repeat') {
        const idx = out.length;
        out.push(place(path, { x, y, w: 0, h: 0 }, vis, own));
        let kids = e.children ?? [];
        let vars2 = vars;
        if (e.type === 'repeat') {
          kids = JSON.parse(JSON.stringify(kids).replaceAll('$i', '1'));
          vars2 = { ...vars, i: 1, i0: 0 };
        }
        // a group turns around its own x, y (that is what the engine does)
        const inner: Pt = own ? (px, py) => tf(...rotatePt(px, py, own, x, y)) : tf;
        const cu = walk(kids, path, x, y, vars2, vis, inner, rot + own);
        let bx = cu ? { x: cu.x0, y: cu.y0, w: cu.x1 - cu.x0, h: cu.y1 - cu.y0 } : { x, y, w: 0, h: 0 };
        if (e.type === 'repeat' && cu) {
          const cnt = Math.max(1, Math.min(64, Math.floor(typeof e.count === 'string' ? Number(vars[e.count]) || 1 : n(e.count, 1))));
          const dx = n(e.dx) * (cnt - 1), dy = n(e.dy) * (cnt - 1);
          bx = { x: Math.min(bx.x, bx.x + dx), y: Math.min(bx.y, bx.y + dy), w: bx.w + Math.abs(dx), h: bx.h + Math.abs(dy) };
        }
        b = out[idx] = place(path, bx, vis, 0, inner, rot + own);
      } else if (e.type === 'text') {
        const size = n(e.size, 16);
        const text = interpolate(String(e.text ?? ''), vars as any);
        const est = estimateEm(text) * size;
        let w = n(e.w, n(e.maxWidth, 0));
        let bx = x;
        if (!w) {
          w = est;
          if (e.align === 'center') bx = x - w / 2;
          else if (e.align === 'right') bx = x - w;
        }
        // a text box without h grows with its (estimated) lines
        const autoH = e.wrap ? wrapLines(text, n(e.w), size, n(e.letterSpacing), estimateEm).length * size * n(e.lineHeight, 1.3) : size * 1.3;
        b = place(path, { x: bx, y, w: Math.max(w, 4), h: n(e.h, autoH) }, vis, own);
        out.push(b);
      } else {
        let bb = { x, y, w: n(e.w), h: n(e.h) };
        if (e.shape === 'line') bb = { x: Math.min(x, x + bb.w), y: Math.min(y, y + bb.h), w: Math.abs(bb.w) || 2, h: Math.abs(bb.h) || 2 };
        b = place(path, bb, vis, own);
        out.push(b);
      }
      if (vis) grow(b);
    });
    return u;
  };
  walk(spec.elements, [], 0, 0, values, true, IDENT, 0);
  return out;
}

/** Is the point inside the box, rotation included? */
export function inBox(b: Box, x: number, y: number): boolean {
  const [lx, ly] = rotatePt(x, y, -b.rot, b.cx, b.cy);
  return Math.abs(lx - b.cx) <= b.w / 2 && Math.abs(ly - b.cy) <= b.h / 2;
}

/** Visible leaves under the point, topmost first (drawn last = on top). */
export function hitAll(boxes: Box[], x: number, y: number, spec: Spec): Path[] {
  const out: Path[] = [];
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    const e = getAt(spec, b.path);
    if (!b.visible || !e || e.type === 'group' || e.type === 'repeat') continue;
    if (inBox(b, x, y)) out.push(b.path);
  }
  return out;
}

export const hitTest = (boxes: Box[], x: number, y: number, spec: Spec): Path | null => hitAll(boxes, x, y, spec)[0] ?? null;

/** What a click at the point selects: the topmost element, or, when the selection is already under the point, the one below it (wrapping around). */
export function nextHit(boxes: Box[], x: number, y: number, spec: Spec, sel: Path | null): Path | null {
  const stack = hitAll(boxes, x, y, spec);
  const i = stack.findIndex((q) => samePath(q, sel));
  return stack[(i + 1) % stack.length] ?? null;
}

/** Offset of the element's own coordinate system (sum of parent group/repeat x, y). */
export function parentOffset(spec: Spec, path: Path): { x: number; y: number } {
  let x = 0, y = 0;
  for (let k = 1; k < path.length; k++) {
    const p: any = getAt(spec, path.slice(0, k));
    x += n(p?.x);
    y += n(p?.y);
  }
  return { x, y };
}

// ---- params -----------------------------------------------------------------------------------

/** Rename a parameter everywhere the spec refers to it. */
export function renameParam(spec: Spec, from: string, to: string): Spec {
  const s = clone(spec);
  const params: any = {};
  for (const [k, v] of Object.entries(s.params)) params[k === from ? to : k] = v;
  s.params = params;
  const re = new RegExp(`\\{(\\s*)${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*)(?=[|}])`, 'g');
  const fix = (v: any, key?: string): any => {
    if (typeof v === 'string') {
      if ((key === 'value' || key === 'max' || key === 'count' || key === 'switch' || key === 'steps' || key === 'param') && v === from) return to;
      return v.replace(re, `{$1${to}$2`);
    }
    if (Array.isArray(v)) return v.map((x) => fix(x));
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const [k, x] of Object.entries(v)) o[k] = fix(x, k);
      return o;
    }
    return v;
  };
  s.elements = s.elements.map((e) => fix(e));
  return s;
}

/** Names of params an element tree refers to (for warnings when deleting a param). */
export function usesParam(spec: Spec, name: string): boolean {
  const re = new RegExp(`\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[|}]`);
  const json = JSON.stringify(spec.elements);
  return re.test(json) || json.includes(`":"${name}"`);
}

export function defaultsOf(spec: Spec): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, d] of Object.entries(spec.params)) {
    if (d.type === 'enum') o[k] = d.default ?? d.options[0] ?? '';
    else if (d.type === 'bool') o[k] = d.default ? '1' : '0';
    else if (d.type === 'number') o[k] = String(d.default ?? d.min ?? 0);
    else o[k] = d.default ?? '';
  }
  return o;
}

export const BLANK_SPEC: Spec = {
  canvas: { w: 400, h: 160, background: '#1c130d' },
  params: { name: { type: 'text', default: '이름', maxLength: 12, desc: '캐릭터 이름' } },
  elements: [
    { type: 'shape', name: '배경', x: 0, y: 0, w: 400, h: 160, radius: 12, fill: '#2a1d14', stroke: '#d9b45b', strokeWidth: 2 },
    { type: 'text', name: '이름', x: 20, y: 16, w: 360, h: 36, text: '{name}', size: 24, weight: 700, fill: '#f3e6c4' },
  ],
};
