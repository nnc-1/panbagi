import { useEffect, useMemo, useState } from 'preact/hooks';
import { ASSET_NAME, assetFile, assetFolder, get, kb, send, type Asset } from '../api';
import { DRAG_TYPE, FolderBar, MoveDialog, byFolder, type FolderPick } from '../folders';
import { loadAsset } from '../preview';
import { fail, toast, useData } from '../ui';

const TYPES: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

/** File name -> allowed asset name, inside `folder` when given ("던전/coin.svg"). Korean file names become asset.<ext>. */
export function assetNameFor(file: string, taken: Set<string>, folder = ''): string {
  const dot = file.lastIndexOf('.');
  const ext = (dot > 0 ? file.slice(dot + 1) : '').toLowerCase().replace('jpeg', 'jpg');
  let base = (dot > 0 ? file.slice(0, dot) : file).replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').replace(/^[-.]+/, '').slice(0, 50);
  if (!base) base = 'asset';
  const pre = folder ? folder + '/' : '';
  let name = `${pre}${base}.${ext}`;
  for (let k = 2; taken.has(name) || !ASSET_NAME.test(name); k++) name = `${pre}${base}-${k}.${ext}`;
  return name;
}

export function Thumb(p: { asset: Asset }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    loadAsset(p.asset).then((r) => r && setUrl(r.url));
  }, [p.asset.sha256]);
  return <div class="thumb">{url ? <img src={url} alt={p.asset.name} /> : '…'}</div>;
}

export async function uploadFiles(files: File[], assets: Asset[], folder = ''): Promise<string[]> {
  const taken = new Set(assets.map((a) => a.name));
  const done: string[] = [];
  for (const f of files) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const type = TYPES[ext] ?? f.type;
    if (!Object.values(TYPES).includes(type)) {
      toast(`${f.name}: svg, png, webp, jpg만 올릴 수 있어요`, true);
      continue;
    }
    const name = assetNameFor(f.name, taken, folder);
    taken.add(name);
    try {
      await send('PUT', `/assets/${encodeURIComponent(name)}`, await f.arrayBuffer(), type);
      done.push(name);
    } catch (e) {
      fail(e);
    }
  }
  if (done.length) toast(`${done.length}개 올렸어요`);
  return done;
}

/** Rename an asset into another folder; the server updates every template that uses it. */
async function moveAsset(a: string, folder: string, assets: Asset[]): Promise<string | null> {
  const taken = new Set(assets.map((x) => x.name).filter((n) => n !== a));
  const to = assetNameFor(assetFile(a), taken, folder);
  try {
    await send('POST', `/assets/${encodeURIComponent(a)}/move`, { to });
    return to;
  } catch (e) {
    fail(e);
    return null;
  }
}

