import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AssetData } from '../../src/compose';
import { validateSpec, type El, type Spec } from '../../src/spec';
import { assetFile, get, send, type TemplateDetail } from '../api';
import { clone, defaultsOf, getAt, insertAt, layout, listAt, moveTo, newElement, newTextBox, removeAt, updateAt, type Path, TYPE_LABEL } from '../model';
import { assetsFor, fontsFor } from '../preview';
import { normalizeParams } from '../../src/params';
import { Modal, fail, toast, useData } from '../ui';
import { uploadFiles } from '../pages/assets';
import { setLeaveGuard } from '../guard';
import { Canvas } from './canvas';
import { Layers } from './layers';
import { CanvasProps, Props } from './props';
import { ParamsPanel } from './params';
import { PreviewPanel } from './preview-panel';

type Tab = 'props' | 'params' | 'preview' | 'json' | 'versions';

function useHistory(initial: Spec) {
  const [state, setState] = useState({ past: [] as Spec[], now: initial, future: [] as Spec[], key: '' });
  const set = useCallback((next: Spec | ((s: Spec) => Spec), mergeKey = '') => {
    setState((s) => {
      const n = typeof next === 'function' ? next(s.now) : next;
      if (n === s.now) return s;
      // consecutive changes with the same key (one drag, one text field) are one undo step
      const merge = mergeKey && mergeKey === s.key;
      return { past: merge ? s.past : [...s.past.slice(-99), s.now], now: n, future: [], key: mergeKey };
    });
  }, []);
  const undo = () => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), now: s.past[s.past.length - 1], future: [s.now, ...s.future], key: '' } : s));
  const redo = () => setState((s) => (s.future.length ? { past: [...s.past, s.now], now: s.future[0], future: s.future.slice(1), key: '' } : s));
  const reset = (sp: Spec) => setState({ past: [], now: sp, future: [], key: '' });
  return { spec: state.now, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

export function Editor(p: { chat: string; slug: string }) {
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    get<TemplateDetail>(`/chats/${p.chat}/templates/${p.slug}`).then(setDetail, (e) => setErr(e.message));
  }, []);
  if (err)
    return (
      <p class="empty">
        {err} <a href={`#/chat/${p.chat}`}>돌아가기</a>
      </p>
    );
  if (!detail) return <div class="loading">불러오는 중…</div>;
  return <EditorInner detail={detail} onReload={(d) => setDetail(d)} />;
}

