// Admin API client. The token lives only in this browser (localStorage).
const KEY = 'svg-admin-token';

export const token = {
  get: () => {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (t: string) => {
    try {
      t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY);
    } catch {}
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public problems?: string[]) {
    super(message);
  }
}

const MESSAGES: Record<number, string> = {
  401: '관리 토큰이 맞지 않아요.',
  404: '찾을 수 없어요.',
  413: '파일이 너무 커요.',
  409: '같은 이름이 이미 있어요.',
  415: '지원하지 않는 파일 형식이에요.',
  429: '토큰을 너무 많이 틀렸어요. 1분 뒤에 다시 해 주세요.',
  503: '서버에 ADMIN_TOKEN이 설정되지 않았거나 16자보다 짧아요.',
};

export async function call(method: string, path: string, body?: BodyInit | object, type?: string): Promise<Response> {
  const headers: Record<string, string> = { 'x-admin-token': token.get() };
  let payload: BodyInit | undefined;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body) && typeof body !== 'string') {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  } else {
    payload = body as BodyInit | undefined;
    if (type) headers['content-type'] = type;
  }
  const r = await fetch('/api/admin' + path, { method, headers, body: payload });
  if (!r.ok) {
    let detail = '';
    let problems: string[] | undefined;
    try {
      const j = await r.json();
      detail = j.error ?? '';
      problems = j.problems;
    } catch {}
    throw new ApiError(r.status, MESSAGES[r.status] ?? `요청이 실패했어요 (${r.status}) ${detail}`, problems);
  }
  return r;
}

export const get = async <T>(path: string): Promise<T> => (await call('GET', path)).json();
export const send = async <T = unknown>(method: string, path: string, body?: BodyInit | object, type?: string): Promise<T> =>
  (await call(method, path, body, type)).json();
export const bytes = async (path: string): Promise<Uint8Array> => new Uint8Array(await (await call('GET', path)).arrayBuffer());

// ---- shapes returned by the API ----
export interface TemplateRow {
  slug: string;
  name: string;
  published_version: number | null;
  updated_at: string;
}
export interface Chat {
  slug: string;
  name: string;
  description: string;
  templates: TemplateRow[];
}
export interface Asset {
  name: string;
  kind: string;
  mime: string;
  bytes: number;
  sha256: string;
  created_at: string;
}
export interface Font {
  id: number;
  family: string;
  weight: number;
  style: string;
  bytes: number;
  license_note: string;
}
export interface TemplateDetail {
  chat: string;
  template: string;
  name: string;
  draft: any;
  published_version: number | null;
  updated_at: string;
  versions: { version: number; spec_hash: string; published_at: string }[];
}

export const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
export { ASSET_NAME, assetFile, assetFolder } from '../src/spec';

export function kb(n: number) {
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1000)) + 'KB';
}

export async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', b as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}
