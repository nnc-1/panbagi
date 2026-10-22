import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeSvg } from '../src/compose';
import { normalizeParams } from '../src/params';
import { ASSET_NAME, renameAssetRefs, type Spec } from '../src/spec';
import { getAt, hitAll, hitTest, inBox, layout, moveTo, nextHit, renameParam } from '../ui/model';
import { interpolate } from '../src/compose';
import { makeZip, readZip } from '../ui/zip';

const spec = (): Spec => ({
  canvas: { w: 200, h: 100 },
  params: { hp: { type: 'number', default: 50, min: 0, max: 100 }, show: { type: 'bool' } },
  elements: [
    { type: 'shape', name: 'bg', x: 0, y: 0, w: 200, h: 100 },
    { type: 'group', name: 'g', x: 10, y: 20, children: [{ type: 'text', name: 't', x: 5, y: 5, w: 50, h: 20, text: 'HP {hp}/100' }] },
    { type: 'bar', name: 'b', x: 10, y: 80, w: 100, h: 10, value: 'hp', when: { param: 'show', eq: 'true' } },
  ],
});

describe('moveTo', () => {
  it('reorders siblings (index counted before removal)', () => {
    const r = moveTo(spec(), [0], [], 3)!;
    expect(r.spec.elements.map((e) => e.name)).toEqual(['g', 'b', 'bg']);
    expect(r.path).toEqual([2]);
  });
  it('moves an element into a group and out again', () => {
    const into = moveTo(spec(), [2], [1], 1e9)!;
    expect(into.path).toEqual([1, 1]);
    expect(getAt(into.spec, [1, 1])!.name).toBe('b');
    const out = moveTo(into.spec, [1, 0], [], 0)!;
    expect(out.spec.elements.map((e) => e.name)).toEqual(['t', 'bg', 'g']);
  });
  it('refuses to drop a group into itself', () => expect(moveTo(spec(), [1], [1], 0)).toBeNull());
});

describe('renameParam', () => {
  it('updates text placeholders, value refs and conditions', () => {
    const s = renameParam(spec(), 'hp', 'health');
    expect(Object.keys(s.params)).toEqual(['health', 'show']);
    const json = JSON.stringify(s.elements);
    expect(json).toContain('HP {health}/100');
    expect(json).toContain('"value":"health"');
    expect(json).not.toContain('hp');
    // and the renamed spec still renders the value
    const svg = composeSvg(s, normalizeParams(s, { health: '70' }).values, new Map()).svg;
    expect(svg).toContain('HP 70/100');
  });
});

describe('layout & hitTest', () => {
  it('offsets children by their group and skips hidden elements', () => {
    const s = spec();
    const boxes = layout(s, normalizeParams(s, {}).values);
    const t = boxes.find((b) => b.path.join() === '1,0')!;
    expect([t.x, t.y, t.w, t.h]).toEqual([15, 25, 50, 20]);
    expect(boxes.find((b) => b.path.join() === '2')!.visible).toBe(false);
    expect(hitTest(boxes, 20, 30, s)).toEqual([1, 0]); // text inside group, above the background
    expect(hitTest(boxes, 50, 85, s)).toEqual([0]); // hidden bar is not hit
  });
  it('lays out the sample HUD without errors', () => {
    const hud: Spec = JSON.parse(readFileSync('samples/hud.json', 'utf8'));
    expect(layout(hud, normalizeParams(hud, {}).values).length).toBeGreaterThan(20);
  });
});

describe('click cycling', () => {
  it('a click on the selection picks the element below it, then wraps to the top', () => {
    const s = spec();
    s.elements[2].when = undefined; // show the bar: background and bar overlap at (20, 85)
    const boxes = layout(s, normalizeParams(s, {}).values);
    expect(hitAll(boxes, 20, 85, s)).toEqual([[2], [0]]);
    expect(nextHit(boxes, 20, 85, s, null)).toEqual([2]);
    expect(nextHit(boxes, 20, 85, s, [2])).toEqual([0]);
    expect(nextHit(boxes, 20, 85, s, [0])).toEqual([2]);
    expect(nextHit(boxes, 20, 85, s, [1, 0])).toEqual([2]); // selection elsewhere -> topmost
  });
});

