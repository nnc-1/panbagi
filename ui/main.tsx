import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { UI_VERSION } from './version';
import { get, token, type Asset, type Chat, type Font } from './api';
import { DataCtx, Toasts, fail, type AppData } from './ui';
import { ChatList, ChatPage } from './pages/chats';
import { AssetsPage } from './pages/assets';
import { FontsPage } from './pages/fonts';
import { Editor } from './editor/editor';

function useHash() {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const f = () => setH(location.hash.slice(1) || '/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

function Login(p: { onOk: () => void; error?: string; notice?: string }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState(p.error ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    token.set(v.trim());
    setBusy(true);
    try {
      await get('/settings');
      p.onOk();
    } catch (x: any) {
      token.set('');
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="login" onSubmit={submit}>
      <h1>판박이</h1>
      <p>설치할 때 정한 관리 토큰(<code>ADMIN_TOKEN</code>)을 넣어 주세요. 이 브라우저에만 기억돼요.</p>
      <input type="password" autoFocus value={v} onInput={(e) => setV(e.currentTarget.value)} placeholder="관리 토큰" autoComplete="current-password" />
      {p.notice && !err && <p class="notice">{p.notice}</p>}
      {err && <p class="err">{err}</p>}
      <button class="primary" disabled={busy || !v.trim()}>
        들어가기
      </button>
      <small class="ver">관리 화면 버전 {UI_VERSION}</small>
    </form>
  );
}

function App() {
  const route = useHash();
  const [authed, setAuthed] = useState<boolean | null>(token.get() ? null : false);
  const [loginErr, setLoginErr] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  const [data, setData] = useState<Omit<AppData, 'reload'>>({ chats: [], assets: [], fonts: [], settings: {} });

  const reload = useCallback(async (what: ('chats' | 'assets' | 'fonts' | 'settings')[] = ['chats', 'assets', 'fonts', 'settings']) => {
    try {
      const got = await Promise.all(what.map((w) => get<any>('/' + w)));
      setData((d) => ({ ...d, ...Object.fromEntries(what.map((w, i) => [w, got[i]])) }));
      setAuthed(true);
    } catch (e: any) {
      if (e.status === 401 || e.status === 503) {
        token.set('');
        setLoginErr(e.message);
        setAuthed(false);
      } else fail(e);
    }
  }, []);

  useEffect(() => {
    if (authed !== false) reload();
  }, [authed === false]);

  if (authed === false) return <Login error={loginErr} notice={loginNotice} onOk={() => (setLoginErr(''), setLoginNotice(''), setAuthed(null))} />;
  if (authed === null) return <div class="loading">불러오는 중…</div>;

  const parts = route.split('/').filter(Boolean);
  let page;
  if (parts[0] === 'assets') page = <AssetsPage />;
  else if (parts[0] === 'fonts') page = <FontsPage />;
  else if (parts[0] === 'chat' && parts[1]) page = <ChatPage slug={parts[1]} />;
  else if (parts[0] === 'edit' && parts[1] && parts[2]) page = <Editor key={parts[1] + '/' + parts[2]} chat={parts[1]} slug={parts[2]} />;
  else page = <ChatList />;

  const tab = parts[0] === 'assets' ? 'assets' : parts[0] === 'fonts' ? 'fonts' : 'chats';
  return (
    <DataCtx.Provider value={{ ...data, reload }}>
      <header class="top">
        <b>판박이</b>
        <nav>
          <a href="#/" class={tab === 'chats' ? 'on' : ''}>
            채팅·템플릿
          </a>
          <a href="#/assets" class={tab === 'assets' ? 'on' : ''}>
            에셋
          </a>
          <a href="#/fonts" class={tab === 'fonts' ? 'on' : ''}>
            폰트
          </a>
        </nav>
        <small class="ver" title="관리 화면 버전">{UI_VERSION}</small>
        <button
          class="ghost small"
          title="이 브라우저에 기억한 관리 토큰을 지워요"
          onClick={() => {
            if (!confirm('로그아웃할까요?\n\n로그아웃하면 이 브라우저에 기억한 관리 토큰이 지워져서, 다시 들어올 때 관리 토큰을 또 입력해야 해요. 저장하지 않은 편집 내용도 사라져요.')) return;
            token.set('');
            setLoginErr('');
            setLoginNotice('로그아웃했어요. 다시 쓰려면 관리 토큰을 넣어 주세요.');
            setAuthed(false);
          }}
        >
          로그아웃
        </button>
      </header>
      <main class={parts[0] === 'edit' ? 'full' : ''}>{page}</main>
      <Toasts />
    </DataCtx.Provider>
  );
}

const root = document.getElementById('app')!;
root.textContent = ''; // drop the static "loading" text
render(<App />, root);
