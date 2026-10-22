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

const box = (extra: object = {}, text = '안녕하세요 오늘은 날씨가 정말 좋네요 산책을 나가 볼까요'): Spec => ({
  canvas: { w: 300, h: 200 },
  params: { t: { type: 'text', maxLength: 200 } },
  elements: [{ type: 'text', x: 10, y: 10, w: 120, h: 90, size: 20, text, wrap: true, ...extra }],
});
const spans = (svg: string) => [...svg.matchAll(/<tspan x="([\d.]+)" y="([\d.]+)">([^<]*)<\/tspan>/g)].map((m) => ({ x: +m[1], y: +m[2], t: m[3] }));

describe('text box (wrap)', () => {
  it('wraps at spaces inside the width using the real metrics', () => {
    const svg = composeSvg(box(), {}, new Map(), { measure }).svg;
    const ls = spans(svg);
    expect(ls.length).toBeGreaterThan(2);
    for (const l of ls) expect(measure(l.t, '', 400) * 20).toBeLessThanOrEqual(120.5);
    expect(ls.map((l) => l.t).join(' ')).toBe('안녕하세요 오늘은 날씨가 정말 좋네요 산책을 나가 볼까요');
    expect(ls[1].y - ls[0].y).toBeCloseTo(26, 1); // 1.3 x 20
  });
  it('keeps typed line breaks and \\n from parameters', () => {
    const svg = composeSvg(box({}, '첫 줄\n{t}'), { t: '둘째\\n셋째' }, new Map(), { measure }).svg;
    expect(spans(svg).map((l) => l.t)).toEqual(['첫 줄', '둘째', '셋째']);
  });
  it('cuts a word longer than a line between letters', () => {
    const ls = spans(composeSvg(box({ w: 60 }, '가나다라마바사아자차'), {}, new Map(), { measure }).svg);
    expect(ls.length).toBeGreaterThan(1);
    expect(ls.map((l) => l.t).join('')).toBe('가나다라마바사아자차');
  });
  it('aligns lines and places them vertically', () => {
    const mid = spans(composeSvg(box({ align: 'center', valign: 'middle', h: 100 }, '한 줄'), {}, new Map(), { measure }).svg);
    expect(mid[0].x).toBe(70);
    expect(mid[0].y).toBeCloseTo(10 + 50 + 7, 1);
    const bottom = spans(composeSvg(box({ align: 'right', valign: 'bottom', h: 100 }, '한 줄'), {}, new Map(), { measure }).svg);
    expect(bottom[0].x).toBe(130);
    expect(bottom[0].y).toBeCloseTo(10 + 100 - 13 + 7, 1);
  });
  it('shrinks until all lines fit the box height', () => {
    const svg = composeSvg(box({ fit: 'shrink', h: 60 }), {}, new Map(), { measure }).svg;
    const size = sizeOf(svg);
    expect(size).toBeLessThan(20);
    expect(spans(svg).length * size * 1.3).toBeLessThanOrEqual(60.5);
    expect(svg).not.toContain('clipPath');
  });
  it('clips the overflow of a box', () => {
    const svg = composeSvg(box({ fit: 'clip', h: 40 }), {}, new Map(), { measure }).svg;
    expect(sizeOf(svg)).toBe(20);
    expect(svg).toMatch(/<clipPath id="c\d+"><rect x="10" y="10" width="120" height="40"\/>/);
  });
  it('one-line text still turns line breaks into spaces', () => {
    const svg = composeSvg(box({ wrap: undefined }, '가\n나'), {}, new Map(), { measure }).svg;
    expect(svg).toContain('>가 나</text>');
  });
});