export function AssetsPage() {
  const { assets, reload } = useData();
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<FolderPick>(null);
  const [usage, setUsage] = useState<Record<string, string[]>>({});
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<Asset | null>(null);

  useEffect(() => {
    get<{ chat: string; template: string; draft: any }[]>('/templates')
      .then((list) => {
        const u: Record<string, string[]> = {};
        for (const t of list) for (const n of Object.values<string>(t.draft.assets ?? {})) (u[n] ??= []).push(`${t.chat}/${t.template}`);
        setUsage(u);
      })
      .catch(fail);
  }, [assets]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(assetFolder(a.name), (m.get(assetFolder(a.name)) ?? 0) + 1);
    return m;
  }, [assets]);
  const shown = useMemo(
    () => assets.filter((a) => (folder === null || assetFolder(a.name) === folder) && (!q || a.name.toLowerCase().includes(q.toLowerCase()))),
    [assets, q, folder],
  );
  const folders = [...counts.keys()].filter((f) => f).sort((a, b) => a.localeCompare(b, 'ko'));

  const up = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    await uploadFiles(files, assets, folder ?? '');
    await reload(['assets']);
    setBusy(false);
  };
  const replace = async (a: Asset, f?: File) => {
    if (!f) return;
    try {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      await send('PUT', `/assets/${encodeURIComponent(a.name)}`, await f.arrayBuffer(), TYPES[ext] ?? f.type);
      toast('바꿨어요. 이미 만든 이미지는 저장본 수명이 지난 뒤부터 새 그림으로 나와요.');
      reload(['assets']);
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (a: Asset) => {
    const used = usage[a.name];
    if (!confirm(used?.length ? `"${a.name}"은 템플릿 ${used.join(', ')}에서 쓰고 있어요. 지우면 그 자리가 비어요. 지울까요?` : `"${a.name}"을 지울까요?`)) return;
    try {
      await send('DELETE', `/assets/${encodeURIComponent(a.name)}`);
      reload(['assets']);
    } catch (e) {
      fail(e);
    }
  };
  const move = async (name: string, to: string) => {
    if (assetFolder(name) === to) return;
    const done = await moveAsset(name, to, assets);
    if (done) toast(`${done}(으)로 옮겼어요. 쓰던 템플릿도 같이 바뀌었어요.`);
    reload(['assets']);
  };
  const rename = async (a: Asset) => {
    const file = assetFile(a.name);
    const dot = file.lastIndexOf('.');
    const ext = dot > 0 ? file.slice(dot) : '';
    const typed = prompt('새 이름 (영문·숫자·_ - . 만, 확장자는 그대로 붙어요)', dot > 0 ? file.slice(0, dot) : file)?.trim();
    if (!typed) return;
    const base = typed.toLowerCase().endsWith(ext.toLowerCase()) && ext ? typed.slice(0, -ext.length) : typed;
    const folderPart = assetFolder(a.name);
    const to = (folderPart ? folderPart + '/' : '') + base + ext;
    if (to === a.name) return;
    if (!ASSET_NAME.test(to)) return toast('영문, 숫자, _ - . 만 쓸 수 있어요 (64자까지)');
    if (assets.some((x) => x.name === to)) return toast('같은 이름의 에셋이 이미 있어요');
    try {
      await send('POST', `/assets/${encodeURIComponent(a.name)}/move`, { to });
      toast(`${to}(으)로 바꿨어요. 쓰던 템플릿도 같이 바뀌었어요.`);
    } catch (e) {
      fail(e);
    }
    reload(['assets']);
  };
  const renameFolder = async (from: string, to: string) => {
    setBusy(true);
    let list = assets;
    for (const a of assets.filter((x) => assetFolder(x.name) === from)) {
      const done = await moveAsset(a.name, to, list);
      if (done) list = list.map((x) => (x.name === a.name ? { ...x, name: done } : x));
    }
    toast(`폴더 이름을 ${to}(으)로 바꿨어요`);
    await reload(['assets']);
    setBusy(false);
  };

  const card = (a: Asset) => (
    <div class="asset" key={a.name} draggable onDragStart={(e) => e.dataTransfer?.setData(DRAG_TYPE, a.name)}>
      <Thumb asset={a} />
      <b title={a.name}>{assetFile(a.name)}</b>
      <small>
        {a.kind.toUpperCase()} · {kb(a.bytes)}
      </small>
      <small class="used">{usage[a.name]?.length ? '사용: ' + usage[a.name].join(', ') : '쓰는 템플릿 없음'}</small>
      <div class="row tight wrap">
        <label class="btn small">
          바꾸기
          <input type="file" hidden accept=".svg,.png,.webp,.jpg,.jpeg" onChange={(e) => replace(a, e.currentTarget.files?.[0])} />
        </label>
        <button class="small" onClick={() => rename(a)}>
          이름 바꾸기
        </button>
        <button class="small" onClick={() => setMoving(a)}>
          옮기기
        </button>
        <button class="small danger" onClick={() => remove(a)}>
          삭제
        </button>
      </div>
    </div>
  );

  return (
    <section class="page">
      <div class="page-head">
        <h2>에셋</h2>
        <input type="search" placeholder="이름으로 찾기" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <FolderBar counts={counts} total={assets.length} current={folder} onPick={setFolder} onDropTo={(f, name) => move(name, f)} onRename={renameFolder} />
      <label
        class={'drop' + (over ? ' over' : '')}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), up([...(e.dataTransfer?.files ?? [])]))}
      >
        {busy
          ? '올리는 중…'
          : `이미지 파일을 여기에 끌어다 놓거나 눌러서 고르세요${folder ? ` → 📁 ${folder}에 들어가요` : ''} (svg, png, webp, jpg · 5MB 이하 · 여러 개 가능)`}
        <input type="file" multiple accept=".svg,.png,.webp,.jpg,.jpeg" onChange={(e) => up([...(e.currentTarget.files ?? [])])} />
      </label>
      <p class="hint">
        SVG가 가장 가볍고 선명해요. SVG 안의 스크립트와 외부 링크는 올릴 때 지워져요. 파일 이름의 한글과 공백은 빠지고 영문 이름으로 올라가요(폴더 이름은 한글도
        돼요). 카드를 위쪽 폴더로 끌어 놓아도 옮겨져요. 옮겨도 그 에셋을 쓰는 템플릿은 그대로 그려져요.
      </p>
      {!assets.length && <p class="empty">아직 에셋이 없어요.</p>}
      {folder !== null && assets.length > 0 && !shown.length && <p class="empty">이 폴더는 비어 있어요. 위 칸에 파일을 놓으면 이 폴더에 올라가요.</p>}
      {folder === null && !q ? (
        byFolder(shown, (a) => assetFolder(a.name)).map(([f, list]) => (
          <div key={f || '-'}>
            <h3 class="folder-head">{f ? `📁 ${f}` : '폴더 없음'}</h3>
            <div class="grid">{list.map(card)}</div>
          </div>
        ))
      ) : (
        <div class="grid">{shown.map(card)}</div>
      )}
      {moving && (
        <MoveDialog
          title={`${moving.name} 옮기기`}
          folders={folders}
          current={assetFolder(moving.name)}
          onClose={() => setMoving(null)}
          onOk={(f) => (setMoving(null), move(moving.name, f))}
        />
      )}
    </section>
  );
}
