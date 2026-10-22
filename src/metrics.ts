// Glyph advance widths read straight from TTF/OTF bytes (cmap + hmtx), so "shrink to fit" text can be sized
// from the real font instead of a guess. Lookups work on the raw buffer; nothing is parsed up front.

export interface Face {
  family: string;
  weight: number;
  bytes: Uint8Array;
}

interface Metrics {
  /** advance width in em, or undefined when the font has no glyph for the code point */
  advance(cp: number): number | undefined;
}

const cache = new WeakMap<Uint8Array, Metrics | null>();

export function fontMetrics(bytes: Uint8Array): Metrics | null {
  if (cache.has(bytes)) return cache.get(bytes)!;
  let m: Metrics | null = null;
  try {
    m = parse(bytes);
  } catch {
    m = null;
  }
  cache.set(bytes, m);
  return m;
}

function parse(b: Uint8Array): Metrics | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tables = new Map<string, number>();
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    tables.set(String.fromCharCode(b[r], b[r + 1], b[r + 2], b[r + 3]), dv.getUint32(r + 8));
  }
  const head = tables.get('head'), hhea = tables.get('hhea'), hmtx = tables.get('hmtx'), cmap = tables.get('cmap');
  if (head === undefined || hhea === undefined || hmtx === undefined || cmap === undefined) return null;
  const upm = dv.getUint16(head + 18) || 1000;
  const numH = dv.getUint16(hhea + 34);

  // prefer a full-Unicode subtable (format 12), else the BMP one (format 4)
  let f12 = -1, f4 = -1;
  const subs = dv.getUint16(cmap + 2);
  for (let i = 0; i < subs; i++) {
    const r = cmap + 4 + i * 8;
    const pid = dv.getUint16(r), eid = dv.getUint16(r + 2), off = cmap + dv.getUint32(r + 4);
    const fmt = dv.getUint16(off);
    if (fmt === 12 && (pid === 0 || (pid === 3 && eid === 10))) f12 = off;
    else if (fmt === 4 && (pid === 0 || (pid === 3 && eid === 1))) f4 = off;
  }
  if (f12 < 0 && f4 < 0) return null;

  const glyph = (cp: number): number => {
    if (f12 >= 0) {
      let lo = 0, hi = dv.getUint32(f12 + 12) - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, g = f12 + 16 + mid * 12;
        const start = dv.getUint32(g), end = dv.getUint32(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return dv.getUint32(g + 8) + (cp - start);
      }
      return 0;
    }
    if (cp > 0xffff) return 0;
    const segX2 = dv.getUint16(f4 + 6);
    const ends = f4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    let lo = 0, hi = segX2 / 2 - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const end = dv.getUint16(ends + mid * 2), start = dv.getUint16(starts + mid * 2);
      if (cp > end) lo = mid + 1;
      else if (cp < start) hi = mid - 1;
      else {
        const ro = dv.getUint16(ranges + mid * 2), delta = dv.getUint16(deltas + mid * 2);
        if (!ro) return (cp + delta) & 0xffff;
        const gi = dv.getUint16(ranges + mid * 2 + ro + (cp - start) * 2);
        return gi ? (gi + delta) & 0xffff : 0;
      }
    }
    return 0;
  };
  return {
    advance(cp) {
      const g = glyph(cp);
      if (!g) return undefined;
      return dv.getUint16(hmtx + Math.min(g, numH - 1) * 4) / upm;
    },
  };
}

/**
 * Text width in em for the face the rasterizer would pick: the family at the nearest weight, else the default
 * family; characters a face lacks fall back to the default face, then to a rough guess.
 */
export function makeMeasure(faces: Face[], defaultFamily: string | undefined, guess: (ch: string) => number) {
  const pick = (family: string, weight: number) => {
    const fam = faces.some((f) => f.family === family) ? family : defaultFamily;
    return faces.filter((f) => f.family === fam).sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
  };
  return (text: string, family: string, weight: number): number => {
    const main = pick(family, weight), fb = pick(defaultFamily ?? '', weight);
    const mm = main && fontMetrics(main.bytes), fm = fb && fontMetrics(fb.bytes);
    let w = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      w += mm?.advance(cp) ?? fm?.advance(cp) ?? guess(ch);
    }
    return w;
  };
}
