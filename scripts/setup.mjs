// One-step installer and updater (run by 설치.bat, or `npm run setup`).
// Installs or updates svg-engine on the logged-in Cloudflare account:
//   login -> R2 bucket + D1 database -> wrangler.local.jsonc (git-ignored, this account's values) -> migrations
//   -> deploy -> ADMIN_TOKEN / ADMIN_PATH secrets -> Korean subset fonts + samples (first install only).
// Running it again skips what is already there, so the same command updates an existing install.
// Secrets are never written to a file: a new admin token is shown on screen once.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildConfig, parseJsonc, validDomain, validAdminPath, validName } from './setup-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'wrangler.jsonc');
const CONFIG_NAME = 'wrangler.local.jsonc';
const CONFIG = join(ROOT, CONFIG_NAME);
const WITH_CONFIG = ['-c', CONFIG_NAME];
// Before the name 판박이 it was installed as "svg-engine" with these resources.
const LEGACY = { name: 'svg-engine', bucket: 'svg-store', dbName: 'svg-meta' };
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

const say = (s = '') => console.log(s);
const step = (n, s) => say(`\n[${n}] ${s}`);
/** One readline per question, closed right after, so wrangler (login, deploy) can use the keyboard in between. */
async function question(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(q)).trim();
  } finally {
    rl.close();
  }
}
const ask = async (q, def = '') => (await question(def ? `${q} [${def}]: ` : `${q}: `)) || def;
const yes = async (q, def = false) => {
  const a = (await question(`${q} (${def ? 'Y/n' : 'y/N'}): `)).toLowerCase();
  return a ? a.startsWith('y') || a === 'ㅛ' : def;
};
function fail(msg) {
  say(`\n!! ${msg}`);
  process.exit(1);
}

/** Runs wrangler. capture: return its output instead of showing it. input: text piped to stdin. */
function wrangler(args, { capture = false, input, extraEnv } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT,
      env: { ...env, ...extraEnv },
      stdio: [input !== undefined ? 'pipe' : capture ? 'ignore' : 'inherit', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
    });
    let out = '';
    if (capture) {
      for (const s of [child.stdout, child.stderr])
        s.on('data', (d) => (out += d));
    }
    if (input !== undefined) child.stdin.end(input);
    child.on('close', (code) => resolve({ code, out }));
  });
}

function node(script, args = [], extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env: { ...env, ...extraEnv }, stdio: 'inherit' });
    child.on('close', (code) => resolve(code));
  });
}

const jsonIn = (text) => {
  const i = text.search(/[[{]/);
  return i < 0 ? undefined : JSON.parse(text.slice(i));
};

/** GET from the Cloudflare API with wrangler's login. Undefined when it fails. */
async function cfApi(path) {
  try {
    const t = jsonIn((await wrangler(['auth', 'token', '--json'], { capture: true })).out);
    const auth = t?.type === 'api_key' ? { 'X-Auth-Key': t.key, 'X-Auth-Email': t.email } : { Authorization: `Bearer ${t?.token}` };
    const j = await (await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: auth })).json();
    return j?.success ? j.result : undefined;
  } catch {
    return undefined;
  }
}

/** https://<name>.<account subdomain>.workers.dev */
async function workersDevBase(name, accountId) {
  const sub = (await cfApi(`/accounts/${accountId}/workers/subdomain`))?.subdomain;
  return sub ? `https://${name}.${sub}.workers.dev` : '';
}

