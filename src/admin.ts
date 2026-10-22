import { Hono } from 'hono';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import webpWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm';
import { readConfig, type Env } from './env';
import { initRaster, initWebpEncoder } from './raster';
import { renderImage } from './render';
import { sanitizeSvg } from './sanitize';
import { ASSET_NAME, renameAssetRefs, validateSpec } from './spec';
import { clearTemplateMemo, purgeExpired, sha256Hex } from './store';

export const admin = new Hono<{ Bindings: Env }>();

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let d = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) d |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return d === 0;
}

admin.use('*', async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return c.json({ error: 'ADMIN_TOKEN is not configured' }, 503);
  if (token.length < 16) return c.json({ error: 'ADMIN_TOKEN must be at least 16 characters' }, 503);
  const given = c.req.header('x-admin-token') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!safeEqual(given, token)) {
    // Guessing is slowed down per visitor: after 30 wrong tokens a minute, wait.
    const ip = c.req.header('cf-connecting-ip') ?? 'anon';
    if (c.env.AUTH_LIMITER && !(await c.env.AUTH_LIMITER.limit({ key: `auth:${ip}` })).success)
      return c.json({ error: 'too many attempts' }, 429, { 'Retry-After': '60' });
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
  c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
});

const KINDS: Record<string, { kind: string; mime: string }> = {
  'image/svg+xml': { kind: 'svg', mime: 'image/svg+xml' },
  'image/png': { kind: 'png', mime: 'image/png' },
  'image/webp': { kind: 'webp', mime: 'image/webp' },
  'image/jpeg': { kind: 'jpg', mime: 'image/jpeg' },
};

// ---- assets ----
admin.put('/assets/:name', async (c) => {
  const name = c.req.param('name');
  if (!ASSET_NAME.test(name)) return c.json({ error: 'bad asset name' }, 400);
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim();
  const k = KINDS[type];
  if (!k) return c.json({ error: 'content-type must be svg/png/webp/jpeg' }, 415);
  let bytes: Uint8Array = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > 5_000_000) return c.json({ error: 'size must be 1B..5MB' }, 413);
  if (k.kind === 'svg') {
    const clean = sanitizeSvg(new TextDecoder().decode(bytes));
    if (clean === null) return c.json({ error: 'not an svg' }, 400);
    bytes = new TextEncoder().encode(clean);
  }
  const sha = await sha256Hex(bytes);
  const key = `assets/${sha}`;
  await c.env.STORE.put(key, bytes, { httpMetadata: { contentType: k.mime } });
  await c.env.DB.prepare(
    `INSERT INTO assets (name, kind, mime, bytes, sha256, r2_key) VALUES (?1,?2,?3,?4,?5,?6)
     ON CONFLICT(name) DO UPDATE SET kind=?2, mime=?3, bytes=?4, sha256=?5, r2_key=?6`,
  )
    .bind(name, k.kind, k.mime, bytes.length, sha, key)
    .run();
  return c.json({ name, kind: k.kind, bytes: bytes.length, sha256: sha });
});

admin.get('/assets', async (c) =>
  c.json((await c.env.DB.prepare(`SELECT name, kind, mime, bytes, sha256, created_at FROM assets ORDER BY name`).all()).results),
);

