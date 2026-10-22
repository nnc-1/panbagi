import type { AssetData, FontRef } from './compose';
import type { Env } from './env';
import type { Face } from './metrics';
import type { Spec } from './spec';

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- template lookup (per-isolate memo, short-lived) ------------------------------------------

export interface LoadedTemplate {
  version: number;
  spec: Spec;
}
const memo = new Map<string, { at: number; v: LoadedTemplate | null }>();
const MEMO_MS = 30_000;
const MISS_MS = 5_000; // unknown addresses are remembered only briefly (a just-published template shows up fast)
const MEMO_MAX = 200;

export function clearTemplateMemo() {
  memo.clear();
}

export async function loadTemplate(env: Env, chat: string, template: string, version?: number): Promise<LoadedTemplate | null> {
  const key = `${chat}/${template}@${version ?? ''}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < (hit.v ? MEMO_MS : MISS_MS)) return hit.v;
  const row = await env.DB.prepare(
    `SELECT tv.version AS version, tv.spec_json AS spec_json
       FROM templates t
       JOIN chats c ON c.id = t.chat_id
       JOIN template_versions tv ON tv.template_id = t.id AND tv.version = COALESCE(?3, t.published_version)
      WHERE c.slug = ?1 AND t.slug = ?2`,
  )
    .bind(chat, template, version ?? null)
    .first<{ version: number; spec_json: string }>();
  const v = row ? { version: row.version, spec: JSON.parse(row.spec_json) as Spec } : null;
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!); // oldest first; keeps random addresses from growing it
  memo.set(key, { at: Date.now(), v });
  return v;
}

// ---- assets & fonts ---------------------------------------------------------------------------

const assetMemo = new Map<string, AssetData>(); // sha -> bytes (isolate lifetime)

async function r2Bytes(env: Env, key: string): Promise<Uint8Array | null> {
  const o = await env.STORE.get(key);
  return o ? new Uint8Array(await o.arrayBuffer()) : null;
}

/** alias -> AssetData for every asset the spec declares (missing ones are skipped). */
export async function loadAssets(env: Env, spec: Spec): Promise<Map<string, AssetData>> {
  const out = new Map<string, AssetData>();
  const entries = Object.entries(spec.assets ?? {});
  if (!entries.length) return out;
  const names = [...new Set(entries.map(([, n]) => n))];
  const rows = await env.DB.prepare(
    `SELECT name, mime, sha256, r2_key FROM assets WHERE name IN (${names.map(() => '?').join(',')})`,
  )
    .bind(...names)
    .all<{ name: string; mime: string; sha256: string; r2_key: string }>();
  const byName = new Map(rows.results.map((r) => [r.name, r]));
  await Promise.all(
    entries.map(async ([alias, name]) => {
      const r = byName.get(name);
      if (!r) return;
      let a = assetMemo.get(r.sha256);
      if (!a) {
        const bytes = await r2Bytes(env, r.r2_key);
        if (!bytes) return;
        a = { mime: r.mime, bytes };
        if (bytes.length < 1_000_000) assetMemo.set(r.sha256, a);
      }
      out.set(alias, a);
    }),
  );
  return out;
}

const fontMemo = new Map<string, Uint8Array>();

/** Font buffers for the families a render uses (nearest weight per request); falls back to the default font. */
export async function loadFonts(env: Env, refs: FontRef[]): Promise<{ buffers: Uint8Array[]; faces: Face[]; defaultFamily?: string }> {
  const rows = await env.DB.prepare(`SELECT family, weight, sha256, r2_key FROM fonts ORDER BY id`).all<{
    family: string;
    weight: number;
    sha256: string;
    r2_key: string;
  }>();
  if (!rows.results.length) return { buffers: [], faces: [] };
  const def = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'default_font'`).first<{ value: string }>();
  const defaultFamily = def?.value && rows.results.some((r) => r.family === def.value) ? def.value : rows.results[0].family;

  const want = new Map<string, (typeof rows.results)[number]>();
  for (const ref of refs.length ? refs : [{ family: defaultFamily, weight: 400 }]) {
    const fam = rows.results.some((r) => r.family === ref.family) ? ref.family : defaultFamily;
    const best = rows.results.filter((r) => r.family === fam).sort((a, b) => Math.abs(a.weight - ref.weight) - Math.abs(b.weight - ref.weight))[0];
    want.set(best.sha256, best);
  }
  // Always include the default family so unknown/empty font names still draw Korean glyphs.
  if (![...want.values()].some((r) => r.family === defaultFamily)) {
    const d = rows.results.find((r) => r.family === defaultFamily)!;
    want.set(d.sha256, d);
  }
  const faces = await Promise.all(
    [...want.values()].map(async (r) => {
      let b = fontMemo.get(r.sha256);
      if (!b) {
        b = (await r2Bytes(env, r.r2_key)) ?? undefined;
        if (b) fontMemo.set(r.sha256, b);
      }
      return b && { family: r.family, weight: r.weight, bytes: b };
    }),
  );
  const ok = faces.filter((f): f is Face => !!f);
  return { buffers: ok.map((f) => f.bytes), faces: ok, defaultFamily };
}

// ---- rendered copies (R2 renders/) ------------------------------------------------------------

export const renderKey = (chat: string, template: string, hash: string, ext: string) => `renders/${chat}/${template}/${hash}.${ext}`;

/** Delete rendered copies older than ttl. Called hourly by the cron trigger. */
export async function purgeExpired(env: Env, ttlSeconds: number, now = Date.now()): Promise<number> {
  const cutoff = now - ttlSeconds * 1000;
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await env.STORE.list({ prefix: 'renders/', cursor, limit: 1000 });
    const old = page.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
    if (old.length) {
      await env.STORE.delete(old);
      deleted += old.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