/** Asks which address to use: a name under one of the account's domains (the usual case), else workers.dev. */
async function askDomain(name, accountId) {
  const zones = ((await cfApi(`/zones?account.id=${accountId}&per_page=50`)) ?? []).filter((z) => z.status === 'active').map((z) => z.name);
  say('');
  say('  이미지와 관리 화면을 내 도메인 아래 주소(예: svg.내도메인.com)로 써요. DNS와 인증서는 자동으로 만들어져요.');
  if (zones.length) {
    say('  이 계정에 있는 도메인:');
    zones.forEach((z, i) => say(`    ${i + 1}. ${z}`));
    say(`    0. 도메인 없이 임시 주소(https://${name}.<계정이름>.workers.dev) 쓰기`);
    const n = Number(await ask('  쓸 도메인 번호', '1'));
    if (!(n >= 1 && n <= zones.length)) return '';
    const zone = zones[n - 1];
    for (;;) {
      const sub = (await ask(`  ${zone} 앞에 붙일 이름(영문 소문자, 숫자, -)`, 'svg')).toLowerCase();
      if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) return `${sub}.${zone}`;
      say('  영문 소문자, 숫자, -만 쓸 수 있어요.');
    }
  }
  say('  이 계정에서 도메인을 찾지 못했어요. 도메인이 있으면 전체 주소(예: svg.example.com)를 넣고,');
  say(`  없으면 Enter를 누르세요. 임시 주소(https://${name}.<계정이름>.workers.dev)로 설치하고, 나중에 도메인을 붙일 수 있어요.`);
  for (;;) {
    const d = (await ask('  쓸 주소', '')).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!d || validDomain(d)) return d;
    say(`  "${d}"은 주소 형식이 아니에요. 예: svg.example.com`);
  }
}

async function waitHealthy(base) {
  say(`  ${base}/healthz 가 열릴 때까지 기다려요(내 도메인은 인증서 때문에 몇 분, 길면 20분 걸려요).`);
  const until = Date.now() + 20 * 60_000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok && (await r.text()).trim() === 'ok') return true;
    } catch {}
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 15_000));
  }
  return false;
}

