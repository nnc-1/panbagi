// Installs the sample templates ("hud", "lite"), their icons and the subset fonts through the admin API.
//   BASE_URL=https://svg-engine.<you>.workers.dev ADMIN_TOKEN=<token> node scripts/seed.mjs [chat-slug]
// Fonts come from public/_seed/fonts/*.ttf (make them with `npm run font:subset`). FONT_FAMILY overrides the family name.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const base = (process.env.BASE_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error('ADMIN_TOKEN 환경변수가 필요해요');
const chat = process.argv[2] ?? 'demo';
const family = process.env.FONT_FAMILY ?? 'Noto Sans KR';

async function call(method, path, body, type = 'application/json') {
  const r = await fetch(base + path, { method, headers: { 'x-admin-token': token, 'content-type': type }, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  console.log('ok', method, path);
  return text;
}

const assets = new URL('../public/_seed/assets/', import.meta.url);
for (const f of readdirSync(assets)) await call('PUT', `/api/admin/assets/${f}`, readFileSync(new URL(f, assets)), 'image/svg+xml');

const fontDir = new URL('../public/_seed/fonts/', import.meta.url);
const fonts = existsSync(fontDir) ? readdirSync(fontDir).filter((f) => /\.(ttf|otf)$/i.test(f)) : [];
if (!fonts.length) console.warn('!! public/_seed/fonts/ 폴더에 폰트가 없어요. 먼저 `npm run font:subset`을 실행하세요. (한글이 네모로 나옵니다)');
for (const f of fonts) {
  const weight = /700|bold/i.test(f) ? 700 : 400;
  await call('PUT', `/api/admin/fonts/${encodeURIComponent(family)}?weight=${weight}`, readFileSync(new URL(f, fontDir)), 'application/octet-stream');
}
if (fonts.length) await call('PUT', '/api/admin/settings/default_font', family, 'text/plain');

await call('PUT', `/api/admin/chats/${chat}`, JSON.stringify({ name: chat }));
for (const t of ['hud', 'lite']) {
  await call('PUT', `/api/admin/chats/${chat}/templates/${t}`, readFileSync(new URL(`../samples/${t}.json`, import.meta.url), 'utf8'));
  console.log(await call('POST', `/api/admin/chats/${chat}/templates/${t}/publish`, ''));
}
console.log(`\n확인해 보세요:\n  ${base}/${chat}/lite.webp?name=도키&hp=72\n  ${base}/${chat}/hud.webp?name=도키&hp=72&p1=전사&p1n=피오나`);
