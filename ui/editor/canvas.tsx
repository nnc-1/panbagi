// Canvas: browser-drawn preview (inside a shadow root so asset <style>s stay contained) + selection overlay.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AssetData } from '../../src/compose';
import type { Spec } from '../../src/spec';
import { getAt, hitTest, inBox, layout, nextHit, rotatePt, samePath, type Box, type Path } from '../model';
import { composeForPreview, toSafeNode } from '../preview';
import { normalizeParams } from '../../src/params';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'rot';

export function Canvas(p: {
  spec: Spec;
  values: Record<string, string>;
  assets: { map: Map<string, AssetData>; urls: Map<AssetData, string> };
  defaultFamily?: string;
  knownFamilies: Set<string>;
  sel: Path | null;
  onSelect: (p: Path | null) => void;
  onPatch: (path: Path, patch: Record<string, number>, mergeKey: string) => void;
  zoom: number | 'fit';
  fontsVersion: number;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [fitW, setFitW] = useState(600);
  const { w: cw, h: ch } = p.spec.canvas;

  useLayoutEffect(() => {
    const el = stage.current!;
    const ro = new ResizeObserver(() => setFitW(el.clientWidth - 32));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const z = p.zoom === 'fit' ? Math.max(0.1, Math.min(2, fitW / cw)) : p.zoom;

  // draw
  const svg = useMemo(() => {
    try {
      return composeForPreview(p.spec, p.values, p.assets, p.defaultFamily);
    } catch (e) {
      console.error(e);
      return '';
    }
  }, [p.spec, p.values, p.assets, p.defaultFamily, p.fontsVersion]); // fonts change how "shrink" text is sized
  useEffect(() => {
    const h = host.current!;
    const root = h.shadowRoot ?? h.attachShadow({ mode: 'open' });
    const node = svg ? toSafeNode(svg, p.defaultFamily, p.knownFamilies) : null;
    root.replaceChildren();
    if (node) {
      node.setAttribute('width', '100%');
      node.setAttribute('height', '100%');
      const style = document.createElement('style');
      style.textContent = `:host{display:block;line-height:0} svg{display:block;font-family:${p.defaultFamily ? `"${p.defaultFamily}", ` : ''}sans-serif}`;
      root.append(style, node);
    }
  }, [svg, p.fontsVersion]);

  const vals = useMemo(() => normalizeParams(p.spec, p.values).values, [p.spec, p.values]);
  const boxes = useMemo(() => layout(p.spec, vals), [p.spec, vals]);
  const selBox = p.sel ? boxes.find((b) => samePath(b.path, p.sel)) : undefined;
  const [hover, setHover] = useState<Box | null>(null);

  // drag state
  const drag = useRef<{
    path: Path;
    mode: 'move' | Handle;
    sx: number;
    sy: number;
    orig: { x: number; y: number; w: number; h: number; rot: number };
    box: Box;
    key: string;
    /** pressed on the current selection: a click without moving picks the element below instead */
    cycle?: boolean;
    moved?: boolean;
  } | null>(null);
  const toCanvas = (ev: PointerEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z };
  };
  const startDrag = (ev: PointerEvent, path: Path, mode: 'move' | Handle, box: Box, cycle = false) => {
    const e: any = getAt(p.spec, path);
    if (!e) return;
    const { x, y } = toCanvas(ev);
    const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
    drag.current = {
      path,
      mode,
      sx: x,
      sy: y,
      // w/h may be unset on text (auto); start from the measured box
      orig: { x: num(e.x, 0), y: num(e.y, 0), w: num(e.w, box.w), h: num(e.h, box.h), rot: num(e.rotate, 0) },
      box,
      key: 'drag' + Math.random(),
      cycle,
    };
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  };

  const onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const handle = (ev.target as HTMLElement).dataset?.h as Handle | undefined;
    const pt = toCanvas(ev);
    if (handle && p.sel && selBox) return startDrag(ev, p.sel, handle, selBox);
    // pressing inside the selection drags it (even if something is on top); a plain click there goes one layer down (see onUp)
    if (selBox && inBox(selBox, pt.x, pt.y)) return startDrag(ev, p.sel!, 'move', selBox, true);
    const hit = hitTest(boxes, pt.x, pt.y, p.spec);
    p.onSelect(hit);
    const b = hit && boxes.find((x) => samePath(x.path, hit));
    if (hit && b) startDrag(ev, hit, 'move', b);
  };
  const onMove = (ev: PointerEvent) => {
    const d = drag.current;
    const pt = toCanvas(ev);
    if (!d) {
      const hit = nextHit(boxes, pt.x, pt.y, p.spec, p.sel); // outline what a click here would select
      const b = hit ? (boxes.find((x) => samePath(x.path, hit)) ?? null) : null;
      if (b !== hover) setHover(b);
      return;
    }
    const e: any = getAt(p.spec, d.path);
    if (!e) return;
    if (!d.moved && Math.hypot(pt.x - d.sx, pt.y - d.sy) * z < 3) return; // a click, not a drag (yet)
    d.moved = true;
    const o = d.orig;
    const patch: Record<string, number> = {};
    if (d.mode === 'rot') {
      if (typeof e.rotate === 'object') return; // follows a value; set it in the panel
      const { cx, cy } = d.box;
      const turn = (Math.atan2(pt.y - cy, pt.x - cx) - Math.atan2(d.sy - cy, d.sx - cx)) * (180 / Math.PI);
      let deg = o.rot + turn;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(((((deg + 180) % 360) + 360) % 360) - 180);
      patch.rotate = deg === -180 ? 180 : deg;
      return p.onPatch(d.path, patch, d.key);
    }
    // screen movement in the element's own frame: groups around it may be turned
    let [dx, dy] = rotatePt(pt.x - d.sx, pt.y - d.sy, d.mode === 'move' ? -d.box.prot : -d.box.rot, 0, 0).map(Math.round);
    if (ev.shiftKey && d.mode === 'move') Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    const fixedX = typeof e.x !== 'object', fixedY = typeof e.y !== 'object';
    if (d.mode === 'move') {
      if (fixedX) patch.x = o.x + dx;
      if (fixedY) patch.y = o.y + dy;
    } else {
      const left = d.mode === 'nw' || d.mode === 'sw', top = d.mode === 'nw' || d.mode === 'ne';
      const w = Math.max(1, left ? o.w - dx : o.w + dx), h = Math.max(1, top ? o.h - dy : o.h + dy);
      if (typeof e.w !== 'object') patch.w = w;
      if (typeof e.h !== 'object') patch.h = h;
      // keep the opposite corner where it is: the center moves by half the growth, turned by the element's own angle
      const [sx, sy] = rotatePt(((left ? -1 : 1) * (w - o.w)) / 2, ((top ? -1 : 1) * (h - o.h)) / 2, o.rot, 0, 0);
      if (fixedX) patch.x = Math.round(o.x + o.w / 2 + sx - w / 2);
      if (fixedY) patch.y = Math.round(o.y + o.h / 2 + sy - h / 2);
    }
    p.onPatch(d.path, patch, d.key);
  };
  const onUp = (ev: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.cycle && !d.moved) {
      const pt = toCanvas(ev);
      p.onSelect(nextHit(boxes, pt.x, pt.y, p.spec, p.sel));
    }
  };

  const selEl: any = p.sel ? getAt(p.spec, p.sel) : null;
  const resizable = selEl && selEl.type !== 'group' && selEl.type !== 'repeat';
  const rotatable = selEl && selEl.type !== 'repeat' && typeof selEl.rotate !== 'object';
  // boxes are drawn around their final center and turned by their total angle
  const boxStyle = (b: Box) => ({
    left: (b.cx - b.w / 2) * z + 'px',
    top: (b.cy - b.h / 2) * z + 'px',
    width: b.w * z + 'px',
    height: b.h * z + 'px',
    transform: b.rot ? `rotate(${b.rot}deg)` : undefined,
  });

  return (
    // pressing the empty area around the paper clears the selection (the panel then shows the canvas settings)
    <div class="stage" ref={stage} onPointerDown={(ev) => ev.target === ev.currentTarget && p.onSelect(null)}>
      <div class="paper" style={{ width: cw * z + 'px', height: ch * z + 'px' }}>
        <div class="host" ref={host} />
        <div class="overlay" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}>
          {hover && !samePath(hover.path, p.sel) && (
            <div class="box hover" style={boxStyle(hover)} />
          )}
          {selBox && (
            <div class={'box sel' + (selBox.visible ? '' : ' hidden')} style={boxStyle(selBox)}>
              {resizable && (['nw', 'ne', 'sw', 'se'] as Handle[]).map((h) => <i key={h} class={'handle ' + h} data-h={h} />)}
              {rotatable && <i class="handle rot" data-h="rot" title="끌어서 돌리기 (Shift: 15°씩)" />}
              <span class="dims">
                {Math.round(selBox.x)}, {Math.round(selBox.y)} · {Math.round(selBox.w)}×{Math.round(selBox.h)}
                {selEl && typeof selEl.rotate === 'number' && selEl.rotate ? ` · ${selEl.rotate}°` : ''}
              </span>
            </div>
          )}
        </div>
      </div>
      {!svg && <p class="err">그림을 만들지 못했어요. JSON 탭에서 규칙을 확인해 주세요.</p>}
    </div>
  );
}