admin.get('/assets/:name/raw', async (c) => {
  const r = await c.env.DB.prepare(`SELECT mime, r2_key FROM assets WHERE name = ?`).bind(c.req.param('name')).first<{ mime: string; r2_key: string }>();
  const o = r && (await c.env.STORE.get(r.r2_key));
  if (!r || !o) return c.json({ error: 'not found' }, 404);
  return new Response(o.body, { headers: { 'Content-Type': r.mime, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
});

admin.delete('/assets/:name', async (c) => {
  const r = await c.env.DB.prepare(`SELECT sha256, r2_key FROM assets WHERE name = ?`).bind(c.req.param('name')).first<{ sha256: string; r2_key: string }>();
  if (!r) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare(`DELETE FROM assets WHERE name = ?`).bind(c.req.param('name')).run();
  await dropIfUnused(c.env, 'assets', r.sha256, r.r2_key);
  return c.json({ deleted: c.req.param('name') });
});

/** Rename an asset (this is how it moves between folders). Templates that use it, drafts and published versions alike, follow along. */
admin.post('/assets/:name/move', async (c) => {
  const from = c.req.param('name');
  const b = await c.req.json<{ to?: string }>().catch(() => ({}) as { to?: string });
  const to = String(b.to ?? '');
  if (!ASSET_NAME.test(to)) return c.json({ error: 'bad asset name' }, 400);
  if (to === from) return c.json({ name: to });
  if (!(await c.env.DB.prepare(`SELECT 1 AS x FROM assets WHERE name = ?`).bind(from).first())) return c.json({ error: 'not found' }, 404);
  if (await c.env.DB.prepare(`SELECT 1 AS x FROM assets WHERE name = ?`).bind(to).first()) return c.json({ error: 'name taken' }, 409);
  const like = `%${JSON.stringify(from)}%`; // cheap pre-filter; renameAssetRefs checks the asset map exactly
  const stmts = [c.env.DB.prepare(`UPDATE assets SET name = ?2 WHERE name = ?1`).bind(from, to)];
  const drafts = (await c.env.DB.prepare(`SELECT id, draft_spec AS j FROM templates WHERE draft_spec LIKE ?`).bind(like).all<{ id: number; j: string }>()).results;
  for (const r of drafts) {
    const j = renameAssetRefs(r.j, from, to);
    if (j) stmts.push(c.env.DB.prepare(`UPDATE templates SET draft_spec = ?2 WHERE id = ?1`).bind(r.id, j));
  }
  const versions = (
    await c.env.DB.prepare(`SELECT template_id AS id, version AS v, spec_json AS j FROM template_versions WHERE spec_json LIKE ?`).bind(like).all<{ id: number; v: number; j: string }>()
  ).results;
  for (const r of versions) {
    const j = renameAssetRefs(r.j, from, to);
    // the picture is unchanged, so spec_hash (and every cached render) stays valid
    if (j) stmts.push(c.env.DB.prepare(`UPDATE template_versions SET spec_json = ?3 WHERE template_id = ?1 AND version = ?2`).bind(r.id, r.v, j));
  }
  await c.env.DB.batch(stmts);
  clearTemplateMemo();
  return c.json({ name: to, templates: stmts.length - 1 });
});

/** R2 objects are keyed by content hash, so another row may still point at the same file. */
async function dropIfUnused(env: Env, table: 'assets' | 'fonts', sha: string, key: string) {
  const still = await env.DB.prepare(`SELECT 1 AS x FROM ${table} WHERE sha256 = ? LIMIT 1`).bind(sha).first();
  if (!still) await env.STORE.delete(key);
}

// ---- fonts ----
admin.put('/fonts/:family', async (c) => {
  const family = c.req.param('family');
  const weight = Number(c.req.query('weight') ?? 400);
  const style = c.req.query('style') === 'italic' ? 'italic' : 'normal';
  if (!/^[^\0<>"]{1,64}$/.test(family) || !(weight >= 100 && weight <= 900)) return c.json({ error: 'bad family/weight' }, 400);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 25_000_000) return c.json({ error: 'font size must be 1KB..25MB (ttf/otf)' }, 413);
  const sha = await sha256Hex(bytes);
  const key = `fonts/${sha}`;
  await c.env.STORE.put(key, bytes, { httpMetadata: { contentType: 'font/ttf' } });
  await c.env.DB.prepare(
    `INSERT INTO fonts (family, weight, style, bytes, sha256, r2_key, license_note) VALUES (?1,?2,?3,?4,?5,?6,?7)
     ON CONFLICT(family, weight, style) DO UPDATE SET bytes=?4, sha256=?5, r2_key=?6, license_note=?7`,
  )
    .bind(family, weight, style, bytes.length, sha, key, c.req.query('license') ?? '')
    .run();
  return c.json({ family, weight, style, bytes: bytes.length });
});

admin.get('/fonts', async (c) =>
  c.json((await c.env.DB.prepare(`SELECT id, family, weight, style, bytes, license_note FROM fonts ORDER BY family, weight`).all()).results),
);

admin.get('/fonts/:id/raw', async (c) => {
  const r = await c.env.DB.prepare(`SELECT r2_key FROM fonts WHERE id = ?`).bind(Number(c.req.param('id'))).first<{ r2_key: string }>();
  const o = r && (await c.env.STORE.get(r.r2_key));
  if (!r || !o) return c.json({ error: 'not found' }, 404);
  return new Response(o.body, { headers: { 'Content-Type': 'font/ttf', 'Cache-Control': 'private, max-age=3600' } });
});

admin.delete('/fonts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const r = await c.env.DB.prepare(`SELECT sha256, r2_key FROM fonts WHERE id = ?`).bind(id).first<{ sha256: string; r2_key: string }>();
  if (!r) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare(`DELETE FROM fonts WHERE id = ?`).bind(id).run();
  await dropIfUnused(c.env, 'fonts', r.sha256, r.r2_key);
  return c.json({ deleted: id });
});

admin.get('/settings', async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT key, value FROM settings`).all<{ key: string; value: string }>()).results;
  return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

admin.put('/settings/:key', async (c) => {
  if (!/^[^\0]{1,120}$/.test(c.req.param('key'))) return c.json({ error: 'bad key' }, 400);
  const body = await c.req.text();
  await c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2`).bind(c.req.param('key'), body.slice(0, 500)).run();
  return c.json({ ok: true });
});

// ---- chats & templates ----
admin.put('/chats/:chat', async (c) => {
  const slug = c.req.param('chat');
  if (!SLUG.test(slug)) return c.json({ error: 'bad chat slug' }, 400);
  const b = await c.req.json<{ name?: string; description?: string }>().catch(() => ({}) as { name?: string; description?: string });
  await c.env.DB.prepare(
    `INSERT INTO chats (slug, name, description) VALUES (?1,?2,?3) ON CONFLICT(slug) DO UPDATE SET name=?2, description=?3`,
  )
    .bind(slug, b.name || slug, b.description ?? '')
    .run();
  return c.json({ slug });
});

admin.get('/chats', async (c) => {
  const chats = (await c.env.DB.prepare(`SELECT id, slug, name, description FROM chats ORDER BY slug`).all<{ id: number; slug: string; name: string; description: string }>()).results;
  const tpls = (
    await c.env.DB.prepare(`SELECT chat_id, slug, name, published_version, updated_at FROM templates ORDER BY slug`).all<{
      chat_id: number;
      slug: string;
      name: string;
      published_version: number | null;
      updated_at: string;
    }>()
  ).results;
  return c.json(
    chats.map(({ id, ...ch }) => ({ ...ch, templates: tpls.filter((t) => t.chat_id === id).map(({ chat_id, ...t }) => t) })),
  );
});

admin.delete('/chats/:chat', async (c) => {
  const row = await c.env.DB.prepare(`SELECT id FROM chats WHERE slug = ?`).bind(c.req.param('chat')).first<{ id: number }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM template_versions WHERE template_id IN (SELECT id FROM templates WHERE chat_id = ?)`).bind(row.id),
    c.env.DB.prepare(`DELETE FROM templates WHERE chat_id = ?`).bind(row.id),
    c.env.DB.prepare(`DELETE FROM chats WHERE id = ?`).bind(row.id),
  ]);
  clearTemplateMemo();
  return c.json({ deleted: c.req.param('chat') });
});

/** Every template's draft (the UI uses it to show which templates use an asset or font). */
admin.get('/templates', async (c) =>
  c.json(
    (
      await c.env.DB.prepare(`SELECT c.slug AS chat, t.slug AS template, t.name AS name, t.draft_spec AS draft FROM templates t JOIN chats c ON c.id = t.chat_id`).all<{
        chat: string;
        template: string;
        name: string;
        draft: string;
      }>()
    ).results.map((r) => ({ ...r, draft: JSON.parse(r.draft) })),
  ),
);

const findTemplate = (env: Env, chat: string, tpl: string) =>
  env.DB.prepare(
    `SELECT t.id AS id, t.name AS name, t.draft_spec AS draft, t.published_version AS published_version, t.updated_at AS updated_at
       FROM templates t JOIN chats c ON c.id = t.chat_id WHERE c.slug = ?1 AND t.slug = ?2`,
  )
    .bind(chat, tpl)
    .first<{ id: number; name: string; draft: string; published_version: number | null; updated_at: string }>();

admin.get('/chats/:chat/templates/:tpl', async (c) => {
  const { chat, tpl } = c.req.param();
  const t = await findTemplate(c.env, chat, tpl);
  if (!t) return c.json({ error: 'not found' }, 404);
  const versions = (await c.env.DB.prepare(`SELECT version, spec_hash, published_at FROM template_versions WHERE template_id = ? ORDER BY version DESC`).bind(t.id).all()).results;
  return c.json({ chat, template: tpl, name: t.name, draft: JSON.parse(t.draft), published_version: t.published_version, updated_at: t.updated_at, versions });
});

admin.get('/chats/:chat/templates/:tpl/versions/:v', async (c) => {
  const { chat, tpl, v } = c.req.param();
  const t = await findTemplate(c.env, chat, tpl);
  const row = t && (await c.env.DB.prepare(`SELECT spec_json FROM template_versions WHERE template_id = ? AND version = ?`).bind(t.id, Number(v)).first<{ spec_json: string }>());
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(JSON.parse(row.spec_json));
});

/** Point the public address back at an earlier published version (versions themselves never change). */
admin.post('/chats/:chat/templates/:tpl/rollback', async (c) => {
  const { chat, tpl } = c.req.param();
  const b = await c.req.json<{ version?: number }>().catch(() => ({}) as { version?: number });
  const t = await findTemplate(c.env, chat, tpl);
  if (!t) return c.json({ error: 'not found' }, 404);
  const ok = await c.env.DB.prepare(`SELECT 1 AS x FROM template_versions WHERE template_id = ? AND version = ?`).bind(t.id, Number(b.version)).first();
  if (!ok) return c.json({ error: 'no such version' }, 404);
  await c.env.DB.prepare(`UPDATE templates SET published_version = ?2, updated_at = datetime('now') WHERE id = ?1`).bind(t.id, Number(b.version)).run();
  clearTemplateMemo();
  return c.json({ chat, template: tpl, version: Number(b.version) });
});

admin.delete('/chats/:chat/templates/:tpl', async (c) => {
  const { chat, tpl } = c.req.param();
  const t = await findTemplate(c.env, chat, tpl);
  if (!t) return c.json({ error: 'not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM template_versions WHERE template_id = ?`).bind(t.id),
    c.env.DB.prepare(`DELETE FROM templates WHERE id = ?`).bind(t.id),
  ]);
  clearTemplateMemo();
  return c.json({ deleted: `${chat}/${tpl}` });
});

