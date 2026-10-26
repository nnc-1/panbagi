import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { composeSvg, type AssetData } from '../src/compose';
import { normalizeParams } from '../src/params';
import { initRaster, initWebpEncoder, rasterize } from '../src/raster';
import { sanitizeSvg } from '../src/sanitize';
import { validateSpec, type Spec } from '../src/spec';
import { purgeExpired } from '../src/store';
import type { Env } from '../src/env';
import { clientKey, readConfig } from '../src/env';
import { admin } from '../src/admin';

const hud: Spec = JSON.parse(readFileSync('samples/hud.json', 'utf8'));
const assets = new Map<string, AssetData>(
  Object.entries(hud.assets!).map(([alias, name]) => [alias, { mime: 'image/svg+xml', bytes: readFileSync(`public/_seed/assets/${name}`) }]),
);
const q = (s: string) => new URLSearchParams(s);

describe('sample template', () => {
  it('is structurally valid', () => expect(validateSpec(hud)).toEqual([]));
});

describe('normalizeParams', () => {
  it('rolls random params from the other values: same address, same roll; ignores a value sent for it', () => {
    const spec: Spec = {
      canvas: { w: 10, h: 10 },
      params: { turn: { type: 'number', min: 0, max: 1000 }, dice: { type: 'random', min: 1, max: 6 }, face: { type: 'random', options: ['a', 'b', 'c'] } },
      elements: [],
    };
    const a = normalizeParams(spec, { turn: '3' });
    expect(normalizeParams(spec, { turn: '3', dice: '6' }).values).toEqual(a.values);
    expect(a.normalized).toBe('turn=3');
    const rolls = new Set<number>(), faces = new Set<string>();
    for (let t = 0; t < 200; t++) {
      const v = normalizeParams(spec, { turn: String(t) }).values;
      expect(v.dice).toBeGreaterThanOrEqual(1);
      expect(v.dice).toBeLessThanOrEqual(6);
      rolls.add(v.dice as number);
      faces.add(v.face as string);
    }
    expect(rolls.size).toBe(6);
    expect(faces.size).toBe(3);
    expect(validateSpec(spec)).toEqual([]);
    expect(validateSpec({ ...spec, params: { d: { type: 'random', min: 6, max: 1 } } })).not.toEqual([]);
  });
  it('random values drive any element: picked colors, ranges, conditions, gauges, repeats', () => {
    const spec: Spec = {
      canvas: { w: 100, h: 100 },
      params: { turn: { type: 'number', min: 0, max: 1000 }, dice: { type: 'random', min: 1, max: 6 }, luck: { type: 'random', options: ['good', 'bad'] } },
      elements: [
        { type: 'shape', name: 'six', when: { param: 'dice', eq: 6 }, w: 1, h: 1, fill: '#000001' },
        { type: 'shape', w: 1, h: 1, fill: { switch: 'luck', cases: { good: '#00aa00', bad: '#aa0000' } } },
        { type: 'shape', w: 1, h: 1, fill: { steps: 'dice', stops: [{ gte: 4, value: '#0000ff' }], default: '#ffff00' } },
        { type: 'bar', w: 60, h: 4, value: 'dice', max: 6 },
        { type: 'repeat', count: 'dice', max: 6, dx: 10, children: [{ type: 'shape', w: 1, h: 1, fill: '#123456' }] },
      ],
    };
    for (let t = 0; t < 30; t++) {
      const v = normalizeParams(spec, { turn: String(t) }).values;
      const svg = composeSvg(spec, v, new Map()).svg;
      expect(svg.includes('#000001')).toBe(v.dice === 6);
      expect(svg).toContain(v.luck === 'good' ? '#00aa00' : '#aa0000');
      expect(svg).toContain((v.dice as number) >= 4 ? '#0000ff' : '#ffff00');
      expect(svg.split('#123456').length - 1).toBe(v.dice);
    }
  });
  it('takes 500 letters by default and never more than 2000', () => {
    const spec = { canvas: { w: 10, h: 10 }, params: { a: { type: 'text' }, b: { type: 'text', maxLength: 99999 } }, elements: [] } as any;
    const v = normalizeParams(spec, { a: '가'.repeat(600), b: 'x'.repeat(3000) }).values;
    expect([...String(v.a)].length).toBe(500);
    expect(String(v.b).length).toBe(2000);
  });
  it('keeps line breaks in text values (a text box shows them)', () => {
    const spec = { canvas: { w: 10, h: 10 }, params: { t: { type: 'text' } }, elements: [] } as any;
    expect(normalizeParams(spec, q('t=a%0D%0Ab%09c')).values.t).toBe('a\nbc');
  });
  it('fills defaults, drops unknown keys, clamps and snaps', () => {
    const { values } = normalizeParams(hud, q('hp=150&level=abc&zzz=1&p1=마법사&p2=bogus&name=%20%20x%00y '));
    expect(values.hp).toBe(100);
    expect(values.level).toBe(1);
    expect(values.p1).toBe('마법사');
    expect(values.p2).toBe('none'); // invalid -> default
    expect(values.name).toBe('xy');
    expect('zzz' in values).toBe(false);
  });
  it('matches enum options case-insensitively', () => {
    const spec: Spec = { canvas: { w: 1, h: 1 }, params: { a: { type: 'enum', options: ['none', 'HP', 'MP'] } }, elements: [] };
    expect(normalizeParams(spec, q('a=hp')).values.a).toBe('HP');
  });
  it('maps aliases and treats none/empty text as empty', () => {
    expect(normalizeParams(hud, q('health=40')).values.hp).toBe(40);
    expect(normalizeParams(hud, q('u=도키')).values.name).toBe('도키');
    expect(normalizeParams(hud, q('place=none')).values.place).toBe('');
    expect(normalizeParams(hud, q('name=none')).values.name).toBe('');
  });
  it('gives the same canonical string regardless of order/noise', () => {
    const a = normalizeParams(hud, q('hp=50&name=A')).normalized;
    const b = normalizeParams(hud, q('x=9&name=A&hp=50.0&health=1')).normalized;
    expect(a).toBe(b);
  });
  it('truncates text by characters, not bytes', () => {
    expect([...String(normalizeParams(hud, q('name=' + '가'.repeat(50))).values.name)].length).toBe(12);
  });
});

