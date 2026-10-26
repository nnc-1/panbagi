// "에셋" tab: the pictures (by alias) and fonts this template uses, managed in one place.
import type { El, Spec } from '../../src/spec';
import type { Asset, Font } from '../api';
import { AssetOptions } from '../folders';
import { Thumb } from '../pages/assets';
import { FontSelect } from './props';

/** every asset alias an image element can draw: a fixed value, each case or stop, and the default */
function aliasesIn(v: unknown, out: string[]) {
  if (typeof v === 'string') return void (v && out.push(v));
  if (v && typeof v === 'object') {
    const o = v as any;
    if (o.cases) Object.values(o.cases).forEach((x) => aliasesIn(x, out));
    if (o.stops) o.stops.forEach((x: any) => aliasesIn(x.value, out));
    aliasesIn(o.default, out);
  }
}

function walk(els: El[], f: (e: El) => void) {
  for (const e of els) {
    f(e);
    if (e.type === 'group' || e.type === 'repeat') walk(e.children, f);
  }
}

function mapEls(els: El[], f: (e: El) => El): El[] {
  return els.map((e) => {
    const n = f(e);
    return n.type === 'group' || n.type === 'repeat' ? { ...n, children: mapEls(n.children, f) } : n;
  });
}

export function AssetsPanel(p: {
  spec: Spec;
  onSpec: (s: Spec) => void;
  assets: Asset[];
  fonts: Font[];
  settings: Record<string, string>;
  defaultFamily?: string;
  onAddAlias: (assetName: string) => string;
}) {
  const aliases = Object.entries(p.spec.assets ?? {});
  const setAliases = (list: [string, string][]) => {
    const s: Spec = { ...p.spec, assets: Object.fromEntries(list) };
    if (!list.length) delete s.assets;
    p.onSpec(s);
  };
  const imgUse = new Map<string, number>();
  const fontUse = new Map<string, number>(); // '' = the default font
  walk(p.spec.elements, (e) => {
    if (e.type === 'image') {
      const found: string[] = [];
      aliasesIn(e.asset, found);
      for (const a of new Set(found)) imgUse.set(a, (imgUse.get(a) ?? 0) + 1);
    }
    if (e.type === 'text') fontUse.set(e.font ?? '', (fontUse.get(e.font ?? '') ?? 0) + 1);
  });
  const families = new Set(p.fonts.map((f) => f.family));
  const swapFont = (from: string, to: string) =>
    p.onSpec({ ...p.spec, elements: mapEls(p.spec.elements, (e) => (e.type === 'text' && (e.font ?? '') === from ? { ...e, font: to || undefined } : e)) });
  const unused = aliases.filter(([a]) => !imgUse.get(a));

  return (
    <div class="props">
      <h4>그림</h4>
      <p class="hint">
        이미지 요소는 그림을 <b>별명</b>(그림 옆 이름)으로 불러요. 여기서 별명이 가리키는 그림을 바꾸면(교체), 그 별명을 쓰는 이미지가 모두 한꺼번에 바뀌어요. 이미지 요소에서
        그림을 고를 때는 여기에 불러온 것만 나와요. 에셋 메뉴의 그림을 아래 <b>+ 에셋 불러오기</b>로 먼저 불러와요.
      </p>
      {aliases.map(([a, n], i) => {
        const asset = p.assets.find((x) => x.name === n);
        const used = imgUse.get(a) ?? 0;
        return (
          <div class="asset-use" key={a}>
            {asset ? <Thumb asset={asset} /> : <div class="thumb">없음</div>}
            <div class="asset-use-body">
              <div class="row tight">
                <code class="alias">{a}</code>
                <button
                  class="ghost small danger"
                  title="불러온 에셋 빼기 (에셋 메뉴의 파일은 그대로)"
                  onClick={() => (!used || confirm(`이미지 ${used}개가 "${a}"를 써요. 빼면 그 자리가 비어요. 뺄까요?`)) && setAliases(aliases.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
              <select value={n} onChange={(e) => setAliases(aliases.map((x, j) => (j === i ? [x[0], e.currentTarget.value] : x)))}>
                {!asset && <option value={n}>{n} (없음)</option>}
                <AssetOptions assets={p.assets} />
              </select>
              <small class={used ? 'used' : 'used none'}>{used ? `이미지 ${used}개가 써요` : '쓰는 이미지 없음'}</small>
            </div>
          </div>
        );
      })}
      {!aliases.length && <p class="empty small">아직 불러온 그림이 없어요. 아래 "+ 에셋 불러오기"에서 골라요.</p>}
      <div class="row">
        <select value="" onChange={(e) => e.currentTarget.value && p.onAddAlias(e.currentTarget.value)}>
          <option value="">+ 에셋 불러오기</option>
          <AssetOptions assets={p.assets.filter((x) => !aliases.some(([, n]) => n === x.name))} />
        </select>
        {unused.length > 0 && (
          <button class="small" onClick={() => setAliases(aliases.filter(([a]) => imgUse.get(a)))}>
            안 쓰는 그림 {unused.length}개 빼기
          </button>
        )}
      </div>

      <h4>폰트</h4>
      <p class="hint">글자 요소가 쓰는 폰트예요. 오른쪽에서 다른 폰트를 고르면 그 폰트를 쓰던 글자가 모두 바뀌어요. 폰트 파일은 폰트 메뉴에서 올려요.</p>
      {[...fontUse.entries()].map(([f, count]) => (
        <div class="font-use" key={f || '-'}>
          <span>
            <b>{f || `기본 폰트${p.defaultFamily ? ` (${p.defaultFamily})` : ''}`}</b>
            {f && !families.has(f) && <small class="warn-text"> 없음 → 기본으로 그려요</small>}
            <small class="used"> 글자 {count}개</small>
          </span>
          <FontSelect value={f} onChange={(to) => to !== f && swapFont(f, to)} fonts={p.fonts} settings={p.settings} />
        </div>
      ))}
      {!fontUse.size && <p class="empty small">글자 요소가 없어요.</p>}
    </div>
  );
}
