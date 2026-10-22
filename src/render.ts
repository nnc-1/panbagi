import { composeSvg, estimateEm } from './compose';
import type { Config, Env } from './env';
import { normalizeParams } from './params';
import { rasterize, type Format } from './raster';
import type { Spec } from './spec';
import { makeMeasure } from './metrics';
import { loadAssets, loadFonts } from './store';

/** Compose + flatten one image. Shared by the public route and the admin preview. */
export async function renderImage(env: Env, cfg: Config, spec: Spec, query: URLSearchParams | Record<string, string>, format: Format) {
  const t0 = performance.now();
  const { values, normalized } = normalizeParams(spec, query);
  const assets = await loadAssets(env, spec);
  const t1 = performance.now();
  let composed = composeSvg(spec, values, assets);
  const t2 = performance.now();
  const fonts = await loadFonts(env, composed.fonts);
  // text set to "shrink" is sized from the real fonts: compose again now that they are loaded (cheap, no raster)
  if (JSON.stringify(spec.elements).includes('"fit":"shrink"'))
    composed = composeSvg(spec, values, assets, { measure: makeMeasure(fonts.faces, fonts.defaultFamily, estimateEm) });
  const t3 = performance.now();
  const scale = Math.min(2, Math.max(0.25, (spec.canvas.scale ?? 1) * cfg.renderScale));
  const longSide = Math.max(spec.canvas.w, spec.canvas.h) * scale;
  const width = Math.round(spec.canvas.w * scale * Math.min(1, cfg.maxPixels / longSide));
  const bytes = await rasterize(composed.svg, {
    width,
    format,
    fonts: fonts.buffers,
    defaultFamily: fonts.defaultFamily,
    background: spec.canvas.background,
  });
  const t4 = performance.now();
  // Durations in ms. In Workers the clock only advances on I/O, so compose/raster read ~0 there;
  // use `wrangler tail --format json` (cpuTime) for the real CPU number.
  const timing = { load: t1 - t0, compose: t2 - t1, fonts: t3 - t2, raster: t4 - t3, total: t4 - t0 };
  // an asset the spec names but the store lacks (deleted, or renamed a moment ago while this isolate still had the old spec)
  const incomplete = assets.size < Object.keys(spec.assets ?? {}).length;
  return { bytes, normalized, svg: composed.svg, timing, incomplete };
}
