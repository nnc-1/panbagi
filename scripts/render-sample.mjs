// Renders samples/<TEMPLATE>.json (default hud; try TEMPLATE=lite) to a PNG without Cloudflare. Run from the project root:
// npm run render:sample -- out.png "hp=72&name=도키" public/_seed/fonts/NotoSansKR-400.ttf
import { readFileSync, writeFileSync } from 'node:fs';
import { composeSvg } from '../src/compose';
import { normalizeParams } from '../src/params';
import { initRaster, rasterize } from '../src/raster';

const [out = 'hud.png', query = '', ...fontPaths] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(`samples/${process.env.TEMPLATE ?? 'hud'}.json`));
const assets = new Map();
for (const [alias, name] of Object.entries(spec.assets ?? {}))
  assets.set(alias, { mime: 'image/svg+xml', bytes: readFileSync(`public/_seed/assets/${name}`) });
await initRaster(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const { values } = normalizeParams(spec, new URLSearchParams(query));
const c = composeSvg(spec, values, assets);
const png = await rasterize(c.svg, { width: spec.canvas.w, format: out.endsWith('.jpg') ? 'jpg' : 'png', fonts: fontPaths.map((p) => readFileSync(p)), background: spec.canvas.background });
writeFileSync(out, png);
console.log(out, png.length, 'bytes');