describe('rotation', () => {
  it('turns boxes around their center, and children around their group origin', () => {
    const s: Spec = {
      canvas: { w: 200, h: 200 },
      params: {},
      elements: [
        { type: 'shape', x: 50, y: 90, w: 100, h: 20, rotate: 90 },
        { type: 'group', x: 100, y: 100, rotate: 90, children: [{ type: 'shape', x: 40, y: -5, w: 20, h: 10 }] },
      ],
    };
    const [bar, , kid] = layout(s, {});
    expect([bar.cx, bar.cy, bar.rot]).toEqual([100, 100, 90]);
    expect(inBox(bar, 100, 60)).toBe(true); // turned upright: now 20 wide, 100 tall
    expect(inBox(bar, 60, 100)).toBe(false);
    // child center (150, 100) turned 90° around the group origin (100, 100) -> (100, 150)
    expect(kid.cx).toBeCloseTo(100);
    expect(kid.cy).toBeCloseTo(150);
    expect([kid.rot, kid.prot]).toEqual([90, 90]);
  });
  it('turns auto-width text around its middle in the engine too', () => {
    const s: Spec = { canvas: { w: 200, h: 100 }, params: {}, elements: [{ type: 'text', x: 10, y: 10, h: 20, size: 16, text: 'AB', rotate: 30 }] };
    const svg = composeSvg(s, {}, new Map()).svg;
    const b = layout(s, {})[0];
    expect(svg).toContain(`rotate(30 ${+b.cx.toFixed(2)} ${b.cy})`);
  });
});

describe('percent text', () => {
  it('{v|pct:max} divides by a param or a number and clamps like a bar', () => {
    expect(interpolate('{hp|pct:maxhp}', { hp: 75, maxhp: 150 })).toBe('50%');
    expect(interpolate('{hp|pct}', { hp: 42 })).toBe('42%');
    expect(interpolate('{hp|pct:150}', { hp: 300 })).toBe('100%');
    expect(interpolate('{hp|pct:maxhp}', { hp: 5, maxhp: 0 })).toBe('0%');
    expect(interpolate('{75|pct:150} {75}/{150}', {})).toBe('50% 75/150');
  });
});

describe('asset folders', () => {
  it('accepts one folder level, Korean folder names, and nothing odd', () => {
    for (const ok of ['coin.svg', 'dungeon/coin.svg', '던전RPG/coin-2.svg', 'a_b/x.png']) expect(ASSET_NAME.test(ok), ok).toBe(true);
    for (const bad of ['a/b/c.svg', '../x.svg', '/x.svg', 'x/', '던전/코인.svg', '.hidden/x.svg', 'a b/x.svg']) expect(ASSET_NAME.test(bad), bad).toBe(false);
  });
  it('renames asset references in a spec and leaves other specs alone', () => {
    const j = JSON.stringify({ ...spec(), assets: { coin: 'coin.svg', c2: 'coin.svg', pin: 'pin.svg' } });
    const out = JSON.parse(renameAssetRefs(j, 'coin.svg', '던전/coin.svg')!);
    expect(out.assets).toEqual({ coin: '던전/coin.svg', c2: '던전/coin.svg', pin: 'pin.svg' });
    expect(renameAssetRefs(j, 'coin', 'x.svg')).toBeNull(); // substring of a name is not a match
    expect(renameAssetRefs(JSON.stringify(spec()), 'coin.svg', 'x.svg')).toBeNull();
  });
});

describe('zip', () => {
  it('round-trips files (deflate and stored)', async () => {
    const big = new TextEncoder().encode('가나다 '.repeat(500));
    const rnd = crypto.getRandomValues(new Uint8Array(300)); // incompressible -> stored
    const blob = await makeZip([
      { name: 'bundle.json', data: big },
      { name: 'fonts/폰트-400.ttf', data: rnd },
    ]);
    const files = await readZip(await blob.arrayBuffer());
    expect([...files.keys()]).toEqual(['bundle.json', 'fonts/폰트-400.ttf']);
    expect(files.get('bundle.json')).toEqual(big);
    expect(files.get('fonts/폰트-400.ttf')).toEqual(rnd);
  });
});
