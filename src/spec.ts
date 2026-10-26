// Template spec: canvas + parameter definitions + asset aliases + absolute-positioned elements.

export type Bindable<T> =
  | T
  | { switch: string; cases: Record<string, T>; default?: T }
  | { steps: string; stops: { gte: number; value: T }[]; default?: T };

export type Cond =
  | { param: string; eq?: string | number; ne?: string | number; lt?: number; lte?: number; gt?: number; gte?: number; in?: (string | number)[] }
  | { and: Cond[] }
  | { or: Cond[] }
  | { not: Cond };

export type Gradient = { gradient: [string, string]; dir?: 'v' | 'h' };
export type Paint = string | Gradient;

export type ParamDef =
  | { type: 'text'; default?: string; maxLength?: number; alias?: string[]; desc?: string }
  | { type: 'number'; default?: number; min?: number; max?: number; decimals?: number; alias?: string[]; desc?: string }
  | { type: 'enum'; options: string[]; default?: string; alias?: string[]; desc?: string }
  | { type: 'bool'; default?: boolean; alias?: string[]; desc?: string }
  // Not read from the address: rolled from the template's other values (and the address's `hash`), so the same address always draws the same result.
  // min/max may name a number param, so the chatbot can set the range (e.g. a d20) without choosing the roll.
  | { type: 'random'; min?: number | string; max?: number | string; options?: string[]; alias?: string[]; desc?: string };
// `desc` (and an element's `name`) are only for people: the admin UI shows them and puts `desc` in the chatbot prompt.

export interface Base {
  name?: string;
  when?: Cond;
  x?: Bindable<number>;
  y?: Bindable<number>;
  opacity?: Bindable<number>;
  rotate?: Bindable<number>;
}
export interface ShapeEl extends Base {
  type: 'shape';
  shape?: 'rect' | 'ellipse' | 'line';
  w?: Bindable<number>;
  h?: Bindable<number>;
  radius?: number;
  fill?: Bindable<Paint>;
  stroke?: Bindable<string>;
  strokeWidth?: number;
}
export interface ImageEl extends Base {
  type: 'image';
  asset: Bindable<string>;
  w: number;
  h: number;
  fit?: 'contain' | 'cover' | 'stretch';
}
export interface TextEl extends Base {
  type: 'text';
  text: Bindable<string>;
  w?: number;
  h?: number;
  font?: string;
  size?: Bindable<number>;
  weight?: number;
  fill?: Bindable<string>;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
  maxWidth?: number;
  /** what to do when the text is wider than w: shrink the size (down to minSize, then clip), or clip it */
  fit?: 'shrink' | 'clip';
  minSize?: number;
  /** text box: break lines inside w (at spaces, or anywhere in a word too long for a line), plus Enter / `\n` breaks; `fit` then works on the whole box (w and h) */
  wrap?: boolean;
  /** line height as a multiple of the size (default 1.3) */
  lineHeight?: number;
  /** where the lines sit inside h (default top) */
  valign?: 'top' | 'middle' | 'bottom';
}
export interface BarEl extends Base {
  type: 'bar';
  w: number;
  h: number;
  value: Bindable<number> | string;
  max?: number | string;
  vertical?: boolean;
  radius?: number;
  fill?: Bindable<Paint>;
  track?: Paint;
}
export interface GroupEl extends Base {
  type: 'group';
  children: El[];
}
export interface RepeatEl extends Base {
  type: 'repeat';
  count: number | string;
  max?: number;
  dx?: number;
  dy?: number;
  children: El[];
}
export type El = ShapeEl | ImageEl | TextEl | BarEl | GroupEl | RepeatEl;

export interface Spec {
  canvas: { w: number; h: number; scale?: number; background?: string };
  params: Record<string, ParamDef>;
  assets?: Record<string, string>; // alias -> asset name
  /** font families loaded in the editor's 에셋 tab (text elements pick from these); the engine reads each text's own `font` */
  fonts?: string[];
  elements: El[];
}

