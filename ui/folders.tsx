// Folders for the asset and font pages. A folder is only a label: for assets it is the part of the name
// before "/" ("던전/coin.svg"), for fonts it is a setting per family. An empty folder lives only on screen.
import { useState } from 'preact/hooks';
import { assetFile, assetFolder, type Asset } from './api';
import { Modal } from './ui';

export const FOLDER = /^[0-9A-Za-z가-힣_-][0-9A-Za-z가-힣._-]{0,39}$/;
export const cleanFolder = (s: string) => s.trim().replace(/\s+/g, '-').replace(/\//g, '-');

/** null = every folder, '' = items outside any folder */
export type FolderPick = string | null;

/** [folder, items] pairs, items outside a folder first, then folders by name. */
export function byFolder<T>(items: T[], folderOf: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const t of items) {
    const f = folderOf(t);
    m.has(f) ? m.get(f)!.push(t) : m.set(f, [t]);
  }
  return [...m].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'ko')));
}

export const DRAG_TYPE = 'application/x-svg-engine-item';

export function FolderBar(p: {
  /** folders that have something in them, with counts */
  counts: Map<string, number>;
  total: number;
  current: FolderPick;
  onPick: (f: FolderPick) => void;
  /** something was dragged onto a folder chip ('' = out of any folder) */
  onDropTo?: (folder: string, item: string) => void;
  onRename?: (from: string, to: string) => void;
}) {
  const [extra, setExtra] = useState<string[]>([]); // made with "+ 새 폴더", nothing in them yet
  const [over, setOver] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | { mode: 'new' } | { mode: 'rename'; from: string }>(null);
  const folders = [...new Set([...p.counts.keys(), ...extra])].filter((f) => f).sort((a, b) => a.localeCompare(b, 'ko'));

  const chip = (f: FolderPick, label: string, n: number) => {
    const key = f ?? '*';
    const droppable = p.onDropTo && f !== null;
    return (
      <button
        key={key}
        class={'folder-chip' + (p.current === f ? ' on' : '') + (over === key ? ' over' : '')}
        onClick={() => p.onPick(f)}
        onDragOver={droppable ? (e) => (e.preventDefault(), setOver(key)) : undefined}
        onDragLeave={droppable ? () => setOver(null) : undefined}
        onDrop={
          droppable
            ? (e) => {
                e.preventDefault();
                setOver(null);
                const item = e.dataTransfer?.getData(DRAG_TYPE);
                if (item) p.onDropTo!(f!, item);
              }
            : undefined
        }
      >
        {f ? '📁 ' : ''}
        {label} <small>{n}</small>
      </button>
    );
  };

  return (
    <div class="folders">
      {chip(null, '전체', p.total)}
      {chip('', '폴더 없음', p.counts.get('') ?? 0)}
      {folders.map((f) => chip(f, f, p.counts.get(f) ?? 0))}
      <button class="ghost small" onClick={() => setAsk({ mode: 'new' })}>
        + 새 폴더
      </button>
      {p.onRename && p.current && (p.counts.get(p.current) ?? 0) > 0 && (
        <button class="ghost small" onClick={() => setAsk({ mode: 'rename', from: p.current! })}>
          폴더 이름 바꾸기
        </button>
      )}
      {ask && (
        <FolderNameDialog
          title={ask.mode === 'new' ? '새 폴더' : `"${ask.from}" 폴더 이름 바꾸기`}
          initial={ask.mode === 'rename' ? ask.from : ''}
          taken={folders}
          onClose={() => setAsk(null)}
          onOk={(name) => {
            if (ask.mode === 'new') {
              setExtra([...extra, name]);
              p.onPick(name);
            } else {
              setExtra(extra.filter((x) => x !== ask.from));
              p.onRename!(ask.from, name);
              p.onPick(name);
            }
            setAsk(null);
          }}
        />
      )}
    </div>
  );
}

function FolderNameDialog(p: { title: string; initial: string; taken: string[]; onClose: () => void; onOk: (name: string) => void }) {
  const [v, setV] = useState(p.initial);
  const name = cleanFolder(v);
  const bad = !FOLDER.test(name) ? '한글·영문·숫자와 - _ . 로 40자까지 써요.' : name !== p.initial && p.taken.includes(name) ? '이미 있는 폴더예요.' : '';
  return (
    <Modal title={p.title} onClose={p.onClose}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!bad && name !== p.initial) p.onOk(name);
        }}
      >
        <label>
          폴더 이름 (예: 게임 이름)
          <input value={v} autoFocus onInput={(e) => setV(e.currentTarget.value)} placeholder="던전RPG" />
        </label>
        {v && bad && <p class="err small">{bad}</p>}
        <p class="hint">빈 폴더는 이 화면에만 있다가, 파일을 넣으면 저장돼요.</p>
        <div class="row end">
          <button type="button" onClick={p.onClose}>
            취소
          </button>
          <button class="primary" disabled={!!bad || name === p.initial}>
            확인
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Pick a folder to move something into (existing ones, "no folder", or a new name). */
export function MoveDialog(p: { title: string; folders: string[]; current: string; onClose: () => void; onOk: (folder: string) => void }) {
  const [pick, setPick] = useState(p.current);
  const [fresh, setFresh] = useState('');
  const target = pick === '\u0000new' ? cleanFolder(fresh) : pick;
  const bad = pick === '\u0000new' && !FOLDER.test(target);
  return (
    <Modal title={p.title} onClose={p.onClose}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!bad && target !== p.current) p.onOk(target);
        }}
      >
        <label>
          옮길 폴더
          <select value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
            <option value="">(폴더 없음)</option>
            {p.folders.map((f) => (
              <option key={f} value={f}>
                📁 {f}
              </option>
            ))}
            <option value={'\u0000new'}>+ 새 폴더…</option>
          </select>
        </label>
        {pick === '\u0000new' && (
          <label>
            새 폴더 이름
            <input value={fresh} autoFocus onInput={(e) => setFresh(e.currentTarget.value)} placeholder="던전RPG" />
          </label>
        )}
        <div class="row end">
          <button type="button" onClick={p.onClose}>
            취소
          </button>
          <button class="primary" disabled={bad || target === p.current}>
            옮기기
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Font folders are settings named "font_folder:<family>". */
export const FONT_FOLDER_KEY = (family: string) => 'font_folder:' + family;
export const fontFolderOf = (settings: Record<string, string>, family: string) => settings[FONT_FOLDER_KEY(family)] ?? '';

/** <option>s for every asset, grouped by folder. */
export function AssetOptions(p: { assets: Asset[] }) {
  return (
    <>
      {byFolder(p.assets, (a) => assetFolder(a.name)).map(([f, list]) => {
        const opts = list.map((a) => (
          <option key={a.name} value={a.name}>
            {f ? assetFile(a.name) : a.name}
          </option>
        ));
        return f ? (
          <optgroup key={f} label={'📁 ' + f}>
            {opts}
          </optgroup>
        ) : (
          opts
        );
      })}
    </>
  );
}
