import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The Worker imports resvg's .wasm as a module; in Node tests it is replaced by a stub.
  resolve: { alias: [{ find: /^(@resvg\/resvg-wasm\/index_bg|@jsquash\/webp\/codec\/enc\/webp_enc_simd)\.wasm$/, replacement: new URL('./test/wasm-stub.ts', import.meta.url).pathname }] },
  test: { include: ['test/**/*.test.ts'] },
});
