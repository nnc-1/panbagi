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
  }
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
    const v = normalizeOne(def, raw.get(k));
    values[k] = v;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return { values, normalized: parts.join('&') };
}
