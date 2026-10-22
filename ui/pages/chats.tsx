import { useEffect, useState } from 'preact/hooks';
import { SLUG, copy, get, send, type Chat, type TemplateDetail } from '../api';
import { download, exportBundle, importBundle, openBundle, type BundleJson } from '../bundle';
import { BLANK_SPEC } from '../model';
import { Modal, fail, navigate, toast, useData } from '../ui';
import lite from '../../samples/lite.json';
import hud from '../../samples/hud.json';

const SEED_ASSETS = ['icon-coin.svg', 'icon-pin.svg', 'icon-shield.svg'];
const SEED_FONTS = [
  { file: 'NotoSansKR-400.ttf', weight: 400 },
  { file: 'NotoSansKR-700.ttf', weight: 700 },
];
const SEED_FAMILY = 'Noto Sans KR';

/** First run: the bundled Korean subset fonts (OFL), sample icons and the "demo" chat with lite and hud. */
function SeedButton(p: { onDone: () => void }) {
  const [busy, setBusy] = useState('');
  const run = async () => {
    try {
      const file = async (path: string) => {
        const r = await fetch(`/_seed/${path}`);
        if (!r.ok) throw new Error(`${path}을 찾지 못했어요 (${r.status})`);
        return r.arrayBuffer();
      };
      setBusy('폰트');
      for (const f of SEED_FONTS)
        await send('PUT', `/fonts/${encodeURIComponent(SEED_FAMILY)}?weight=${f.weight}&license=${encodeURIComponent('SIL OFL 1.1')}`, await file(`fonts/${f.file}`), 'application/octet-stream');
      await send('PUT', '/settings/default_font', SEED_FAMILY, 'text/plain');
      setBusy('아이콘');
      for (const a of SEED_ASSETS) await send('PUT', `/assets/${a}`, await file(`assets/${a}`), 'image/svg+xml');
      setBusy('템플릿');
      await send('PUT', '/chats/demo', { name: '샘플' });
      for (const [slug, spec] of [['lite', lite], ['hud', hud]] as const) {
        await send('PUT', `/chats/demo/templates/${slug}`, spec);
        await send('POST', `/chats/demo/templates/${slug}/publish`);
      }
      toast('샘플을 넣었어요.');
      p.onDone();
    } catch (x) {
      fail(x);
    } finally {
      setBusy('');
    }
  };
  return (
    <button class="primary" disabled={!!busy} onClick={run}>
      {busy ? `${busy} 넣는 중…` : '한글 폰트와 샘플 넣기'}
    </button>
  );
}

