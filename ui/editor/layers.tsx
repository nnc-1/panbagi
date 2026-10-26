// Layer tree. Shown front-to-back (the element drawn last is at the top), like most design tools.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { El, Spec } from '../../src/spec';
import { TYPE_LABEL, elLabel, getAt, isAncestor, samePath, type Path } from '../model';

const ICON: Record<El['type'], string> = { text: 'T', image: '▣', shape: '■', bar: '▬', repeat: '⋯', group: '▤' };

type Drop = { path: Path; where: 'front' | 'back' | 'into' };

export function Layers(p: {
  spec: Spec;
  sel: Path | null;
  onSelect: (p: Path | null) => void;
  /** move `from` to `index` (spec order) inside `parent` */
  onMove: (from: Path, parent: Path, index: number) => void;
  hidden: Set<string>;
}) {
  const [drag, setDrag] = useState<Path | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.sel) return;
    // open the groups around a selection made on the canvas, then bring its row into view
    const keys = p.sel.slice(0, -1).map((_, k) => p.sel!.slice(0, k + 1).join('.'));
    if (keys.some((k) => closed.has(k))) setClosed(new Set([...closed].filter((k) => !keys.includes(k))));
    requestAnimationFrame(() => box.current?.querySelector('.layer.on')?.scrollIntoView({ block: 'nearest' }));
  }, [p.sel?.join('.')]);

  const finish = () => {
    if (drag && drop && !samePath(drag, drop.path) && !isAncestor(drag, drop.path)) {
      const parent = drop.where === 'into' ? drop.path : drop.path.slice(0, -1);
      const i = drop.path[drop.path.length - 1];
      // spec order: later = in front. "front" of a row = after it in the spec.
      p.onMove(drag, parent, drop.where === 'into' ? 1e9 : drop.where === 'front' ? i + 1 : i); // into = on top of its children
    }
    setDrag(null);
    setDrop(null);
  };

  // the group that holds the selection (or the selected group itself): its guide line is highlighted
  const focus = p.sel && (getAt(p.spec, p.sel)?.type === 'group' || getAt(p.spec, p.sel)?.type === 'repeat') ? p.sel : p.sel?.slice(0, -1);

  const rows = (els: El[], base: Path, depth: number): preact.JSX.Element[] =>
    els
      .map((e, i) => ({ e, path: [...base, i] }))
      .reverse()
      .flatMap(({ e, path }) => {
        const key = path.join('.');
        const container = e.type === 'group' || e.type === 'repeat';
        const isOpen = !closed.has(key);
        const cls = ['layer', samePath(p.sel, path) ? 'on' : '', p.hidden.has(key) ? 'dim' : '', drop && samePath(drop.path, path) ? 'drop-' + drop.where : ''].join(' ');
        const out = [
          <div
            key={key}
            class={cls}
            draggable
            onDragStart={(ev) => (setDrag(path), ev.dataTransfer?.setData('text/plain', key))}
            onDragOver={(ev) => {
              ev.preventDefault();
              const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
              const f = (ev.clientY - r.top) / r.height;
              setDrop({ path, where: container && f > 0.3 && f < 0.7 ? 'into' : f < 0.5 ? 'front' : 'back' });
            }}
            onDrop={(ev) => (ev.preventDefault(), finish())}
            onDragEnd={() => (setDrag(null), setDrop(null))}
            onClick={() => p.onSelect(path)}
          >
            {path.slice(0, -1).map((_, k) => (
              // one vertical line per enclosing group/repeat; the innermost one gets a tick into the row
              <i key={k} class={'guide' + (k === depth - 1 ? ' tick' : '') + (focus?.length === k + 1 && samePath(focus, path.slice(0, k + 1)) ? ' on' : '')} />
            ))}
            {container ? (
              <button
                class="twisty"
                onClick={(ev) => {
                  ev.stopPropagation();
                  const n = new Set(closed);
                  isOpen ? n.add(key) : n.delete(key);
                  setClosed(n);
                }}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            ) : (
              <span class="twisty" />
            )}
            <span class="ico" title={TYPE_LABEL[e.type]}>
              {ICON[e.type]}
            </span>
            <span class="lname">{elLabel(e)}</span>
            {container && (
              <span class="tag" title={TYPE_LABEL[e.type] + ' 안의 요소 수'}>
                {e.name ? TYPE_LABEL[e.type] + ' · ' : ''}
                {((e as any).children ?? []).length}개
              </span>
            )}
            {e.when && (
              <span class="tag" title="조건에 따라 보임">
                조건
              </span>
            )}
          </div>,
        ];
        if (container && isOpen) out.push(...rows((e as any).children ?? [], path, depth + 1));
        return out;
      });

  return (
    <div class="layers" ref={box} onClick={(ev) => ev.target === ev.currentTarget && p.onSelect(null)}>
      <div class={'layer' + (p.sel ? '' : ' on')} onClick={() => p.onSelect(null)} title="캔버스 크기와 배경색">
        <span class="twisty" />
        <span class="ico">▭</span>
        <span class="lname">
          캔버스 {p.spec.canvas.w}×{p.spec.canvas.h}
        </span>
      </div>
      {rows(p.spec.elements, [], 0)}
      {!p.spec.elements.length && <p class="empty small">위의 + 버튼으로 요소를 추가하세요.</p>}
      <p class="hint small">위에 있을수록 앞에 그려져요. 끌어서 순서를 바꾸고, 그룹·반복 가운데에 놓으면 안으로 들어가요.</p>
    </div>
  );
}
