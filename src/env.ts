export interface Env {
  DB: D1Database;
  STORE: R2Bucket;
  ADMIN_TOKEN?: string;
  /** where the admin UI lives (one path segment, default "admin"); set it as a secret to keep it out of the repo */
  ADMIN_PATH?: string;
  ASSETS?: Fetcher;
  RENDER_TTL_HOURS?: string;
  MAX_PIXELS?: string;
  RENDER_SCALE?: string;
  ENABLE_JPG?: string;
  RATE_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  AUTH_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

export interface Config {
  ttlSeconds: number;
  maxPixels: number;
  renderScale: number; // multiplies every template's canvas.scale; lower = cheaper renders
  enableJpg: boolean;
}

export function readConfig(env: Env): Config {
  const h = Number(env.RENDER_TTL_HOURS);
  const hours = Number.isFinite(h) && h > 0 ? Math.min(24, Math.max(1, h)) : 6;
  const mp = Number(env.MAX_PIXELS);
  const rs = Number(env.RENDER_SCALE);
  return {
    ttlSeconds: Math.round(hours * 3600),
    maxPixels: Number.isFinite(mp) && mp >= 64 ? Math.min(4096, mp) : 2048,
    renderScale: Number.isFinite(rs) && rs > 0 ? Math.min(2, Math.max(0.25, rs)) : 1,
    enableJpg: env.ENABLE_JPG === 'true',
  };
}

/**
 * Who a rate limit counts: the IPv4 address, or the /64 network of an IPv6 address
 * (one home or phone line gets a whole /64, so counting single IPv6 addresses is easy to dodge).
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'anon';
  if (!ip.includes(':') || ip.includes('.')) return ip; // IPv4, or IPv4 written as IPv6 (::ffff:1.2.3.4)
  const [head, tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}
