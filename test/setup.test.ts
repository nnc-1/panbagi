import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS helper of the installer
import { buildConfig, parseJsonc, validAdminPath, validDomain, validName } from '../scripts/setup-lib.mjs';

const TEMPLATE = 'wrangler.jsonc';
const template = parseJsonc(readFileSync(TEMPLATE, 'utf8'));
const opts = { name: 'panbagi', accountId: 'acc1', bucket: 'panbagi-store', dbName: 'panbagi-db', dbId: 'db-uuid', domain: '' };

describe('installer', () => {
  it('template has no owner values', () => {
    const text = readFileSync(TEMPLATE, 'utf8');
    expect(template.routes).toBeUndefined();
    expect(template.account_id).toBeUndefined();
    expect(template.d1_databases[0].database_id).toBeUndefined();
  });

  it('parses comments without touching strings', () => {
    expect(parseJsonc('{ "a": "http://x//y", /* c */ "b": [1, 2,], // d\n }')).toEqual({ a: 'http://x//y', b: [1, 2] });
    expect(parseJsonc('{ "a": "q\\"//" }')).toEqual({ a: 'q"//' });
  });

  it('fills in account values, workers.dev without a domain', () => {
    const c = buildConfig(template, undefined, opts);
    expect(c.account_id).toBe('acc1');
    expect(c.d1_databases[0]).toMatchObject({ binding: 'DB', database_name: 'panbagi-db', database_id: 'db-uuid' });
    expect(c.workers_dev).toBe(true);
    expect(c.routes).toBeUndefined();
    expect(template.d1_databases[0].database_id).toBeUndefined(); // template untouched
  });

  it('uses a custom domain and keeps the owner\'s vars on update', () => {
    const prev = { vars: { RENDER_SCALE: '0.5', GONE: 'x' } };
    const c = buildConfig(template, prev, { ...opts, domain: 'svg.example.com' });
    expect(c.routes).toEqual([{ pattern: 'svg.example.com', custom_domain: true }]);
    expect(c.workers_dev).toBe(false);
    expect(c.vars.RENDER_SCALE).toBe('0.5');
    expect(c.vars.RENDER_TTL_HOURS).toBe(template.vars.RENDER_TTL_HOURS);
    expect(c.vars.GONE).toBeUndefined();
  });

  it('checks answers', () => {
    expect(validDomain('svg.example.com')).toBe(true);
    expect(validDomain('https://x')).toBe(false);
    expect(validName('svg-engine')).toBe(true);
    expect(validName('SVG')).toBe(false);
    expect(validAdminPath('my-panel_7')).toBe(true);
    expect(validAdminPath('API')).toBe(false);
  });
});
