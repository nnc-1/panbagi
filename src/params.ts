import type { ParamDef, Spec } from './spec';
import { LIMITS } from './spec';

export type Values = Record<string, string | number | boolean>;

const NONE = new Set(['', 'none', 'null']);
const TRUE = new Set(['1', 'true', 'on', 'yes', '예', 'y']);

// line breaks survive (a text box shows them, a one-line text turns them into spaces)
function stripControl(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
}

function normalizeOne(def: ParamDef, raw: string | undefined): string | number | boolean {
  switch (def.type) {
    case 'text': {
      // long text is fine (a text box, a board); the hard cap keeps one render's work bounded
      const max = Math.min(def.maxLength ?? LIMITS.textLength, LIMITS.maxTextLength);
      if (raw === undefined) return stripControl(def.default ?? '').slice(0, max);
      const s = stripControl(raw).trim();
      return NONE.has(s.toLowerCase()) ? '' : [...s].slice(0, max).join('');
    }
    case 'number': {
      const d = def.default ?? def.min ?? 0;
      const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw.replace(/,/g, ''));
      let v = Number.isFinite(n) ? n : d;
      if (def.min !== undefined) v = Math.max(def.min, v);
      if (def.max !== undefined) v = Math.min(def.max, v);
      const k = 10 ** (def.decimals ?? 0);
      return Math.round(v * k) / k;
    }
    case 'enum': {
      const d = def.default ?? def.options[0];
      if (raw === undefined) return d;
      const s = raw.trim().toLowerCase();
      if (s === 'none' && !def.options.some((o) => o.toLowerCase() === 'none')) return 'none';
      return def.options.find((o) => o.toLowerCase() === s) ?? d;
    }
    case 'bool':
      return raw === undefined ? !!def.default : TRUE.has(raw.trim().toLowerCase());
    case 'random':
      return ''; // rolled in normalizeParams, once every other value is known
  }
}

/** FNV-1a, then one mulberry32 step: a well-spread 32-bit number from a string. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  let t = (h + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** A random param's value: decided by its name and the other values, so one address always gets the same roll. */
export function rollRandom(name: string, def: Extract<ParamDef, { type: 'random' }>, seed: string): string | number {
  const r = hash32(name + '|' + seed);
  if (def.options?.length) return def.options[r % def.options.length];
  const lo = Math.round(def.min ?? 1), hi = Math.max(lo, Math.round(def.max ?? 6));
  return lo + (r % (hi - lo + 1));
}

/**
 * Normalize a query string against the template's parameter definitions.
 * Unknown keys are dropped, aliases map to the real key, missing = default, bad = default/clamped.
 * `normalized` is the canonical string used for the storage key.
 */
export function normalizeParams(spec: Spec, query: URLSearchParams | Record<string, string>): { values: Values; normalized: string } {
  const entries = query instanceof URLSearchParams ? [...query.entries()] : Object.entries(query);
  const aliasOf = new Map<string, string>();
  for (const [k, def] of Object.entries(spec.params)) {
    aliasOf.set(k.toLowerCase(), k);
    for (const a of def.alias ?? []) aliasOf.set(a.toLowerCase(), k);
  }
  const raw = new Map<string, string>();
  for (const [k, v] of entries) {
    const real = aliasOf.get(k.toLowerCase());
    if (real && !raw.has(real)) raw.set(real, v);
  }
  const values: Values = {};
  const parts: string[] = [];
  for (const [k, def] of Object.entries(spec.params)) {
    if (def.type === 'random') continue; // never taken from the address
    const v = normalizeOne(def, raw.get(k));
    values[k] = v;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  const seed = parts.join('&');
  for (const [k, def] of Object.entries(spec.params)) if (def.type === 'random') values[k] = rollRandom(k, def, seed);
  // the rolls follow from the other values, so the storage key needs only those
  return { values, normalized: seed };
}
