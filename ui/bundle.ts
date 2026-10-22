// Template bundles: one zip with bundle.json, the templates' assets and (optionally) fonts.
// Templates refer to assets by alias -> name, so an import can rename clashing assets and keep the template working.
import type { Spec } from '../src/spec';
import { ASSET_NAME, bytes, get, send, sha256Hex, type Asset, type Font, type TemplateDetail } from './api';
import { makeZip, readZip } from './zip';

export interface BundleJson {
  type: 'svg-engine-bundle';
  version: 1;
  exported_at: string;
  chat?: { slug: string; name: string; description?: string };
  templates: { slug: string; name: string; spec: Spec }[];
  assets: { name: string; mime: string; path: string }[];
  fonts: { family: string; weight: number; style: string; license_note: string; path: string }[];
  /** Fonts the templates use but that were left out (license); the importer uploads them separately. */
  fonts_needed: { family: string; weight: number }[];
}

const EXT: Record<string, string> = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

function fontsUsed(specs: Spec[], fonts: Font[], defaultFamily?: string): Font[] {
  const fams = new Set<string>();
  const walk = (els: any[]) => {
    for (const e of els) {
      if (e.type === 'text') fams.add(typeof e.font === 'string' && fonts.some((f) => f.family === e.font) ? e.font : (defaultFamily ?? ''));
      if (e.children) walk(e.children);
    }
  };
  specs.forEach((s) => walk(s.elements));
  return fonts.filter((f) => fams.has(f.family));
}

export async function exportBundle(chat: { slug: string; name: string; description?: string }, slugs: string[], includeFonts: boolean): Promise<Blob> {
  const [assets, fonts, settings] = await Promise.all([get<Asset[]>('/assets'), get<Font[]>('/fonts'), get<Record<string, string>>('/settings')]);
  const templates: BundleJson['templates'] = [];
  for (const slug of slugs) {
    const t = await get<TemplateDetail>(`/chats/${chat.slug}/templates/${slug}`);
    templates.push({ slug, name: t.name, spec: t.draft });
  }
  const names = new Set(templates.flatMap((t) => Object.values(t.spec.assets ?? {})));
  const files: { name: string; data: Uint8Array }[] = [];
  const bAssets: BundleJson['assets'] = [];
  for (const a of assets.filter((x) => names.has(x.name))) {
    const path = `assets/${a.name}`;
    files.push({ name: path, data: await bytes(`/assets/${encodeURIComponent(a.name)}/raw`) });
    bAssets.push({ name: a.name, mime: a.mime, path });
  }
  const used = fontsUsed(templates.map((t) => t.spec), fonts, settings.default_font);
  const bFonts: BundleJson['fonts'] = [];
  if (includeFonts)
    for (const f of used) {
      const path = `fonts/${f.family.replace(/[^A-Za-z0-9가-힣._-]+/g, '_')}-${f.weight}${f.style === 'italic' ? 'i' : ''}.ttf`;
      files.push({ name: path, data: await bytes(`/fonts/${f.id}/raw`) });
      bFonts.push({ family: f.family, weight: f.weight, style: f.style, license_note: f.license_note, path });
    }
  const json: BundleJson = {
    type: 'svg-engine-bundle',
    version: 1,
    exported_at: new Date().toISOString(),
    chat,
    templates,
    assets: bAssets,
    fonts: bFonts,
    fonts_needed: includeFonts ? [] : used.map((f) => ({ family: f.family, weight: f.weight })),
  };
  files.unshift({ name: 'bundle.json', data: new TextEncoder().encode(JSON.stringify(json, null, 2)) });
  return makeZip(files);
}

export async function openBundle(file: File): Promise<{ json: BundleJson; files: Map<string, Uint8Array> }> {
  const files = await readZip(await file.arrayBuffer());
  const raw = files.get('bundle.json');
  if (!raw) throw new Error('bundle.json이 없는 zip이에요. 이 관리 화면에서 내보낸 파일인지 확인해 주세요.');
  const json = JSON.parse(new TextDecoder().decode(raw)) as BundleJson;
  if (json.type !== 'svg-engine-bundle' || !Array.isArray(json.templates)) throw new Error('템플릿 묶음 파일이 아니에요.');
  return { json, files };
}