/** Asset names: an optional one-level folder (Korean allowed) and a file name, e.g. "dungeon/coin.svg", "던전/coin.svg". */
export const ASSET_NAME = /^(?:[0-9A-Za-z가-힣_-][0-9A-Za-z가-힣._-]{0,39}\/)?[A-Za-z0-9._-]{1,64}$/;
export const assetFolder = (name: string) => (name.includes('/') ? name.slice(0, name.indexOf('/')) : '');
export const assetFile = (name: string) => name.slice(name.indexOf('/') + 1);

/** Point a spec's asset map from one asset name to another. Returns the new JSON, or null when the spec does not use `from`. */
export function renameAssetRefs(specJson: string, from: string, to: string): string | null {
  const spec = JSON.parse(specJson);
  let hit = false;
  for (const [alias, name] of Object.entries(spec.assets ?? {}))
    if (name === from) ((spec.assets[alias] = to), (hit = true));
  return hit ? JSON.stringify(spec) : null;
}

export const LIMITS = { maxElements: 600, maxDepth: 6, maxRepeat: 64, maxCanvas: 4096, textLength: 500, maxTextLength: 2000 };

const KINDS = new Set(['shape', 'image', 'text', 'bar', 'group', 'repeat']);
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

/** Structural validation. Returns a list of problems (empty = ok). */
export function validateSpec(spec: any): string[] {
  const errs: string[] = [];
  if (!spec || typeof spec !== 'object') return ['spec must be an object'];
  const c = spec.canvas;
  if (!c || !(c.w > 0) || !(c.h > 0) || c.w > LIMITS.maxCanvas || c.h > LIMITS.maxCanvas) errs.push('canvas.w/h must be 1..' + LIMITS.maxCanvas);
  if (c?.scale !== undefined && !(c.scale >= 0.25 && c.scale <= 2)) errs.push('canvas.scale must be 0.25..2');
  if (!spec.params || typeof spec.params !== 'object') errs.push('params must be an object');
  else {
    for (const [k, d] of Object.entries<any>(spec.params)) {
      if (!NAME.test(k)) errs.push(`param name "${k}" must match ${NAME}`);
      if (!d || !['text', 'number', 'enum', 'bool', 'random'].includes(d.type)) errs.push(`param "${k}": bad type`);
      if (d?.type === 'enum' && (!Array.isArray(d.options) || !d.options.length)) errs.push(`param "${k}": enum needs options`);
      if (d?.type === 'random' && d.options !== undefined && (!Array.isArray(d.options) || !d.options.length)) errs.push(`param "${k}": random options must be a non-empty list`);
      if (d?.type === 'random' && d.options === undefined) {
        const lo = d.min ?? 1, hi = d.max ?? 6;
        const ref = (v: unknown) => typeof v === 'string' && spec.params[v]?.type === 'number';
        if (typeof lo === 'string' || typeof hi === 'string') {
          if ((typeof lo === 'string' && !ref(lo)) || (typeof hi === 'string' && !ref(hi))) errs.push(`param "${k}": random min/max must be a number or a number param`);
        } else if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi || hi - lo > 1e6) errs.push(`param "${k}": random needs whole numbers min <= max`);
      }
    }
  }
  if (spec.fonts !== undefined && (!Array.isArray(spec.fonts) || spec.fonts.some((f: unknown) => typeof f !== 'string'))) errs.push('fonts must be a list of names');
  let count = 0;
  const walk = (els: any, depth: number) => {
    if (!Array.isArray(els)) return errs.push('elements/children must be an array');
    if (depth > LIMITS.maxDepth) return errs.push('nesting too deep');
    for (const e of els) {
      if (++count > LIMITS.maxElements) return errs.push('too many elements');
      if (!e || !KINDS.has(e.type)) errs.push(`unknown element type "${e?.type}"`);
      else if (e.type === 'group' || e.type === 'repeat') walk(e.children, depth + 1);
    }
  };
  walk(spec.elements, 0);
  return errs;
}
