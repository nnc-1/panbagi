// Shared UI bits: app-wide data, toasts, modal.
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import { signalish } from './signal';
import type { Asset, Chat, Font } from './api';

export interface AppData {
  chats: Chat[];
  assets: Asset[];
  fonts: Font[];
  settings: Record<string, string>;
  reload: (what?: ('chats' | 'assets' | 'fonts' | 'settings')[]) => Promise<void>;
}
export const DataCtx = createContext<AppData>(null as any);
export const useData = () => useContext(DataCtx);

// ---- toasts ----
export const toasts = signalish<{ id: number; text: string; bad?: boolean }[]>([]);
let tid = 0;
export function toast(text: string, bad = false) {
  const id = ++tid;
  toasts.set([...toasts.get(), { id, text, bad }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), bad ? 6000 : 2500);
}
export function fail(e: unknown) {
  const err = e as { message?: string; problems?: string[] };
  toast((err?.message ?? String(e)) + (err?.problems?.length ? ' — ' + err.problems.slice(0, 3).join(', ') : ''), true);
}

export function Toasts() {
  const list = toasts.use();
  return (
    <div class="toasts">
      {list.map((t) => (
        <div key={t.id} class={'toast' + (t.bad ? ' bad' : '')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Modal(p: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  return (
    <div class="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class={'modal' + (p.wide ? ' wide' : '')} role="dialog" aria-label={p.title}>
        <div class="modal-head">
          <h3>{p.title}</h3>
          <button class="ghost" onClick={p.onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {p.children}
      </div>
    </div>
  );
}

export const navigate = (hash: string) => {
  location.hash = hash;
};
