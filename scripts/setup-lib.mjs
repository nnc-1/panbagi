// Pure helpers for the installer (scripts/setup.mjs), kept apart so they can be tested.

/** Parses JSON with // and /* comments and trailing commas (wrangler.jsonc). */
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export const validName = (s) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s);
export const validDomain = (s) => /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s);
export const validAdminPath = (s) => /^[A-Za-z0-9_-]{1,64}$/.test(s) && !['admin', 'api'].includes(s.toLowerCase());

/**
 * The account's wrangler config: the template (new code's settings) with this account's values.
 * From the previous config only the "vars" the owner may have changed are kept (and only keys the template still has).
 */
export function buildConfig(template, prev, { name, accountId, bucket, dbName, dbId, domain }) {
  const c = structuredClone(template);
  c.name = name;
  c.account_id = accountId;
  c.r2_buckets = c.r2_buckets.map((b, i) => (i === 0 ? { ...b, bucket_name: bucket } : b));
  c.d1_databases = c.d1_databases.map((d, i) => (i === 0 ? { ...d, database_name: dbName, database_id: dbId } : d));
  delete c.routes;
  if (domain) {
    c.routes = [{ pattern: domain, custom_domain: true }];
    c.workers_dev = false;
  } else c.workers_dev = true;
  if (prev?.vars && c.vars) for (const k of Object.keys(c.vars)) if (typeof prev.vars[k] === 'string') c.vars[k] = prev.vars[k];
  if (c.$schema) c.$schema = 'node_modules/wrangler/config-schema.json';
  return c;
}
