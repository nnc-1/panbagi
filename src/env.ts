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
