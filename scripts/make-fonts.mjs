// Makes small Korean subset fonts for the free plan (smaller R2 reads, less memory).
//   npm run font:subset                      # downloads Noto Sans KR (OFL) and writes public/_seed/fonts/*.ttf
//   npm run font:subset -- reg.ttf bold.ttf  # or subset your own files (regular, then bold)
// Characters kept: ASCII, KS X 1001 Hangul (2350 syllables), compat jamo (ㅋㅋ ㅠㅠ), common symbols,
// plus every character that appears in samples/*.json.
import subset from 'subset-font';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

const CDN = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-kr@0.4.4';
const SOURCES = [
  { weight: 400, file: 'fonts/src/NotoSansKR_400Regular.ttf', url: `${CDN}/400Regular/NotoSansKR_400Regular.ttf` },
  { weight: 700, file: 'fonts/src/NotoSansKR_700Bold.ttf', url: `${CDN}/700Bold/NotoSansKR_700Bold.ttf` },
];
const [argReg, argBold] = process.argv.slice(2);
if (argReg) SOURCES[0] = { weight: 400, file: argReg };
if (argBold) SOURCES[1] = { weight: 700, file: argBold };
else if (argReg) SOURCES.pop();

function charset() {
  let s = '';
  for (let c = 0x20; c < 0x7f; c++) s += String.fromCharCode(c);
  const d = new TextDecoder('euc-kr');
  for (let a = 0xb0; a <= 0xc8; a++)
    for (let b = 0xa1; b <= 0xfe; b++) {
      const ch = d.decode(new Uint8Array([a, b]));
      if (ch.length === 1 && ch !== '�') s += ch;
    }
  for (let c = 0x3131; c <= 0x3163; c++) s += String.fromCharCode(c); // ㄱ..ㅣ
  s += '·…※★☆♡♥♪→←↑↓○●◇◆□■△▽×÷±°′″“”‘’「」『』《》【】、。！？～';
  if (existsSync('samples'))
    for (const f of readdirSync('samples').filter((f) => f.endsWith('.json'))) s += readFileSync(`samples/${f}`, 'utf8');
  return [...new Set(s)].join('');
}

mkdirSync('fonts/src', { recursive: true });
const text = charset();
for (const src of SOURCES) {
  if (!existsSync(src.file)) {
    console.log('downloading', src.url);
    const r = await fetch(src.url);
    if (!r.ok) throw new Error(`download failed: ${r.status} ${src.url}`);
    writeFileSync(src.file, Buffer.from(await r.arrayBuffer()));
  }
  const out = `public/_seed/fonts/NotoSansKR-${src.weight}.ttf`;
  const buf = await subset(readFileSync(src.file), text, { targetFormat: 'truetype' });
  writeFileSync(out, buf);
  console.log(out, `${(readFileSync(src.file).length / 1e6).toFixed(1)}MB -> ${(buf.length / 1e6).toFixed(2)}MB`);
}
