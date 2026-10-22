import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeSvg, estimateEm } from '../src/compose';
import { fontMetrics, makeMeasure } from '../src/metrics';
import type { Spec } from '../src/spec';

const regular = new Uint8Array(readFileSync('public/_seed/fonts/NotoSansKR-400.ttf'));
const bold = new Uint8Array(readFileSync('public/_seed/fonts/NotoSansKR-700.ttf'));
const faces = [
  { family: 'Noto Sans KR', weight: 400, bytes: regular },
  { family: 'Noto Sans KR', weight: 700, bytes: bold },
];
const measure = makeMeasure(faces, 'Noto Sans KR', estimateEm);

describe('font metrics', () => {
  it('reads advance widths from the font', () => {
    const m = fontMetrics(regular)!;
    expect(m.advance('가'.codePointAt(0)!)).toBeGreaterThan(0.8);
    expect(m.advance('i'.codePointAt(0)!)).toBeLessThan(m.advance('W'.codePointAt(0)!)!);
    expect(m.advance(0x1f600)).toBeUndefined(); // emoji not in the subset
  });
  it('measures with the nearest weight and falls back to the default family', () => {
    expect(measure('가나다', 'Noto Sans KR', 700)).toBeGreaterThanOrEqual(measure('가나다', 'Noto Sans KR', 400));
    expect(measure('가나다', 'Unknown', 400)).toBe(measure('가나다', 'Noto Sans KR', 400));
  });
});

const card = (fit?: 'shrink' | 'clip', text = '아주아주긴이름입니다', extra: object = {}): Spec => ({
  canvas: { w: 200, h: 60 },
  params: {},
  elements: [{ type: 'text', x: 10, y: 10, w: 80, h: 30, size: 24, text, fit, ...extra }],
});
const sizeOf = (svg: string) => Number(/font-size="([\d.]+)"/.exec(svg)![1]);

describe('text fit', () => {
  it('leaves text alone by default', () => {
    const svg = composeSvg(card(), {}, new Map(), { measure }).svg;
    expect(sizeOf(svg)).toBe(24);
    expect(svg).not.toContain('clipPath');
  });
  it('shrinks to the box width using the real metrics', () => {
    const svg = composeSvg(card('shrink'), {}, new Map(), { measure }).svg;
    const size = sizeOf(svg);
    expect(size).toBeLessThan(24);
    expect(measure('아주아주긴이름입니다', '', 400) * size).toBeLessThanOrEqual(80.01);
    expect(svg).not.toContain('clipPath');
  });
  it('does not grow short text', () => {
    expect(sizeOf(composeSvg(card('shrink', '짧음'), {}, new Map(), { measure }).svg)).toBe(24);
  });
  it('stops at minSize and clips the rest', () => {
    const svg = composeSvg(card('shrink', '아주아주아주아주긴이름입니다', { minSize: 14 }), {}, new Map(), { measure }).svg;
    expect(sizeOf(svg)).toBe(14);
    expect(svg).toMatch(/<clipPath id="c\d+"><rect x="10" y="10" width="80" height="30"\/>/);
  });
  it('clip keeps the size and hides the overflow', () => {
    const svg = composeSvg(card('clip'), {}, new Map(), { measure }).svg;
    expect(sizeOf(svg)).toBe(24);
    expect(svg).toContain('clip-path="url(#c');
  });
});