function EditorInner(p: { detail: TemplateDetail; onReload: (d: TemplateDetail) => void }) {
  const { chat, template: slug } = p.detail;
  const data = useData();
  const h = useHistory(p.detail.draft);
  const spec = h.spec;
  const [saved, setSaved] = useState(JSON.stringify(p.detail.draft));
  const [publishedJson, setPublishedJson] = useState<string | null>(null);
  const [name, setName] = useState(p.detail.name);
  const [sel, setSel] = useState<Path | null>(null);
  const [tab, setTab] = useState<Tab>('props');
  const [values, setValues] = useState<Record<string, string>>(() => defaultsOf(p.detail.draft));
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(spec) !== saved || name !== p.detail.name;

  // published spec (to warn about unpublished changes)
  useEffect(() => {
    if (p.detail.published_version)
      get<Spec>(`/chats/${chat}/templates/${slug}/versions/${p.detail.published_version}`).then((s) => setPublishedJson(JSON.stringify(s)), () => {});
    else setPublishedJson(null);
  }, [p.detail.published_version]);

  // keep preview values valid when params change; a value still at the old default follows the new default
  const prevDefaults = useRef(defaultsOf(p.detail.draft));
  useEffect(() => {
    const d = defaultsOf(spec);
    const old = prevDefaults.current;
    prevDefaults.current = d;
    setValues((v) => {
      const o: Record<string, string> = {};
      for (const k of Object.keys(d)) o[k] = k in v && v[k] !== old[k] ? v[k] : d[k];
      return o;
    });
  }, [JSON.stringify(spec.params)]);

  // assets & fonts for the browser preview
  const [assets, setAssets] = useState<{ map: Map<string, AssetData>; urls: Map<AssetData, string> }>({ map: new Map(), urls: new Map() });
  const assetKey = JSON.stringify(spec.assets ?? {}) + data.assets.map((a) => a.sha256).join();
  useEffect(() => {
    let live = true;
    assetsFor(spec, data.assets).then((a) => live && setAssets(a));
    return () => void (live = false);
  }, [assetKey]);
  const [fontsVersion, setFontsVersion] = useState(0);
  const fontKey = JSON.stringify(spec.elements).length + data.fonts.map((f) => f.id).join();
  useEffect(() => {
    fontsFor(spec, data.fonts, data.settings.default_font ?? data.fonts[0]?.family).then(() => setFontsVersion((v) => v + 1));
  }, [fontKey]);
  const defaultFamily = data.settings.default_font ?? data.fonts[0]?.family;
  const knownFamilies = useMemo(() => new Set(data.fonts.map((f) => f.family)), [data.fonts]);

  // warn before leaving with unsaved changes: Back, links (hash routes), and closing or reloading the tab
  useEffect(() => {
    setLeaveGuard(dirty ? () => confirm('저장하지 않은 변경이 있어요. 나가면 사라져요. 나갈까요?') : null);
    return () => setLeaveGuard(null);
  }, [dirty]);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    addEventListener('beforeunload', f);
    return () => removeEventListener('beforeunload', f);
  }, [dirty]);

  const save = async (): Promise<boolean> => {
    const problems = validateSpec(spec);
    if (problems.length) {
      toast('규칙에 문제가 있어요: ' + problems.slice(0, 3).join(', '), true);
      return false;
    }
    setBusy(true);
    try {
      await send('PUT', `/chats/${chat}/templates/${slug}?name=${encodeURIComponent(name || slug)}`, spec);
      setSaved(JSON.stringify(spec));
      p.onReload({ ...p.detail, name: name || slug, draft: clone(spec) });
      data.reload(['chats']);
      toast('초안을 저장했어요');
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!(await save())) return;
    setBusy(true);
    try {
      const r = await send<{ version: number }>('POST', `/chats/${chat}/templates/${slug}/publish`);
      const d = await get<TemplateDetail>(`/chats/${chat}/templates/${slug}`);
      p.onReload(d);
      data.reload(['chats']);
      toast(`v${r.version}로 게시했어요. 이미지 주소가 새 디자인으로 바뀌어요.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // ---- element operations ----
  const sel0 = sel && getAt(spec, sel) ? sel : null;
  const selEl = sel0 ? getAt(spec, sel0)! : null;
  const add = (type: El['type'], box = false) => {
    const el = box ? newTextBox(spec) : newElement(type, spec);
    // add inside the selected group, else next to the selection, else on top
    let parent: Path = [], index = spec.elements.length;
    if (selEl && (selEl.type === 'group' || selEl.type === 'repeat')) ((parent = sel0!), (index = 1e9));
    else if (sel0) ((parent = sel0.slice(0, -1)), (index = sel0[sel0.length - 1] + 1));
    if (parent.length) {
      // place relative to the group: start at its origin
      Object.assign(el, { x: 0, y: 0 });
    }
    const r = insertAt(spec, parent, index, el);
    h.set(r.spec);
    setSel(r.path);
    setTab('props');
  };
  const patchSel = (patch: Record<string, unknown>, key = '') => {
    if (!sel0) return;
    h.set(
      (s) =>
        updateAt(s, sel0, (e) => {
          for (const [k, v] of Object.entries(patch)) v === undefined ? delete e[k] : (e[k] = v);
        }),
      key || 'props:' + sel0.join('.') + ':' + Object.keys(patch).join(),
    );
  };
  const del = () => {
    if (!sel0) return;
    h.set(removeAt(spec, sel0));
    setSel(null);
  };
  const dup = () => {
    if (!sel0) return;
    const el: any = clone(selEl);
    if (typeof el.x === 'number') el.x += 10;
    if (typeof el.y === 'number') el.y += 10;
    if (el.name) el.name += ' 복사';
    const r = insertAt(spec, sel0.slice(0, -1), sel0[sel0.length - 1] + 1, el);
    h.set(r.spec);
    setSel(r.path);
  };
  // a text element right of the selected one (used by the bar's "percent text" buttons)
  const addLabel = (text: string) => {
    if (!sel0) return;
    const b: any = selEl;
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);
    const hh = Math.max(16, Math.min(40, num(b.h) || 20));
    const el = { type: 'text', name: '게이지 글자', x: num(b.x) + num(b.w) + 8, y: num(b.y) + (num(b.h) - hh) / 2, h: hh, text, size: Math.round(hh * 0.75), fill: '#ffffff' } as El;
    const r = insertAt(spec, sel0.slice(0, -1), sel0[sel0.length - 1] + 1, el);
    h.set(r.spec);
    setSel(r.path);
  };
  const shift = (d: 1 | -1) => {
    if (!sel0) return;
    const parent = sel0.slice(0, -1), i = sel0[sel0.length - 1];
    const len = listAt(spec, parent).length;
    const j = i + d;
    if (j < 0 || j >= len) return;
    const r = moveTo(spec, sel0, parent, d > 0 ? j + 1 : j);
    if (r) (h.set(r.spec), setSel(r.path));
  };
  const wrap = () => {
    if (!sel0) return;
    const el = clone(selEl!);
    const s = updateAt(spec, sel0, () => {});
    listAt(s, sel0.slice(0, -1))[sel0[sel0.length - 1]] = { type: 'group', name: '그룹', x: 0, y: 0, children: [el] };
    h.set(s);
  };
  const unwrap = () => {
    if (!sel0 || selEl?.type !== 'group') return;
    const g: any = selEl;
    const ox = typeof g.x === 'number' ? g.x : 0, oy = typeof g.y === 'number' ? g.y : 0;
    const kids = (g.children as any[]).map((c) => ({ ...c, x: typeof c.x === 'number' || c.x === undefined ? (c.x ?? 0) + ox : c.x, y: typeof c.y === 'number' || c.y === undefined ? (c.y ?? 0) + oy : c.y }));
    const s = clone(spec);
    listAt(s, sel0.slice(0, -1)).splice(sel0[sel0.length - 1], 1, ...kids);
    h.set(s);
    setSel(null);
  };
  const addAlias = (assetName: string): string => {
    const existing = Object.entries(spec.assets ?? {}).find(([, n]) => n === assetName);
    if (existing) return existing[0];
    let alias = assetFile(assetName).replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'asset';
    for (let k = 2; spec.assets && alias in spec.assets; k++) alias = alias.replace(/-\d+$/, '') + '-' + k;
    h.set((s) => ({ ...s, assets: { ...(s.assets ?? {}), [alias]: assetName } }));
    return alias;
  };

  // keyboard shortcuts
  const keyRef = useRef<(e: KeyboardEvent) => void>();
  keyRef.current = (e: KeyboardEvent) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') return e.preventDefault(), void save();
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') return e.preventDefault(), e.shiftKey ? h.redo() : h.undo();
    if (mod && e.key.toLowerCase() === 'y') return e.preventDefault(), h.redo();
    if (mod && e.key.toLowerCase() === 'd') return e.preventDefault(), dup();
    if (!sel0 || !selEl) return;
    if (e.key === 'Delete' || e.key === 'Backspace') return e.preventDefault(), del();
    if (e.key === 'Escape') return setSel(null);
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      const el: any = selEl;
      const patch: Record<string, number> = {};
      if (a[0] && typeof (el.x ?? 0) === 'number') patch.x = (el.x ?? 0) + a[0];
      if (a[1] && typeof (el.y ?? 0) === 'number') patch.y = (el.y ?? 0) + a[1];
      patchSel(patch, 'nudge:' + sel0.join('.'));
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current!(e);
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, []);

  const boxes = useMemo(() => layout(spec, normalizeParams(spec, values).values), [spec, values]);
  const hidden = useMemo(() => new Set(boxes.filter((b) => !b.visible).map((b) => b.path.join('.'))), [boxes]);
  /** line the selected element up with the canvas edges or middle (as it is drawn with the current preview values) */
  const align = (k: 'l' | 'c' | 'r' | 't' | 'm' | 'b') => {
    const b = sel0 && boxes.find((x) => x.path.join('.') === sel0.join('.'));
    const e: any = selEl;
    if (!b || !e) return;
    const { w: cw, h: ch } = spec.canvas;
    const horiz = k === 'l' || k === 'c' || k === 'r';
    const key = horiz ? 'x' : 'y';
    if (e[key] !== undefined && typeof e[key] !== 'number') return toast(`${key}가 값에 따라 바뀌어서 맞출 수 없어요`);
    const d = horiz ? (k === 'l' ? -b.x : k === 'c' ? (cw - b.w) / 2 - b.x : cw - b.w - b.x) : k === 't' ? -b.y : k === 'm' ? (ch - b.h) / 2 - b.y : ch - b.h - b.y;
    patchSel({ [key]: Math.round(((e[key] ?? 0) + d) * 10) / 10 }, 'align' + Math.random());
  };

  const published = !!p.detail.published_version;
  const draftDiffers = published && publishedJson !== null && publishedJson !== JSON.stringify(spec);

  return (
    <div class="editor">
      <div class="toolbar">
        <a href={`#/chat/${chat}`} class="btn ghost" title="채팅으로">
          ←
        </a>
        <input class="tname" value={name} onInput={(e) => setName(e.currentTarget.value)} title="템플릿 표시 이름" />
        <code class="addr">
          /{chat}/{slug}.webp
        </code>
        <span class="sep" />
        {(['text', 'image', 'shape', 'bar', 'repeat', 'group'] as El['type'][]).map((t) => (
          <button key={t} class="small" onClick={() => add(t)} title={`${TYPE_LABEL[t]} 추가`}>
            + {TYPE_LABEL[t]}
          </button>
        ))}
        <button class="small" onClick={() => add('text', true)} title="여러 줄 글상자 추가 (박스 안에서 줄바꿈)">
          + 글상자
        </button>
        <span class="sep" />
        <button class="small ghost" disabled={!h.canUndo} onClick={h.undo} title="되돌리기 (Ctrl+Z)">
          ↶
        </button>
        <button class="small ghost" disabled={!h.canRedo} onClick={h.redo} title="다시 하기 (Ctrl+Y)">
          ↷
        </button>
        <select class="small" value={String(zoom)} onChange={(e) => setZoom(e.currentTarget.value === 'fit' ? 'fit' : Number(e.currentTarget.value))} title="확대">
          <option value="fit">맞춤</option>
          <option value="0.5">50%</option>
          <option value="1">100%</option>
          <option value="2">200%</option>
        </select>
        <span class="grow" />
        <span class={'state' + (dirty ? ' dirty' : '')}>{dirty ? '저장 안 됨' : published ? (draftDiffers ? '게시 안 된 변경' : `게시 v${p.detail.published_version}`) : '게시 안 됨'}</span>
        <button onClick={save} disabled={busy || !dirty} title="Ctrl+S">
          초안 저장
        </button>
        <button class="primary" onClick={publish} disabled={busy || (!dirty && !draftDiffers && published)}>
          게시
        </button>
      </div>
      <div class="panes">
        <aside class="left">
          <div class="pane-title">레이어</div>
          <Layers
            spec={spec}
            sel={sel0}
            onSelect={(s) => (setSel(s), setTab('props'))}
            hidden={hidden}
            onMove={(from, parent, index) => {
              const r = moveTo(spec, from, parent, index);
              if (r) (h.set(r.spec), setSel(r.path));
            }}
          />
          <AssetDrop onUploaded={async (names) => {
            await data.reload(['assets']);
            if (names[0]) {
              const alias = addAlias(names[0]);
              const el = { ...newElement('image', spec), asset: alias } as El;
              const r = insertAt({ ...spec, assets: { ...(spec.assets ?? {}), [alias]: names[0] } }, [], spec.elements.length, el);
              h.set(r.spec);
              setSel(r.path);
            }
          }} />
        </aside>
        <section class="center">
          <Canvas
            spec={spec}
            values={values}
            assets={assets}
            defaultFamily={defaultFamily}
            knownFamilies={knownFamilies}
            sel={sel0}
            onSelect={(s) => (setSel(s), setTab('props'))}
            onPatch={(path, patch, key) => h.set((s) => updateAt(s, path, (e) => Object.assign(e, patch)), key)}
            zoom={zoom}
            fontsVersion={fontsVersion}
          />
          <p class="hint center-hint">끌어서 옮기고 모서리로 크기를 바꿔요. 방향키로 1px(Shift는 10px), Delete로 삭제, Ctrl+D 복제, Ctrl+Z 되돌리기.</p>
        </section>
        <aside class="right">
          <div class="tabs">
            {(
              [
                ['props', '속성'],
                ['params', '파라미터'],
                ['preview', '값·주소'],
                ['json', 'JSON'],
                ['versions', '버전'],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button key={k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          <div class="tab-body">
            {tab === 'props' &&
              (selEl ? (
                <Props
                  el={selEl}
                  spec={spec}
                  fonts={data.fonts}
                  assets={data.assets}
                  settings={data.settings}
                  onChange={(patch) => patchSel(patch)}
                  onAddAlias={addAlias}
                  onAddLabel={addLabel}
                  onAlign={align}
                  actions={{ dup, del, up: () => shift(1), down: () => shift(-1), wrap, unwrap: selEl.type === 'group' ? unwrap : undefined }}
                />
              ) : (
                <CanvasProps spec={spec} onChange={(s) => h.set(s, 'canvas')} />
              ))}
            {tab === 'params' && <ParamsPanel spec={spec} onSpec={(s) => h.set(s, 'params')} assets={data.assets} />}
            {tab === 'preview' && (
              <PreviewPanel chat={chat} slug={slug} name={name} spec={spec} values={values} setValues={setValues} published={published} draftDiffers={draftDiffers} />
            )}
            {tab === 'json' && <JsonTab spec={spec} onApply={(s) => (h.set(s), setSel(null))} />}
            {tab === 'versions' && (
              <Versions
                detail={p.detail}
                onLoad={(s) => (h.set(s), setSel(null), toast('불러왔어요. 저장하면 초안이 이 내용으로 바뀌어요.'))}
                onRolledBack={async () => p.onReload(await get<TemplateDetail>(`/chats/${chat}/templates/${slug}`))}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function AssetDrop(p: { onUploaded: (names: string[]) => void }) {
  const { assets } = useData();
  const [over, setOver] = useState(false);
  const up = async (files: File[]) => files.length && p.onUploaded(await uploadFiles(files, assets));
  return (
    <label
      class={'drop small' + (over ? ' over' : '')}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => (e.preventDefault(), setOver(false), up([...(e.dataTransfer?.files ?? [])]))}
    >
      이미지 파일을 여기 놓으면 올리고 바로 배치해요
      <input type="file" multiple accept=".svg,.png,.webp,.jpg,.jpeg" onChange={(e) => up([...(e.currentTarget.files ?? [])])} />
    </label>
  );
}

function JsonTab(p: { spec: Spec; onApply: (s: Spec) => void }) {
  const [txt, setTxt] = useState(() => JSON.stringify(p.spec, null, 2));
  const [msg, setMsg] = useState('');
  useEffect(() => setTxt(JSON.stringify(p.spec, null, 2)), [p.spec]);
  const apply = () => {
    try {
      const s = JSON.parse(txt);
      const errs = validateSpec(s);
      if (errs.length) return setMsg('문제: ' + errs.join(', '));
      p.onApply(s);
      setMsg('적용했어요');
    } catch (e: any) {
      setMsg('JSON 형식이 아니에요: ' + e.message);
    }
  };
  return (
    <div class="props">
      <p class="hint">템플릿 규칙 전체예요. 고친 뒤 "적용"을 누르면 편집기에 반영돼요(저장은 따로).</p>
      <textarea class="mono json" spellcheck={false} value={txt} onInput={(e) => setTxt(e.currentTarget.value)} />
      <div class="row">
        <button class="primary small" onClick={apply}>
          적용
        </button>
        <button class="small" onClick={() => setTxt(JSON.stringify(p.spec, null, 2))}>
          되돌리기
        </button>
      </div>
      {msg && <p class="hint">{msg}</p>}
    </div>
  );
}

function Versions(p: { detail: TemplateDetail; onLoad: (s: Spec) => void; onRolledBack: () => void }) {
  const { chat, template } = p.detail;
  const [confirmV, setConfirmV] = useState<number | null>(null);
  const load = async (v: number) => {
    try {
      p.onLoad(await get<Spec>(`/chats/${chat}/templates/${template}/versions/${v}`));
    } catch (e) {
      fail(e);
    }
  };
  const rollback = async (v: number) => {
    try {
      await send('POST', `/chats/${chat}/templates/${template}/rollback`, { version: v });
      toast(`이미지 주소가 이제 v${v}로 그려져요`);
      setConfirmV(null);
      p.onRolledBack();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div class="props">
      <p class="hint">게시할 때마다 버전이 하나씩 쌓이고, 게시한 버전은 바뀌지 않아요. 주소 뒤에 @번호를 붙이면 그 버전으로 고정돼요(예: {template}@2.webp).</p>
      {!p.detail.versions.length && <p class="empty small">아직 게시한 적이 없어요.</p>}
      {p.detail.versions.map((v) => (
        <div class="version" key={v.version}>
          <div>
            <b>v{v.version}</b> {v.version === p.detail.published_version && <span class="badge ok">지금 게시본</span>}
            <small> {v.published_at} (UTC)</small>
          </div>
          <div class="row wrap tight">
            <button class="small" onClick={() => load(v.version)}>
              편집기로 불러오기
            </button>
            {v.version !== p.detail.published_version && (
              <button class="small" onClick={() => setConfirmV(v.version)}>
                이 버전으로 되돌리기
              </button>
            )}
          </div>
        </div>
      ))}
      {confirmV !== null && (
        <Modal title={`v${confirmV}로 되돌리기`} onClose={() => setConfirmV(null)}>
          <p>이미지 주소가 v{confirmV}의 디자인으로 그려져요. 초안과 다른 버전은 그대로 남아요. 이미 만든 이미지는 저장본 수명이 지난 뒤부터 바뀌어요.</p>
          <div class="row end">
            <button onClick={() => setConfirmV(null)}>취소</button>
            <button class="primary" onClick={() => rollback(confirmV)}>
              되돌리기
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
