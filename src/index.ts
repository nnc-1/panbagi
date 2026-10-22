import { Hono } from 'hono';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import webpWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm';
import { admin } from './admin';
import { readConfig, type Env } from './env';
import { initRaster, initWebpEncoder, type Format } from './raster';
import { normalizeParams } from './params';
import { renderImage } from './render';
import { loadTemplate, purgeExpired, renderKey, sha256Hex } from './store';

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const RESERVED = new Set(['admin', 'api']);
const MIME: Record<Format, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const serverTiming = (t: Record<string, number>) => Object.entries(t).map(([k, v]) => `${k};dur=${v.toFixed(1)}`).join(', ');

const app = new Hono<{ Bindings: Env }>();

/** The admin UI's address: one path segment from the ADMIN_PATH secret, else "admin". */
export function adminPath(env: Env): string {
  const p = (env.ADMIN_PATH ?? '').trim().replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9_-]{1,64}$/.test(p) && !RESERVED.has(p.toLowerCase()) ? p : 'admin';
}

/**
 * Headers for the admin UI page. The token lives in localStorage, so the page only runs its own script
 * (no inline or outside code, even from an imported template), cannot be framed, and sends no referrer.
 * Inline styles stay allowed: previews put the template's SVG (with its <style>) in the page.
 */
export const ADMIN_PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; " +
    "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};

// Admin UI files (public/admin/) under the chosen address. With a custom address, /admin is just "not found".
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const seg = url.pathname.split('/')[1] ?? '';
  const ap = adminPath(c.env);
  if (seg === ap && c.env.ASSETS) {
    if (url.pathname === '/' + ap) return c.redirect(`/${ap}/${url.search}`, 301); // the page loads app.js relative to itself
    const res = await c.env.ASSETS.fetch(new Request(new URL('/admin/' + url.pathname.slice(ap.length + 2) + url.search, url), c.req.raw));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(ADMIN_PAGE_HEADERS)) out.headers.set(k, v);
    return out;
  }
  if (seg === 'admin') return c.text('not found', 404, { 'Cache-Control': 'no-store' });
  await next();
});

app.route('/api/admin', admin);

app.get('/healthz', (c) => c.text('ok'));

// Public image route: /{chat}/{template}[@version].{webp|png|jpg}?values
app.get('/:chat/:file', async (c) => {
  const { chat, file } = c.req.param();
  const m = /^([a-z0-9][a-z0-9-]{0,47})(?:@(\d{1,6}))?\.(png|webp|jpe?g)$/.exec(file);
  if (!m || !SLUG.test(chat) || RESERVED.has(chat)) return c.text('not found', 404);
  const [, template, ver, ext] = m;
  const format: Format = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpg';
  const env = c.env;
  const cfg = readConfig(env);
  if (format === 'jpg' && !cfg.enableJpg) return c.text('jpg is disabled; use .png (or set ENABLE_JPG=true)', 404);

  const tpl = await loadTemplate(env, chat, template, ver ? Number(ver) : undefined);
  if (!tpl) return c.text('not found', 404);

  const { normalized } = normalizeParams(tpl.spec, new URL(c.req.url).searchParams);
  const hash = await sha256Hex(`${chat}/${template}@${tpl.version}\n${normalized}\n${format}\nscale=${cfg.renderScale}`);
  const key = renderKey(chat, template, hash, format);
  const headers = (maxAge: number) => ({
    'Content-Type': MIME[format],
    'Cache-Control': `public, max-age=${maxAge}`,
    'X-Content-Type-Options': 'nosniff',
    'X-Render-Key': hash.slice(0, 16),
  });

  // 1) edge cache (custom domains only)
  const cacheKey = new Request(`https://render-cache.invalid/${key}`);
  const edge = (globalThis as any).caches?.default as Cache | undefined;
  const cached = await edge?.match(cacheKey);
  if (cached) return cached;

  // 2) stored copy in R2 — ignore it once past its lifetime (cron may not have run yet)
  const stored = await env.STORE.get(key);
  if (stored) {
    const remaining = cfg.ttlSeconds - Math.floor((Date.now() - stored.uploaded.getTime()) / 1000);
    if (remaining > 0) {
      const res = new Response(stored.body, { headers: { ...headers(remaining), 'X-Render': 'stored' } });
      if (edge) c.executionCtx.waitUntil(edge.put(cacheKey, res.clone())); // clone now: the body is locked once returned
      return res;
    }
  }

  // 3) render. Only new renders are rate limited; stored copies are cheap to serve.
  if (env.RATE_LIMITER) {
    const ip = c.req.header('cf-connecting-ip') ?? 'anon';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return c.text('too many requests', 429, { 'Retry-After': '30', 'Cache-Control': 'no-store' });
  }
  await initRaster(resvgWasm);
  if (format === 'webp') await initWebpEncoder(webpWasm);
  let bytes: Uint8Array;
  let timing: { load: number; compose: number; fonts: number; raster: number; total: number };
  let incomplete: boolean;
  try {
    ({ bytes, timing, incomplete } = await renderImage(env, cfg, tpl.spec, new URL(c.req.url).searchParams, format));
  } catch (e) {
    console.error('render failed', chat, template, e);
    return c.text('render failed', 500, { 'Cache-Control': 'no-store' });
  }
  // a picture with a missing asset is served briefly and never stored, so it heals once the asset is back
  const res = new Response(bytes, { headers: { ...headers(incomplete ? 60 : cfg.ttlSeconds), 'X-Render': incomplete ? 'incomplete' : 'fresh', 'Server-Timing': serverTiming(timing) } });
  if (incomplete) return res;
  const forEdge = edge ? res.clone() : null; // clone now: the body is locked once returned
  c.executionCtx.waitUntil(
    (async () => {
      await env.STORE.put(key, bytes, { httpMetadata: { contentType: MIME[format] } });
      if (edge && forEdge) await edge.put(cacheKey, forEdge);
    })(),
  );
  return res;
});

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(purgeExpired(env, readConfig(env).ttlSeconds).then((n) => console.log(`purged ${n} stored renders`)));
  },
} satisfies ExportedHandler<Env>;
