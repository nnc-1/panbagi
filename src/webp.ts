// WebP encoding with libwebp compiled to wasm (@jsquash/webp, SIMD build). Instantiated from a module we pass in,
// so the Worker bundles the .wasm statically and nothing is fetched at run time.
// @ts-ignore no types for the emscripten glue
import factory from '@jsquash/webp/codec/enc/webp_enc_simd.js';
// @ts-ignore
import { defaultOptions } from '@jsquash/webp/meta.js';
// @ts-ignore
import { initEmscriptenModule } from '@jsquash/webp/utils.js';

let mod: Promise<any> | undefined;

export function initWebp(wasm: WebAssembly.Module | BufferSource): Promise<any> {
  return (mod ??= initEmscriptenModule(factory, wasm instanceof WebAssembly.Module ? wasm : new (WebAssembly.Module as any)(wasm)));
}

export interface WebpOptions {
  /** true: exact pixels (crisp text, bigger). false: lossy at `quality`. */
  lossless?: boolean;
  /** lossy: 0..100 picture quality. lossless: 0..100 effort. */
  quality?: number;
  /** 0 (fast) .. 6 (small) */
  method?: number;
}

export async function encodeWebp(rgba: Uint8Array, width: number, height: number, o: WebpOptions = {}): Promise<Uint8Array> {
  if (!mod) throw new Error('webp encoder not initialised');
  const m = await mod;
  const opts = {
    ...defaultOptions,
    lossless: o.lossless ? 1 : 0,
    quality: o.quality ?? (o.lossless ? 25 : 90),
    method: o.method ?? (o.lossless ? 1 : 4),
    use_sharp_yuv: o.lossless ? 0 : 1, // keeps thin colored text edges clean in lossy mode
    exact: 0,
  };
  const out = m.encode(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, opts);
  if (!out) throw new Error('webp encoding failed');
  return new Uint8Array(out.buffer ?? out);
}
