// Browser-side preview: the same composeSvg the Worker uses, drawn by the browser instead of resvg.
// No Worker CPU is spent while editing; "서버로 렌더" shows the exact PNG when needed.
import { composeSvg, estimateEm, type AssetData } from '../src/compose';
import { makeMeasure, type Face } from '../src/metrics';
import { normalizeParams } from '../src/params';
import type { Spec } from '../src/spec';
import { bytes, type Asset, type Font } from './api';

// ---- assets (bytes + blob URLs), cached for the session ----
const assetCache = new Map<string, Promise<{ data: AssetData; url: string } | null>>(); // key: sha256

export function loadAsset(a: Asset) {
  let p = assetCache.get(a.sha256);
  if (!p) {
    p = bytes(`/assets/${encodeURIComponent(a.name)}/raw`)
      .then((b) => ({ data: { mime: a.mime, bytes: b }, url: URL.createObjectURL(new Blob([b as BlobPart], { type: a.mime })) }))
      .catch(() => null);
    assetCache.set(a.sha256, p);
  }
  return p;
}

/** alias -> asset data for the spec (unknown names are skipped, like the Worker does). */
export async function assetsFor(spec: Spec, library: Asset[]) {
  const map = new Map<string, AssetData>();
  const urls = new Map<AssetData, string>();
  await Promise.all(
    Object.entries(spec.assets ?? {}).map(async ([alias, name]) => {
      const a = library.find((x) => x.name === name);
      const got = a && (await loadAsset(a));
      if (got) {
        map.set(alias, got.data);
        urls.set(got.data, got.url);
      }
    }),
  );
  return { map, urls };
}

// ---- fonts (FontFace API; shadow DOM content sees document fonts) ----
const fontCache = new Map<number, Promise<boolean>>();
/** bytes of every loaded font, so fitted text is measured with the same metrics the Worker uses */
const faces: Face[] = [];

export function loadFont(f: Font): Promise<boolean> {
  let p = fontCache.get(f.id);
  if (!p) {
    p = bytes(`/fonts/${f.id}/raw`)
      .then(async (b) => {
        const face = new FontFace(f.family, b as BufferSource, { weight: String(f.weight), style: f.style });
        await face.load();
        document.fonts.add(face);
        faces.push({ family: f.family, weight: f.weight, bytes: b });
        return true;
      })
      .catch(() => false);
    fontCache.set(f.id, p);
  }
  return p;
}

/** Load only the families the spec uses, plus the default font. */
export function fontsFor(spec: Spec, fonts: Font[], defaultFamily: string | undefined) {
  const json = JSON.stringify(spec.elements);
  const want = fonts.filter((f) => f.family === defaultFamily || json.includes(`"font":"${f.family.replace(/"/g, '\\"')}"`));
  return Promise.all(want.map(loadFont));
}

// ---- compose + sanitize ----
export function composeForPreview(
  spec: Spec,
  values: Record<string, string>,
  assets: { map: Map<string, AssetData>; urls: Map<AssetData, string> },
  defaultFamily?: string,
) {
  const { values: v } = normalizeParams(spec, values);
  return composeSvg(spec, v, assets.map, { imageHref: (_a, data) => assets.urls.get(data), measure: makeMeasure(faces, defaultFamily, estimateEm) }).svg;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const DROP = new Set(['script', 'foreignobject', 'iframe', 'animate', 'set', 'animatemotion', 'animatetransform', 'a', 'handler', 'listener']);

/**
 * Parse the composed SVG into inert nodes and drop anything active before it touches the page.
 * Uploaded SVGs are already cleaned by the Worker; this is a second wall for imported bundles.
 */
export function toSafeNode(svg: string, fontFallback: string | undefined, knownFamilies: Set<string>): Element | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) return null;
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      // only SVG elements: an HTML one slipped in (meta refresh, iframe, embed...) could act even outside foreignObject
      if (c.namespaceURI !== SVG_NS || DROP.has(c.localName.toLowerCase())) {
        c.remove();
        continue;
      }
      walk(c);
    }
    for (const at of [...el.attributes]) {
      const name = at.localName.toLowerCase(); // without the prefix: xlink:href under any prefix (xl:href) is still an href
      const v = at.value.trim();
      if (name.startsWith('on')) el.removeAttribute(at.name);
      else if (name === 'href' && !(v.startsWith('#') || v.startsWith('blob:') || /^data:image\/(png|jpe?g|webp|gif);/i.test(v))) el.removeAttribute(at.name);
      else if (name === 'style' && /url\(\s*['"]?(?!#)|@import|expression/i.test(v)) el.removeAttribute(at.name);
      else if (name === 'font-family' && fontFallback && !knownFamilies.has(v)) el.setAttribute('font-family', `"${v}", "${fontFallback}"`);
    }
    if (el.localName === 'style') el.textContent = (el.textContent ?? '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
  };
  walk(root);
  return document.importNode(root, true);
}