export function ChatList() {
  const { chats, reload } = useData();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  return (
    <section class="page">
      <div class="page-head">
        <h2>채팅</h2>
        <div class="row">
          <button onClick={() => setImporting(true)}>zip 가져오기</button>
          <button class="primary" onClick={() => setAdding(true)}>
            + 채팅 추가
          </button>
        </div>
      </div>
      <p class="hint">채팅(캐릭터나 작품) 하나에 템플릿을 여러 개 둘 수 있어요. 이미지 주소는 <code>/채팅/템플릿.webp?값들</code> 모양이에요(.png로 써도 돼요).</p>
      {!chats.length && (
        <div class="empty">
          <p>아직 채팅이 없어요. "채팅 추가"로 시작하거나, 한글 폰트와 샘플 템플릿을 한 번에 넣어 보세요.</p>
          <SeedButton onDone={() => reload()} />
        </div>
      )}
      <div class="cards">
        {chats.map((c) => (
          <a class="card" href={`#/chat/${c.slug}`} key={c.slug}>
            <b>{c.name}</b>
            <code>{c.slug}</code>
            {c.description && <p>{c.description}</p>}
            <small>템플릿 {c.templates.length}개</small>
          </a>
        ))}
      </div>
      {adding && <ChatForm onClose={() => setAdding(false)} onSaved={(s) => (reload(['chats']), navigate(`/chat/${s}`))} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </section>
  );
}

function ChatForm(p: { chat?: Chat; onClose: () => void; onSaved: (slug: string) => void }) {
  const [slug, setSlug] = useState(p.chat?.slug ?? '');
  const [name, setName] = useState(p.chat?.name ?? '');
  const [desc, setDesc] = useState(p.chat?.description ?? '');
  const ok = SLUG.test(slug);
  const save = async (e: Event) => {
    e.preventDefault();
    try {
      await send('PUT', `/chats/${slug}`, { name: name || slug, description: desc });
      toast('저장했어요');
      p.onSaved(slug);
      p.onClose();
    } catch (x) {
      fail(x);
    }
  };
  return (
    <Modal title={p.chat ? '채팅 설정' : '채팅 추가'} onClose={p.onClose}>
      <form class="form" onSubmit={save}>
        <label>
          주소 이름 (영문 소문자·숫자·-)
          <input value={slug} disabled={!!p.chat} onInput={(e) => setSlug(e.currentTarget.value.toLowerCase())} placeholder="dokki-rpg" />
          {!p.chat && slug && !ok && <small class="err">영문 소문자, 숫자, -만 쓸 수 있고 48자 이하예요.</small>}
        </label>
        <label>
          표시 이름
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="던전 마스터 도키" />
        </label>
        <label>
          설명 (나만 보는 메모)
          <textarea rows={3} value={desc} onInput={(e) => setDesc(e.currentTarget.value)} />
        </label>
        <div class="row end">
          <button type="button" onClick={p.onClose}>
            취소
          </button>
          <button class="primary" disabled={!ok}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ChatPage(p: { slug: string }) {
  const { chats, reload } = useData();
  const chat = chats.find((c) => c.slug === p.slug);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState<string[] | null>(null);
  if (!chat)
    return (
      <section class="page">
        <p class="empty">
          채팅 <code>{p.slug}</code>을 찾을 수 없어요. <a href="#/">목록으로</a>
        </p>
      </section>
    );
  const base = `${location.origin}/${chat.slug}/`;
  const remove = async () => {
    if (!confirm(`채팅 "${chat.name}"과 템플릿 ${chat.templates.length}개를 모두 지울까요? 되돌릴 수 없어요.`)) return;
    try {
      await send('DELETE', `/chats/${chat.slug}`);
      await reload(['chats']);
      navigate('/');
    } catch (e) {
      fail(e);
    }
  };
  const removeTpl = async (t: string) => {
    if (!confirm(`템플릿 "${t}"을 지울까요? 게시한 버전도 모두 사라지고 이 주소의 이미지가 더는 나오지 않아요.`)) return;
    try {
      await send('DELETE', `/chats/${chat.slug}/templates/${t}`);
      reload(['chats']);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <section class="page">
      <div class="crumbs">
        <a href="#/">채팅</a> / {chat.name}
      </div>
      <div class="page-head">
        <div>
          <h2>{chat.name}</h2>
          <code>{chat.slug}</code>
          {chat.description && <p class="hint">{chat.description}</p>}
        </div>
        <div class="row">
          <button onClick={() => setEditing(true)}>채팅 설정</button>
          <button onClick={() => setExporting(chat.templates.map((t) => t.slug))} disabled={!chat.templates.length}>
            전체 zip 내보내기
          </button>
          <button class="danger" onClick={remove}>
            채팅 삭제
          </button>
        </div>
      </div>
      <div class="page-head">
        <h3>템플릿</h3>
        <button class="primary" onClick={() => setAdding(true)}>
          + 템플릿 추가
        </button>
      </div>
      {!chat.templates.length && <p class="empty">템플릿이 없어요. "템플릿 추가"를 누르세요.</p>}
      <table class="list">
        <tbody>
          {chat.templates.map((t) => (
            <tr key={t.slug}>
              <td>
                <a href={`#/edit/${chat.slug}/${t.slug}`}>
                  <b>{t.name}</b>
                </a>
                <br />
                <code>
                  /{chat.slug}/{t.slug}.webp
                </code>
              </td>
              <td>{t.published_version ? <span class="badge ok">게시 v{t.published_version}</span> : <span class="badge">게시 안 됨</span>}</td>
              <td class="row end">
                <a class="btn" href={`#/edit/${chat.slug}/${t.slug}`}>
                  편집
                </a>
                <button onClick={() => (copy(`${base}${t.slug}.webp`), toast('주소를 복사했어요'))}>주소 복사</button>
                <button onClick={() => setExporting([t.slug])}>zip</button>
                <button class="danger" onClick={() => removeTpl(t.slug)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <ChatForm chat={chat} onClose={() => setEditing(false)} onSaved={() => reload(['chats'])} />}
      {adding && <NewTemplate chat={chat} onClose={() => setAdding(false)} />}
      {exporting && <ExportDialog chat={chat} slugs={exporting} onClose={() => setExporting(null)} />}
    </section>
  );
}

function NewTemplate(p: { chat: Chat; onClose: () => void }) {
  const { chats, reload } = useData();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [from, setFrom] = useState('blank');
  const [importing, setImporting] = useState(false);
  const taken = p.chat.templates.some((t) => t.slug === slug);
  const ok = SLUG.test(slug) && !taken;
  const create = async (e: Event) => {
    e.preventDefault();
    try {
      let spec: any = BLANK_SPEC;
      if (from === 'lite') spec = lite;
      else if (from === 'hud') spec = hud;
      else if (from.includes('/')) spec = (await get<TemplateDetail>(`/chats/${from.replace('/', '/templates/')}`)).draft;
      await send('PUT', `/chats/${p.chat.slug}/templates/${slug}?name=${encodeURIComponent(name || slug)}`, spec);
      await reload(['chats']);
      navigate(`/edit/${p.chat.slug}/${slug}`);
    } catch (x) {
      fail(x);
    }
  };
  if (importing) return <ImportDialog onClose={p.onClose} chat={p.chat.slug} />;
  return (
    <Modal title="템플릿 추가" onClose={p.onClose}>
      <form class="form" onSubmit={create}>
        <label>
          주소 이름 (영문 소문자·숫자·-)
          <input value={slug} autoFocus onInput={(e) => setSlug(e.currentTarget.value.toLowerCase())} placeholder="status" />
          {slug && !SLUG.test(slug) && <small class="err">영문 소문자, 숫자, -만 쓸 수 있어요.</small>}
          {taken && <small class="err">이미 있는 이름이에요.</small>}
        </label>
        <label>
          표시 이름
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="상태창" />
        </label>
        <label>
          시작할 모양
          <select value={from} onChange={(e) => setFrom(e.currentTarget.value)}>
            <option value="blank">빈 카드</option>
            <option value="lite">샘플: 가벼운 상태창 (lite)</option>
            <option value="hud">샘플: 모험가 상태 카드 (hud, 샘플 아이콘이 올라가 있어야 해요)</option>
            {chats.flatMap((c) =>
              c.templates.map((t) => (
                <option key={c.slug + t.slug} value={`${c.slug}/${t.slug}`}>
                  복사: {c.name} / {t.name}
                </option>
              )),
            )}
          </select>
        </label>
        <div class="row end">
          <button type="button" onClick={() => setImporting(true)}>
            zip에서 가져오기
          </button>
          <button class="primary" disabled={!ok}>
            만들기
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ExportDialog(p: { chat: Chat; slugs: string[]; onClose: () => void }) {
  const [fonts, setFonts] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const blob = await exportBundle(p.chat, p.slugs, fonts);
      download(blob, `${p.chat.slug}${p.slugs.length === 1 ? '-' + p.slugs[0] : ''}.zip`);
      p.onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="zip으로 내보내기" onClose={p.onClose}>
      <div class="form">
        <p>
          템플릿 {p.slugs.length}개({p.slugs.join(', ')})와 쓰는 에셋을 zip 하나로 묶어요. 다른 설치의 관리 화면에서 "zip 가져오기"로 넣을 수 있어요. 내보내는 것은 지금
          초안이에요.
        </p>
        <label class="check">
          <input type="checkbox" checked={fonts} onChange={(e) => setFonts(e.currentTarget.checked)} />
          폰트 파일도 넣기
        </label>
        <small class="hint">폰트는 라이선스가 재배포를 허락할 때만 넣으세요. 넣지 않으면 받는 사람에게 어떤 폰트가 필요한지만 알려 줘요.</small>
        <div class="row end">
          <button onClick={p.onClose}>취소</button>
          <button class="primary" onClick={go} disabled={busy}>
            {busy ? '묶는 중…' : '내려받기'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ImportDialog(p: { onClose: () => void; chat?: string }) {
  const { chats, reload } = useData();
  const [b, setB] = useState<{ json: BundleJson; files: Map<string, Uint8Array> } | null>(null);
  const [chat, setChat] = useState(p.chat ?? '');
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [publish, setPublish] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const pick = async (f?: File) => {
    if (!f) return;
    try {
      const got = await openBundle(f);
      setB(got);
      if (!p.chat) setChat(got.json.chat?.slug ?? '');
      setSlugs(Object.fromEntries(got.json.templates.map((t) => [t.slug, t.slug])));
    } catch (e) {
      fail(e);
    }
  };
  const target = chats.find((c) => c.slug === chat);
  useEffect(() => {
    // pick a free slug when the template already exists in the target chat
    if (!b) return;
    setSlugs((s) => {
      const o = { ...s };
      for (const t of b.json.templates) {
        let v = t.slug;
        for (let k = 2; target?.templates.some((x) => x.slug === v); k++) v = `${t.slug}-${k}`;
        o[t.slug] = v;
      }
      return o;
    });
  }, [b, chat]);

  const bad = !SLUG.test(chat) || Object.values(slugs).some((s) => s && !SLUG.test(s)) || Object.values(slugs).some((s) => target?.templates.some((t) => t.slug === s));
  const go = async () => {
    setBusy(true);
    const lines: string[] = [];
    try {
      await importBundle(b!, { chat, slugs, publish }, (s) => {
        lines.push(s);
        setLog([...lines]);
      });
      setDone(true);
      toast('가져왔어요');
      reload(['chats', 'assets', 'fonts']);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="zip 가져오기" onClose={p.onClose} wide>
      <div class="form">
        {!b && (
          <label class="drop">
            이 관리 화면에서 내보낸 zip 파일을 고르세요.
            <input type="file" accept=".zip,application/zip" onChange={(e) => pick(e.currentTarget.files?.[0])} />
          </label>
        )}
        {b && (
          <>
            <p>
              템플릿 {b.json.templates.length}개, 에셋 {b.json.assets.length}개, 폰트 {b.json.fonts.length}개가 들어 있어요.
              {!!b.json.fonts_needed?.length && ` 따로 올려야 하는 폰트: ${b.json.fonts_needed.map((f) => `${f.family} ${f.weight}`).join(', ')}`}
            </p>
            <label>
              넣을 채팅 (없으면 새로 만들어요)
              <input list="chat-slugs" value={chat} disabled={done} onInput={(e) => setChat(e.currentTarget.value.toLowerCase())} />
              <datalist id="chat-slugs">
                {chats.map((c) => (
                  <option key={c.slug} value={c.slug} />
                ))}
              </datalist>
            </label>
            {b.json.templates.map((t) => (
              <label key={t.slug} class="inline">
                <span>
                  {t.name} → 템플릿 이름
                </span>
                <input value={slugs[t.slug]} disabled={done} onInput={(e) => setSlugs({ ...slugs, [t.slug]: e.currentTarget.value.toLowerCase() })} />
              </label>
            ))}
            <label class="check">
              <input type="checkbox" checked={publish} disabled={done} onChange={(e) => setPublish(e.currentTarget.checked)} />
              가져온 뒤 바로 게시하기
            </label>
            <small class="hint">같은 이름의 에셋이 이미 있고 내용이 다르면, 새 이름(-2 등)으로 올리고 템플릿이 새 이름을 쓰게 바꿔요.</small>
            {!!log.length && <pre class="log">{log.join('\n')}</pre>}
            <div class="row end">
              <button onClick={p.onClose}>{done ? '닫기' : '취소'}</button>
              {!done && (
                <button class="primary" disabled={busy || bad} onClick={go}>
                  {busy ? '가져오는 중…' : '가져오기'}
                </button>
              )}
              {done && chat && (
                <a class="btn primary" href={`#/chat/${chat}`} onClick={p.onClose}>
                  채팅으로 가기
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
