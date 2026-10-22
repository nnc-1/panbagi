// Tiny helper: bundle a script that imports extensionless TS (esbuild ships with wrangler) and run it.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [entry, ...args] = process.argv.slice(2);
const out = join(mkdtempSync(join(tmpdir(), 'svg-engine-')), 'run.mjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', external: ['node:*'] });
process.exit(spawnSync(process.execPath, [out, ...args], { stdio: 'inherit' }).status ?? 1);