admin.put('/chats/:chat/templates/:tpl', async (c) => {
  const { chat, tpl } = c.req.param();
  if (!SLUG.test(tpl)) return c.json({ error: 'bad template slug' }, 400);
  const spec = await c.req.json().catch(() => null);
  const errs = validateSpec(spec);
  if (errs.length) return c.json({ error: 'invalid spec', problems: errs }, 400);
  const row = await c.env.DB.prepare(`SELECT id FROM chats WHERE slug = ?`).bind(chat).first<{ id: number }>();
  if (!row) return c.json({ error: 'unknown chat; create it first' }, 404);
  await c.env.DB.prepare(
    `INSERT INTO templates (chat_id, slug, name, draft_spec) VALUES (?1,?2,COALESCE(?4,?2),?3)
     ON CONFLICT(chat_id, slug) DO UPDATE SET draft_spec=?3, name=COALESCE(?4,name), updated_at=datetime('now')`,
  )
    .bind(row.id, tpl, JSON.stringify(spec), c.req.query('name')?.slice(0, 80) || null)
    .run();
  return c.json({ chat, template: tpl, saved: 'draft' });
});

admin.post('/chats/:chat/templates/:tpl/publish', async (c) => {
  const { chat, tpl } = c.req.param();
  const t = await c.env.DB.prepare(
    `SELECT t.id AS id, t.draft_spec AS draft FROM templates t JOIN chats c ON c.id = t.chat_id WHERE c.slug=?1 AND t.slug=?2`,
  )
    .bind(chat, tpl)
    .first<{ id: number; draft: string }>();
  if (!t) return c.json({ error: 'not found' }, 404);
  const next = ((await c.env.DB.prepare(`SELECT MAX(version) AS v FROM template_versions WHERE template_id=?`).bind(t.id).first<{ v: number | null }>())?.v ?? 0) + 1;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO template_versions (template_id, version, spec_json, spec_hash) VALUES (?1,?2,?3,?4)`).bind(t.id, next, t.draft, await sha256Hex(t.draft)),
    c.env.DB.prepare(`UPDATE templates SET published_version=?2, updated_at=datetime('now') WHERE id=?1`).bind(t.id, next),
  ]);
  clearTemplateMemo();
  return c.json({ chat, template: tpl, version: next });
});

// Preview: render a spec (or a template's draft) with values; nothing is stored.
admin.post('/preview', async (c) => {
  const b = await c.req.json<{ spec?: unknown; chat?: string; template?: string; values?: Record<string, string>; format?: 'png' | 'jpg' | 'webp' }>().catch(() => null);
  if (!b) return c.json({ error: 'bad json' }, 400);
  let spec: any = b.spec;
  if (!spec && b.chat && b.template) {
    const r = await c.env.DB.prepare(`SELECT t.draft_spec AS d FROM templates t JOIN chats c ON c.id=t.chat_id WHERE c.slug=?1 AND t.slug=?2`).bind(b.chat, b.template).first<{ d: string }>();
    spec = r && JSON.parse(r.d);
  }
  const errs = validateSpec(spec);
  if (errs.length) return c.json({ error: 'invalid spec', problems: errs }, 400);
  await initRaster(resvgWasm);
  const format = b.format === 'jpg' ? 'jpg' : b.format === 'png' ? 'png' : 'webp';
  if (format === 'webp') await initWebpEncoder(webpWasm);
  const { bytes } = await renderImage(c.env, readConfig(c.env), spec, b.values ?? {}, format);
  return new Response(bytes, { headers: { 'Content-Type': { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format], 'Cache-Control': 'no-store' } });
});

admin.post('/purge', async (c) => c.json({ deleted: await purgeExpired(c.env, readConfig(c.env).ttlSeconds) }));