async function main() {
  say('================================================');
  say('  판박이 설치/업데이트');
  say('  이미 끝난 단계는 건너뛰니 몇 번이든 다시 실행해도 돼요.');
  say('================================================');
  if (Number(process.versions.node.split('.')[0]) < 20) fail(`Node.js ${process.versions.node}는 너무 오래됐어요. https://nodejs.org 에서 LTS 버전을 설치하세요.`);
  if (!existsSync(WRANGLER)) fail('wrangler가 없어요. 이 폴더에서 `npm install`을 먼저 실행하세요.');

  const prev = existsSync(CONFIG) ? parseJsonc(readFileSync(CONFIG, 'utf8')) : undefined;
  const template = parseJsonc(readFileSync(TEMPLATE, 'utf8'));
  const update = !!prev?.d1_databases?.[0]?.database_id;
  say(update ? '\n지금 설치를 최신 코드로 업데이트해요.' : '\n처음 설치해요.');

  // 1. Login and account
  step(1, 'Cloudflare 로그인 확인');
  let who = await wrangler(['whoami', '--json'], { capture: true });
  if (who.code !== 0) {
    say('  로그인이 필요해요. 브라우저가 열리면 Cloudflare에 로그인하고 "Allow(허용)"를 누르세요.');
    if ((await wrangler(['login'])).code !== 0) fail('로그인하지 못했어요. 다시 실행해 주세요.');
    who = await wrangler(['whoami', '--json'], { capture: true });
    if (who.code !== 0) fail('로그인 정보를 읽지 못했어요. 다시 실행해 주세요.');
  }
  const me = jsonIn(who.out);
  const accounts = me?.accounts ?? [];
  let accountId = prev?.account_id;
  if (!accountId || !accounts.some((a) => a.id === accountId)) {
    if (accounts.length === 1) accountId = accounts[0].id;
    else if (accounts.length > 1) {
      accounts.forEach((a, i) => say(`  ${i + 1}. ${a.name}`));
      const n = Number(await ask('  설치할 계정 번호', '1'));
      accountId = accounts[Math.min(Math.max(n, 1), accounts.length) - 1].id;
    } else fail('이 로그인에 Cloudflare 계정이 없어요.');
  }
  env.CLOUDFLARE_ACCOUNT_ID = accountId;
  say(`  ${me?.email ?? ''} 로 로그인돼 있어요.`);

  // 2. Questions (first install only; on update the previous answers in wrangler.local.jsonc are kept)
  let name = prev?.name ?? template.name;
  let bucket = prev?.r2_buckets?.[0]?.bucket_name ?? template.r2_buckets[0].bucket_name;
  let dbName = prev?.d1_databases?.[0]?.database_name ?? template.d1_databases[0].database_name;
  let domain = prev?.routes?.[0]?.pattern ?? '';
  let adminPath = '';
  const listDbs = async () => {
    const r = await wrangler(['d1', 'list', '--json'], { capture: true });
    if (r.code !== 0) {
      process.stdout.write(r.out);
      fail('데이터베이스 목록을 읽지 못했어요.');
    }
    return jsonIn(r.out) ?? [];
  };
  if (!prev) {
    const dbs = await listDbs();
    if (dbs.some((d) => d.name === LEGACY.dbName) && !dbs.some((d) => d.name === dbName)) {
      say(`\n  이 계정에 예전 이름(${LEGACY.name})으로 설치한 것이 있어요.`);
      if (await yes('  그 설치를 그대로 업데이트할까요? (템플릿과 그림이 그대로 남아요)', true)) ({ name, bucket, dbName } = LEGACY);
    }
  }
  if (!prev) {
    step(2, '설정 (모르면 Enter만 누르세요)');
    name = await ask('  Worker 이름(영문 소문자, 숫자, -)', name);
    if (!validName(name)) fail('Worker 이름은 영문 소문자, 숫자, -만 쓸 수 있어요.');
    domain = await askDomain(name, accountId);
    say('  관리 화면 주소는 기본으로 /admin 이에요. 남이 짐작하기 어렵게 바꾸려면 이름을 넣으세요(예: my-panel_7).');
    adminPath = await ask('  관리 화면 주소(비우면 /admin)', '');
    if (adminPath && !validAdminPath(adminPath)) fail('관리 화면 주소는 영문, 숫자, -, _만 쓸 수 있고 admin, api는 안 돼요.');
  } else step(2, `설정은 지난번 그대로 써요 (${domain || 'workers.dev 주소'}). 바꾸려면 ${CONFIG_NAME}를 지우고 다시 실행하세요.`);

  // 3. R2 bucket
  step(3, `이미지 저장소(R2) "${bucket}" 준비`);
  for (;;) {
    const r = await wrangler(['r2', 'bucket', 'create', bucket], { capture: true });
    if (r.code === 0 || /already exists/i.test(r.out)) {
      say('  준비됐어요.');
      break;
    }
    if (/enable R2|10042/i.test(r.out)) {
      say('  이 계정에서 R2를 아직 켜지 않았어요. 아래 주소에서 R2를 켜 주세요(무료 사용량 안에서는 요금이 없어요).');
      say(`  https://dash.cloudflare.com/${accountId}/r2/overview`);
      await ask('  켰으면 Enter');
      continue;
    }
    process.stdout.write(r.out);
    fail('R2 저장소를 만들지 못했어요. 위 메시지를 캡처해서 알려 주세요.');
  }
  // Safety net for stored renders if the hourly cleanup did not run (R2 rules count in whole days).
  if (!(await wrangler(['r2', 'bucket', 'lifecycle', 'list', bucket], { capture: true })).out.includes('expire-renders')) {
    const r = await wrangler(['r2', 'bucket', 'lifecycle', 'add', bucket, 'expire-renders', 'renders/', '--expire-days', '1', '--force'], { capture: true });
    say(r.code === 0 ? '  하루 지난 그림을 지우는 규칙도 걸었어요.' : '  (자동 삭제 규칙은 건너뛰었어요. 매시 정리가 따로 돌아서 괜찮아요.)');
  }

  // 4. D1 database
  step(4, `데이터베이스(D1) "${dbName}" 준비`);
  const findDb = async () => (await listDbs()).find((d) => d.name === dbName);
  let db = await findDb();
  if (!db) {
    const r = await wrangler(['d1', 'create', dbName], { capture: true });
    if (r.code !== 0) {
      process.stdout.write(r.out);
      fail('데이터베이스를 만들지 못했어요.');
    }
    db = await findDb();
    if (!db) fail('데이터베이스를 만들었는데 찾지 못했어요. 다시 실행해 주세요.');
    say('  새로 만들었어요.');
  } else say('  이미 있어요.');

  // 5. wrangler.local.jsonc for this account
  step(5, `이 계정용 설정 파일(${CONFIG_NAME}) 쓰기`);
  const config = buildConfig(template, prev, { name, accountId, bucket, dbName, dbId: db.uuid, domain });
  writeFileSync(
    CONFIG,
    '// Made by the installer (scripts/setup.mjs) from wrangler.jsonc for this account. Not in git.\n' +
      '// You may change "vars" here; they are kept on update. Deploy with the installer (or `wrangler deploy -c wrangler.local.jsonc`).\n' +
      JSON.stringify(config, null, 2) +
      '\n',
  );
  say('  썼어요.');

  // 6. Migrations
  step(6, '데이터베이스 표 만들기/업데이트');
  if ((await wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', ...WITH_CONFIG], { extraEnv: { CI: 'true' } })).code !== 0)
    fail('데이터베이스 업데이트에 실패했어요. 위 메시지를 캡처해서 알려 주세요.');

  // 7. Deploy
  step(7, 'Cloudflare에 올리기 (1~2분)');
  if ((await wrangler(['deploy', ...WITH_CONFIG])).code !== 0) {
    if (domain) say(`\n  주소 "${domain}" 때문이라면: 그 도메인이 이 Cloudflare 계정에 있는지 확인하세요.\n  도메인 없이 쓰려면 ${CONFIG_NAME}를 지우고 다시 실행해서 주소를 비워 두세요.`);
    fail('올리기에 실패했어요. 위 메시지를 캡처해서 알려 주세요.');
  }
  const base = domain ? `https://${domain}` : await workersDevBase(name, accountId);

  // 8. Secrets
  step(8, '관리 토큰(비밀번호) 확인');
  const sl = await wrangler(['secret', 'list', '--format', 'json', ...WITH_CONFIG], { capture: true });
  const secrets = new Set((jsonIn(sl.out) ?? []).map((s) => s.name));
  let token = '';
  if (!secrets.has('ADMIN_TOKEN') || (await yes('  관리 토큰이 이미 있어요. 새로 만들까요? (잊어버렸을 때만)', false))) {
    token = randomBytes(24).toString('hex');
    if ((await wrangler(['secret', 'put', 'ADMIN_TOKEN', ...WITH_CONFIG], { capture: true, input: token + '\n' })).code !== 0) fail('관리 토큰을 넣지 못했어요.');
    say('  관리 토큰을 만들었어요.');
  } else say('  있던 토큰을 그대로 써요.');
  if (adminPath) {
    if ((await wrangler(['secret', 'put', 'ADMIN_PATH', ...WITH_CONFIG], { capture: true, input: adminPath + '\n' })).code !== 0) fail('관리 화면 주소를 넣지 못했어요.');
    say(`  관리 화면 주소를 /${adminPath} 로 정했어요.`);
  }

  // 9. Wait until it answers, then fonts and samples on a fresh install
  step(9, '접속 확인');
  const up = base ? await waitHealthy(base) : false;
  say(up ? '\n  열렸어요.' : '\n  아직 안 열려요. 조금 뒤 브라우저로 확인해 주세요.');

  let seeded = false;
  if (up && token) {
    const r = await fetch(`${base}/api/admin/chats`, { headers: { 'x-admin-token': token } }).catch(() => undefined);
    const chats = r?.ok ? await r.json() : undefined;
    if (Array.isArray(chats) && chats.length === 0) {
      step(10, '한글 폰트와 샘플 넣기');
      seeded = (await node('scripts/seed.mjs', [], { BASE_URL: base, ADMIN_TOKEN: token })) === 0;
    }
  }

  const ap = adminPath || (secrets.has('ADMIN_PATH') ? '(정해 둔 주소)' : 'admin');
  say('\n================================================');
  say('  끝났어요!');
  if (base) say(`  관리 화면: ${base}/${ap}`);
  if (token) {
    say('');
    say('  관리 토큰 (지금 한 번만 보여 줘요. 복사해서 안전한 곳에 적어 두세요):');
    say(`  ${token}`);
  }
  if (seeded) say(`\n  샘플 그림: ${base}/demo/lite.webp?name=도키&hp=72`);
  say('\n  업데이트할 때도 이 설치기를 다시 실행하면 돼요.');
  say('================================================');
}

main().catch((e) => fail(e?.stack ?? String(e)));