export interface ImportPlan {
  chat: string;
  /** bundle slug -> slug to save as */
  slugs: Record<string, string>;
  publish: boolean;
}

export async function importBundle(b: { json: BundleJson; files: Map<string, Uint8Array> }, plan: ImportPlan, log: (s: string) => void) {
  const [assets, fonts] = await Promise.all([get<Asset[]>('/assets'), get<Font[]>('/fonts')]);
  const rename = new Map<string, string>(); // bundle asset name -> stored name
  for (const a of b.json.assets) {
    const data = b.files.get(a.path);
    if (!data || !ASSET_NAME.test(a.name) || !EXT[a.mime]) {
      log(`! 에셋 ${a.name}: 파일이 없거나 형식이 맞지 않아 건너뜀`);
      continue;
    }
    const sha = await sha256Hex(data);
    let name = a.name;
    const same = assets.find((x) => x.name === name);
    if (same && same.sha256 === sha) {
      log(`= 에셋 ${name}: 이미 같은 파일이 있음`);
      rename.set(a.name, name);
      continue;
    }
    if (same) {
      const pre = name.slice(0, name.indexOf('/') + 1); // keep the folder
      const file = name.slice(pre.length);
      const dot = file.lastIndexOf('.');
      const [base, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
      for (let k = 2; assets.some((x) => x.name === name); k++) name = `${pre}${base.slice(0, 56)}-${k}${ext}`;
    }
    await send('PUT', `/assets/${encodeURIComponent(name)}`, data, a.mime);
    assets.push({ name, sha256: sha } as Asset);
    rename.set(a.name, name);
    log(`+ 에셋 ${name}${name !== a.name ? ` (이름이 겹쳐 ${a.name}에서 바꿈)` : ''}`);
  }
  for (const f of b.json.fonts) {
    if (fonts.some((x) => x.family === f.family && x.weight === f.weight && x.style === f.style)) {
      log(`= 폰트 ${f.family} ${f.weight}: 이미 있음`);
      continue;
    }
    const data = b.files.get(f.path);
    if (!data) continue;
    const q = new URLSearchParams({ weight: String(f.weight), license: f.license_note ?? '' });
    if (f.style === 'italic') q.set('style', 'italic');
    await send('PUT', `/fonts/${encodeURIComponent(f.family)}?${q}`, data, 'application/octet-stream');
    log(`+ 폰트 ${f.family} ${f.weight}`);
  }
  for (const need of b.json.fonts_needed ?? [])
    if (!fonts.some((x) => x.family === need.family)) log(`! 폰트 ${need.family} ${need.weight}은 묶음에 없어요. 폰트 화면에서 직접 올려 주세요.`);

  const existing = await get<{ slug: string }[]>('/chats');
  if (!existing.some((c) => c.slug === plan.chat)) {
    const ch = b.json.chat?.slug === plan.chat ? b.json.chat : { name: plan.chat, description: '' };
    await send('PUT', `/chats/${plan.chat}`, { name: ch.name, description: ch.description ?? '' });
    log(`+ 채팅 ${plan.chat}`);
  }
  for (const t of b.json.templates) {
    const slug = plan.slugs[t.slug];
    if (!slug) continue;
    const spec: Spec = structuredClone(t.spec);
    if (spec.assets) for (const [alias, name] of Object.entries(spec.assets)) spec.assets[alias] = rename.get(name) ?? name;
    await send('PUT', `/chats/${plan.chat}/templates/${slug}?name=${encodeURIComponent(t.name)}`, spec);
    if (plan.publish) await send('POST', `/chats/${plan.chat}/templates/${slug}/publish`);
    log(`+ 템플릿 ${plan.chat}/${slug}${plan.publish ? ' (게시함)' : ' (초안)'}`);
  }
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
