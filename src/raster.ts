import { Resvg, initWasm } from '@resvg/resvg-wasm';
import jpeg from 'jpeg-js';
import { encodeWebp, initWebp } from './webp';

export type Format = 'png' | 'jpg' | 'webp';

let ready: Promise<void> | undefined;
/** Call once with the resvg wasm module (Worker: static import; Node tests: file bytes). */
export function initRaster(wasm: WebAssembly.Module | BufferSource): Promise<void> {
  return (ready ??= initWasm(wasm));
}

/** WebP needs its own encoder (libwebp wasm); started only when a .webp is asked for. */
export const initWebpEncoder = (wasm: WebAssembly.Module | BufferSource) => initWebp(wasm);

export interface RasterOptions {
  width: number; // output pixel width (canvas.w * scale)
  format: Format;
  fonts: Uint8Array[];
  defaultFamily?: string;
  background?: string; // used for JPG (no alpha) — PNG stays transparent when omitted
  quality?: number;
}

/** Flatten an internal SVG into a PNG/WebP/JPG byte array. Never follows external references. */
export async function rasterize(svg: string, o: RasterOptions): Promise<Uint8Array> {
  if (!ready) throw new Error('rasterizer not initialised');
  await ready;
  const bg = o.format === 'jpg' ? (o.background ?? '#ffffff') : o.background;
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.max(1, Math.round(o.width)) },
    background: bg,
    font: {
      fontBuffers: o.fonts,
      loadSystemFonts: false,
      defaultFontFamily: o.defaultFamily,
    },
  });
  const img = r.render();
  try {
    if (o.format === 'png') return img.asPng();
    // lossless: pixels identical to the PNG (text stays crisp), usually 40-60% smaller.
    // method 1 / effort 25 is the speed-size sweet spot measured for HUD cards (see README).
    if (o.format === 'webp') return await encodeWebp(img.pixels, img.width, img.height, { lossless: true, method: 1, quality: 25 });
    const out = jpeg.encode({ data: img.pixels, width: img.width, height: img.height }, o.quality ?? 90);
    return new Uint8Array(out.data);
  } finally {
    img.free();
    r.free();
  }
}