describe('composeSvg', () => {
  const svgFor = (query: string) => composeSvg(hud, normalizeParams(hud, q(query)).values, assets).svg;
  it('is deterministic', () => expect(svgFor('hp=10')).toBe(svgFor('hp=10')));
  it('escapes user text', () => {
    const svg = svgFor('name=' + encodeURIComponent('<script>&"'));
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;&amp;&quot;');
  });
  it('switches bar colour with steps and shows state wording', () => {
    expect(svgFor('hp=80')).toContain('#4fbf5a');
    expect(svgFor('hp=40')).toContain('#e0b13c');
    expect(svgFor('hp=10')).toContain('#d6483f');
    expect(svgFor('hp=10')).toContain('>위험<');
    expect(svgFor('hp=80')).toContain('>양호<');
  });
  it('repeats slots with $i param lookup and hides empty ones', () => {
    const s = svgFor('p2=마법사&p2n=Zed');
    expect(s).toContain('>마법사<');
    expect(s).toContain('>Zed<');
    expect(s.match(/>빈 자리</g)!.length).toBe(2);
  });
  it('formats numbers with comma', () => expect(svgFor('gold=12345')).toContain('12,345 G'));
  it('caps repeat counts', () => {
    const spec: Spec = {
      canvas: { w: 10, h: 10 },
      params: { n: { type: 'number', default: 999, min: 0, max: 999 } },
      elements: [{ type: 'repeat', count: 'n', children: [{ type: 'shape', w: 1, h: 1, fill: '#fff' }] }],
    };
    const svg = composeSvg(spec, normalizeParams(spec, q('')).values, new Map()).svg;
    expect(svg.match(/<rect /g)!.length).toBe(64);
  });
  it('keeps ids of inlined svg assets from colliding', () => {
    const icon = (c: string) => ({
      mime: 'image/svg+xml',
      bytes: new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><defs><linearGradient id="a"><stop stop-color="${c}"/></linearGradient></defs><rect width="2" height="2" fill="url(#a)"/></svg>`),
    });
    const spec: Spec = {
      canvas: { w: 10, h: 10 },
      params: {},
      assets: { r: 'r', b: 'b' },
      elements: [{ type: 'image', asset: 'r', w: 5, h: 5 }, { type: 'image', asset: 'b', x: 5, w: 5, h: 5 }],
    };
    const svg = composeSvg(spec, {}, new Map([['r', icon('red')], ['b', icon('blue')]])).svg;
    const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(svg).toContain(`url(#${id})`);
  });
  it('rejects non-colour paint strings', () => {
    const spec: Spec = { canvas: { w: 10, h: 10 }, params: {}, elements: [{ type: 'shape', w: 5, h: 5, fill: '"/><script>' }] };
    expect(composeSvg(spec, {}, new Map()).svg).not.toContain('script');
  });
});

describe('rasterize', () => {
  beforeAll(async () => {
    await initRaster(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
    await initWebpEncoder(readFileSync('node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm'));
  });
  const svg = composeSvg(hud, normalizeParams(hud, q('')).values, assets).svg;
  it('produces a PNG at canvas width', async () => {
    const png = await rasterize(svg, { width: 520, format: 'png', fonts: [] });
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect(dv.getUint32(16)).toBe(520);
    expect(dv.getUint32(20)).toBe(250);
  });
  it('produces a lossless WebP, smaller than the PNG', async () => {
    const webp = await rasterize(svg, { width: 520, format: 'webp', fonts: [] });
    const png = await rasterize(svg, { width: 520, format: 'png', fonts: [] });
    const ascii = (a: number, b: number) => String.fromCharCode(...webp.slice(a, b));
    expect(ascii(0, 4) + ascii(8, 16)).toBe('RIFFWEBPVP8L'); // VP8L = lossless
    expect(webp.length).toBeLessThan(png.length);
  });
  it('produces a JPEG', async () => {
    const jpg = await rasterize(svg, { width: 260, format: 'jpg', fonts: [] });
    expect([...jpg.slice(0, 2)]).toEqual([0xff, 0xd8]);
  });
});

describe('sanitizeSvg', () => {
  it('removes scripts, handlers, foreignObject and external refs', () => {
    const out = sanitizeSvg(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><foreignObject><div/></foreignObject><image href="https://evil/x.png"/><use href="#a"/><rect style="fill:url(http://evil/a)"/></svg>`,
    )!;
    expect(out).not.toMatch(/script|onload|foreignObject|evil/);
    expect(out).toContain('href="#a"');
  });
  it('rejects non-svg', () => expect(sanitizeSvg('hello')).toBeNull());
  it('drops external refs under any namespace prefix', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink"><image xl:href="https://evil/x.png" ev:onclick="x()"/><use xl:href="#a"/></svg>`)!;
    expect(out).not.toMatch(/evil|onclick/);
    expect(out).toContain('xl:href="#a"');
  });
});

describe('config & purge', () => {
  it('clamps RENDER_TTL_HOURS to 1..24, default 6', () => {
    const c = (v?: string) => readConfig({ RENDER_TTL_HOURS: v } as Env).ttlSeconds / 3600;
    expect([c(), c('0'), c('2'), c('99'), c('abc')]).toEqual([6, 6, 2, 24, 6]);
  });
  it('deletes only renders older than the ttl', async () => {
    const now = Date.now();
    const objs = [
      { key: 'renders/a/b/old.png', uploaded: new Date(now - 7 * 3600e3) },
      { key: 'renders/a/b/new.png', uploaded: new Date(now - 1 * 3600e3) },
    ];
    const deleted: string[] = [];
    const env = {
      STORE: {
        list: async () => ({ objects: objs, truncated: false }),
        delete: async (k: string[]) => void deleted.push(...k),
      },
    } as unknown as Env;
    expect(await purgeExpired(env, 6 * 3600, now)).toBe(1);
    expect(deleted).toEqual(['renders/a/b/old.png']);
  });
});

describe('inline svg assets', () => {
  const svgFor = (query: string) => composeSvg(hud, normalizeParams(hud, q(query)).values, assets).svg;
  it('inlines svg icons as nested <svg> (no data-URI image, which is slow in resvg)', () => {
    const svg = svgFor('');
    expect(svg).not.toContain('data:image/svg+xml');
    expect(svg).toMatch(/<svg [^>]*x="48" y="332" width="28" height="28" viewBox="0 0 24 24"/);
  });
  it('keeps raster assets as <image>', () => {
    const spec: Spec = { canvas: { w: 10, h: 10 }, params: {}, assets: { p: 'p' }, elements: [{ type: 'image', asset: 'p', w: 5, h: 5 }] };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(composeSvg(spec, {}, new Map([['p', { mime: 'image/png', bytes: png }]])).svg).toContain('<image ');
  });
  it('derives viewBox from width/height when missing', () => {
    const spec: Spec = { canvas: { w: 10, h: 10 }, params: {}, assets: { a: 'a' }, elements: [{ type: 'image', asset: 'a', w: 5, h: 5 }] };
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>');
    expect(composeSvg(spec, {}, new Map([['a', { mime: 'image/svg+xml', bytes }]])).svg).toContain('viewBox="0 0 40 20"');
  });
});

describe('lite sample', () => {
  const lite: Spec = JSON.parse(readFileSync('samples/lite.json', 'utf8'));
  it('is valid and uses no assets', () => {
    expect(validateSpec(lite)).toEqual([]);
    expect(lite.assets).toBeUndefined();
  });
});

describe('config: free-plan switches', () => {
  it('clamps RENDER_SCALE to 0.25..2 (default 1) and keeps JPG off unless enabled', () => {
    const c = (v?: string) => readConfig({ RENDER_SCALE: v } as Env).renderScale;
    expect([c(), c('0.5'), c('0'), c('9'), c('x')]).toEqual([1, 0.5, 1, 2, 1]);
    expect(readConfig({} as Env).enableJpg).toBe(false);
    expect(readConfig({ ENABLE_JPG: 'true' } as Env).enableJpg).toBe(true);
  });
});

describe('admin auth', () => {
  const call = (env: Partial<Env>, token?: string) =>
    admin.request('/chats', { headers: token ? { 'x-admin-token': token } : {} }, env as Env);
  it('is closed without a token, and rejects short tokens', async () => {
    expect((await call({})).status).toBe(503);
    expect((await call({ ADMIN_TOKEN: 'short' }, 'short')).status).toBe(503);
  });
  it('rejects wrong tokens', async () => {
    expect((await call({ ADMIN_TOKEN: 'x'.repeat(20) }, 'y'.repeat(20))).status).toBe(401);
    expect((await call({ ADMIN_TOKEN: 'x'.repeat(20) })).status).toBe(401);
  });
});

describe('rate limit keys', () => {
  it('counts IPv4 per address and IPv6 per /64', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey(undefined)).toBe('anon');
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:DB8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('::ffff:198.51.100.2')).toBe('::ffff:198.51.100.2');
  });
});

describe('admin auth lockout', () => {
  const good = 'g'.repeat(20);
  const limiter = (n: number) => {
    let used = 0;
    return { limit: async () => ({ success: ++used <= n }) };
  };
  const call = (env: Partial<Env>, token: string, ip: string) =>
    admin.request('/settings', { headers: { 'x-admin-token': token, 'cf-connecting-ip': ip } }, env as Env);
  it('refuses even the right token once an address is over the limit', async () => {
    const env = { ADMIN_TOKEN: good, AUTH_LIMITER: limiter(2), DB: { prepare: () => ({ all: async () => ({ results: [] }) }) } } as any;
    expect((await call(env, 'w'.repeat(20), '2001:db8:9:9::1')).status).toBe(401);
    expect((await call(env, 'w'.repeat(20), '2001:db8:9:9::2')).status).toBe(401);
    expect((await call(env, 'w'.repeat(20), '2001:db8:9:9::3')).status).toBe(429);
    // same /64, right token: still locked
    expect((await call(env, good, '2001:db8:9:9::4')).status).toBe(429);
    // another address is not affected
    expect((await call(env, good, '198.51.100.9')).status).toBe(200);
  });
});
