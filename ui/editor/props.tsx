import type { El, Spec } from '../../src/spec';
import type { Asset, Font } from '../api';
import { byFolder, fontFolderOf } from '../folders';
import { assetFile } from '../api';
import { TYPE_LABEL } from '../model';
import { BindField, NumInput, NumOrParam, PaintInput, WhenField, ColorInput } from './fields';

/** a bar's value/max as text: a param name stays a name, a number stays a number */
const ref = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '?');

const WEIGHTS: [string, string][] = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => [String(w), w === 400 ? '400 보통' : w === 700 ? '700 굵게' : String(w)]);

/** font family picker grouped by font folder; '' is the default font */
export function FontSelect(p: { value: string; onChange: (family: string) => void; fonts: Font[]; settings: Record<string, string> }) {
  const families = [...new Set(p.fonts.map((f) => f.family))];
  return (
    <select value={p.value} onChange={(ev) => p.onChange(ev.currentTarget.value)}>
      <option value="">기본 폰트</option>
      {byFolder(families, (f) => fontFolderOf(p.settings, f)).map(([folder, list]) => {
        const opts = list.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ));
        return folder ? (
          <optgroup key={folder} label={'📁 ' + folder}>
            {opts}
          </optgroup>
        ) : (
          opts
        );
      })}
      {p.value && !families.includes(p.value) && <option value={p.value}>{p.value} (없음 → 기본)</option>}
    </select>
  );
}

export function Props(p: {
  el: El;
  spec: Spec;
  fonts: Font[];
  assets: Asset[];
  settings: Record<string, string>;
  onChange: (patch: Record<string, unknown>) => void;
  onAddAlias: (assetName: string) => string;
  /** add a text element next to the selected one */
  onAddLabel?: (text: string) => void;
  /** line up with the canvas: left, center, right, top, middle, bottom */
  onAlign?: (k: 'l' | 'c' | 'r' | 't' | 'm' | 'b') => void;
  actions: { dup: () => void; del: () => void; up: () => void; down: () => void; wrap: () => void; unwrap?: () => void };
}) {
  const e: any = p.el;
  const params = p.spec.params;
  const set = (k: string) => (v: unknown) => p.onChange({ [k]: v });
  const B = (k: string, label: string, kind: 'number' | 'text' | 'color' | 'paint' | 'select', extra: Record<string, any> = {}) => (
    <BindField label={label} value={e[k]} onChange={set(k)} kind={kind} params={params} {...extra} />
  );
  const aliases = Object.entries(p.spec.assets ?? {});
  // one list for the image picker: assets this template already uses, then every other asset in the library
  const LIB = 'lib:';
  const used = new Set(aliases.map(([, n]) => n));
  const assetChoices: [string, string][] = [
    ['', '(없음)'],
    ...aliases.map(([a, n]) => [a, a === n || assetFile(n).replace(/\.[a-z0-9]+$/i, '') === a ? n : `${n} (${a})`] as [string, string]),
    ...p.assets.filter((x) => !used.has(x.name)).map((x) => [LIB + x.name, x.name] as [string, string]),
  ];
  // a library pick becomes an alias of this template (added on first use)
  const fromLibrary = (v: any): any => {
    if (typeof v === 'string') return v.startsWith(LIB) ? p.onAddAlias(v.slice(LIB.length)) : v;
    if (v && typeof v === 'object') {
      if ('cases' in v) return { ...v, cases: Object.fromEntries(Object.entries(v.cases).map(([k, x]) => [k, fromLibrary(x)])), default: fromLibrary(v.default) };
      if ('stops' in v) return { ...v, stops: v.stops.map((x: any) => ({ ...x, value: fromLibrary(x.value) })), default: fromLibrary(v.default) };
    }
    return v;
  };
  const hasSize = e.type !== 'group' && e.type !== 'repeat';

  return (
    <div class="props">
      <div class="props-head">
        <span class="badge">{TYPE_LABEL[e.type as El['type']]}</span>
        <input class="name" value={e.name ?? ''} placeholder="레이어 이름" onInput={(ev) => p.onChange({ name: ev.currentTarget.value || undefined })} />
      </div>
      <div class="row wrap tight">
        <button class="small" onClick={p.actions.up} title="앞으로 (위에 그리기)">
          앞으로
        </button>
        <button class="small" onClick={p.actions.down} title="뒤로">
          뒤로
        </button>
        <button class="small" onClick={p.actions.dup}>
          복제
        </button>
        <button class="small" onClick={p.actions.wrap}>
          그룹으로 묶기
        </button>
        {p.actions.unwrap && (
          <button class="small" onClick={p.actions.unwrap}>
            그룹 풀기
          </button>
        )}
        <button class="small danger" onClick={p.actions.del}>
          삭제
        </button>
      </div>

      <h4>위치{hasSize ? '와 크기' : ''}</h4>
      <div class="grid2">
        {B('x', 'x', 'number')}
        {B('y', 'y', 'number')}
        {hasSize && e.type !== 'text' && B('w', '너비 w', 'number')}
        {hasSize && e.type !== 'text' && B('h', '높이 h', 'number')}
        {e.type === 'text' && (
          <>
            <div class="field">
              <span class="lbl">너비 w</span>
              <NumInput value={e.w} onChange={set('w')} placeholder="자동" />
            </div>
            <div class="field">
              <span class="lbl">높이 h</span>
              <NumInput value={e.h} onChange={set('h')} placeholder="자동" />
            </div>
          </>
        )}
      </div>
      {p.onAlign && (
        <div class="field" title="캔버스에 맞춰 옮겨요 (지금 미리보기 값으로 그린 크기 기준)">
          <span class="lbl">캔버스에 맞추기</span>
          <div class="row wrap tight">
          {(
            [
              ['l', '⇤ 왼쪽'],
              ['c', '↔ 가운데'],
              ['r', '⇥ 오른쪽'],
              ['t', '⤒ 위'],
              ['m', '↕ 가운데'],
              ['b', '⤓ 아래'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} class="small" onClick={() => p.onAlign!(k)}>
              {l}
            </button>
          ))}
          </div>
        </div>
      )}
      {(e.type === 'group' || e.type === 'repeat') && <p class="hint">안에 든 요소의 좌표는 이 위치를 기준으로 해요.</p>}

      {e.type === 'text' && (
        <>
          <h4>글자</h4>
          <label class="check" title="너비(w)·높이(h) 박스 안에서 줄을 바꿔요">
            <input
              type="checkbox"
              checked={!!e.wrap}
              onChange={(ev) =>
                p.onChange(
                  ev.currentTarget.checked
                    ? { wrap: true, maxWidth: undefined, w: typeof e.w === 'number' ? e.w : 200, h: typeof e.h === 'number' ? e.h : 80 }
                    : { wrap: undefined, lineHeight: undefined, valign: undefined },
                )
              }
            />
            여러 줄 글상자 (박스 안에서 줄바꿈)
          </label>
          <BindField
            label="내용"
            value={e.text}
            onChange={set('text')}
            kind={e.wrap ? 'multiline' : 'text'}
            params={params}
            hint={e.wrap ? '{이름}으로 값 넣기, Enter나 \\n으로 줄바꿈' : '{이름}으로 값 넣기'}
          />
          <div class="chips">
            {Object.keys(params).map((k) => (
              <button key={k} class="chip" title={`{${k}} 넣기`} onClick={() => typeof e.text === 'string' && p.onChange({ text: e.text + `{${k}}` })}>
                {'{' + k + '}'}
              </button>
            ))}
          </div>
          <p class="hint">
            꾸밈: <code>{'{n|comma}'}</code> 천 단위 쉼표, <code>{'{hp|pct:maxhp}'}</code> 퍼센트(hp÷maxhp), <code>{'{t|or:없음}'}</code> 비었을 때 글자, <code>{'{t|upper}'}</code> 대문자, <code>{'{b|bool:예/아니오}'}</code>
          </p>
          <div class="grid2">
            <div class="field">
              <span class="lbl">폰트</span>
              <FontSelect value={e.font ?? ''} onChange={(f) => p.onChange({ font: f || undefined })} fonts={p.fonts} settings={p.settings} />
            </div>
            <div class="field">
              <span class="lbl">굵기</span>
              <select value={String(e.weight ?? 400)} onChange={(ev) => p.onChange({ weight: Number(ev.currentTarget.value) })}>
                {WEIGHTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {B('size', '글자 크기', 'number')}
            <div class="field">
              <span class="lbl">정렬</span>
              <select value={e.align ?? 'left'} onChange={(ev) => p.onChange({ align: ev.currentTarget.value === 'left' ? undefined : ev.currentTarget.value })}>
                <option value="left">왼쪽</option>
                <option value="center">가운데</option>
                <option value="right">오른쪽</option>
              </select>
            </div>
            <div class="field">
              <span class="lbl">자간</span>
              <NumInput value={e.letterSpacing} onChange={set('letterSpacing')} placeholder="0" />
            </div>
            {e.wrap ? (
              <>
                <div class="field">
                  <span class="lbl">줄 간격 (글자 크기의 배수)</span>
                  <NumInput value={e.lineHeight} onChange={set('lineHeight')} placeholder="1.3" step={0.1} min={0.5} max={4} />
                </div>
                <div class="field">
                  <span class="lbl">세로 정렬</span>
                  <select value={e.valign ?? 'top'} onChange={(ev) => p.onChange({ valign: ev.currentTarget.value === 'top' ? undefined : ev.currentTarget.value })}>
                    <option value="top">위</option>
                    <option value="middle">가운데</option>
                    <option value="bottom">아래</option>
                  </select>
                </div>
              </>
            ) : (
              <div class="field">
                <span class="lbl">최대 너비</span>
                <NumInput value={e.maxWidth} onChange={set('maxWidth')} placeholder="제한 없음" />
              </div>
            )}
          </div>
          <div class="grid2">
            <div class="field">
              <span class="lbl">{e.wrap ? '글자가 박스를 넘칠 때' : '글자가 너비(w)를 넘칠 때'}</span>
              <select value={e.fit ?? ''} onChange={(ev) => p.onChange({ fit: ev.currentTarget.value || undefined, minSize: ev.currentTarget.value === 'shrink' ? e.minSize : undefined })}>
                <option value="">그대로 두기</option>
                <option value="shrink">글자 줄이기</option>
                <option value="clip">넘친 부분 숨기기</option>
              </select>
            </div>
            {e.fit === 'shrink' && (
              <div class="field">
                <span class="lbl">가장 작은 크기</span>
                <NumInput value={e.minSize} onChange={set('minSize')} placeholder="1" min={1} />
              </div>
            )}
          </div>
          {e.wrap && typeof e.w !== 'number' && <p class="warn">위치와 크기의 너비(w)를 정해야 줄이 바뀌어요.</p>}
          {!e.wrap && e.fit && typeof e.w !== 'number' && !(e.maxWidth > 0) && <p class="warn">위치와 크기의 너비(w)를 정해야 동작해요.</p>}
          {e.wrap ? (
            <p class="hint">
              {e.fit === 'shrink'
                ? '줄이 높이(h) 안에 다 들어갈 때까지 글자를 줄여요. 가장 작은 크기까지 줄여도 넘치면 나머지는 숨겨요.'
                : e.fit === 'clip'
                  ? '글자 크기는 그대로 두고, 박스 밖으로 나간 줄은 안 보이게 해요.'
                  : '줄이 많으면 높이(h) 아래로 그대로 이어져요.'}{' '}
              줄은 띄어쓰기에서 바뀌고, 한 줄보다 긴 낱말만 글자 사이에서 끊어요. 높이(h)를 비우면 줄 수만큼 자라요.
            </p>
          ) : (
          <p class="hint">
            {e.fit === 'shrink'
              ? '실제 폰트의 글자 폭을 재서 너비(w)에 딱 맞게 글자를 줄여요. 가장 작은 크기까지 줄여도 넘치면 나머지는 숨겨요.'
              : e.fit === 'clip'
                ? '글자 크기는 그대로 두고, 너비(w) 밖으로 나간 부분만 안 보이게 해요.'
                : '글자가 길면 너비(w) 밖으로 그대로 삐져나가요. 위의 "최대 너비"를 적으면 글자 수로 어림잡아 줄여요(정확하지 않아요).'}{' '}
            여러 줄은 위의 "여러 줄 글상자"를 켜세요.
          </p>
          )}
          {B('fill', '글자 색', 'color', { placeholder: '#ffffff' })}
        </>
      )}

      {e.type === 'shape' && (
        <>
          <h4>도형</h4>
          <div class="field">
            <span class="lbl">모양</span>
            <select value={e.shape ?? 'rect'} onChange={(ev) => p.onChange({ shape: ev.currentTarget.value === 'rect' ? undefined : ev.currentTarget.value })}>
              <option value="rect">사각형</option>
              <option value="ellipse">원·타원</option>
              <option value="line">선 (x,y에서 x+w,y+h까지)</option>
            </select>
          </div>
          {(e.shape ?? 'rect') === 'rect' && (
            <div class="field">
              <span class="lbl">모서리 둥글기</span>
              <NumInput value={e.radius} onChange={set('radius')} placeholder="0" min={0} />
            </div>
          )}
          {e.shape !== 'line' && B('fill', '채우기', 'paint')}
          {B('stroke', '테두리 색', 'color', { placeholder: '없음' })}
          <div class="field">
            <span class="lbl">테두리 두께</span>
            <NumInput value={e.strokeWidth} onChange={set('strokeWidth')} placeholder="1" min={0} />
          </div>
        </>
      )}

      {e.type === 'image' && (
        <>
          <h4>이미지</h4>
          <BindField
            label="에셋"
            value={e.asset}
            onChange={(v) => p.onChange({ asset: fromLibrary(v) })}
            kind="select"
            params={params}
            options={assetChoices}
          />
          <p class="hint">
            에셋 메뉴의 그림 전체에서 바로 골라요. 처음 고른 그림은 <b>에셋</b> 탭에 별명으로 추가되고, 이 템플릿의 그림은 거기서 한꺼번에 바꾸거나 정리해요.
            "(없음)"을 고르면 그 경우엔 그림을 그리지 않아요.
            값마다 다른 그림을 쓰려면 <b>값에 따라</b>를 누르고 파라미터를 고른 뒤, <b>모두 추가</b>(또는 + 경우)로 줄을 만들어 줄마다 그림을 골라요. 맞는 줄이 없으면 "그 밖"의 그림이 나와요.
          </p>
          <div class="field">
            <span class="lbl">맞추기</span>
            <select value={e.fit ?? 'contain'} onChange={(ev) => p.onChange({ fit: ev.currentTarget.value })}>
              <option value="contain">안에 맞추기 (잘리지 않음)</option>
              <option value="cover">꽉 채우기 (넘치면 자름)</option>
              <option value="stretch">늘이기</option>
            </select>
          </div>
        </>
      )}

      {e.type === 'bar' && (
        <>
          <h4>게이지</h4>
          <NumOrParam label="현재 값 (얼마나 찼는지)" value={e.value} onChange={set('value')} params={params} />
          <NumOrParam label="최대값 (기준, 이 값이면 가득 참)" value={e.max ?? 100} onChange={set('max')} params={params} />
          <p class="hint">
            채움 = 현재 값 ÷ 최대값. 예: 현재 75, 최대 150이면 절반이 차요(0~100%로 잘림). 값이 이미 퍼센트로 들어오면 최대값을 100으로 두세요.
          </p>
          {p.onAddLabel && (
            <div class="row tight wrap">
              <button class="small" onClick={() => p.onAddLabel!(`{${ref(e.value)}|pct:${ref(e.max ?? 100)}}`)}>
                + 퍼센트 글자 (50%)
              </button>
              <button class="small" onClick={() => p.onAddLabel!(`{${ref(e.value)}}/{${ref(e.max ?? 100)}}`)}>
                + 값/최대 글자 (75/150)
              </button>
            </div>
          )}
          <div class="field">
            <span class="lbl">방향</span>
            <select value={e.vertical ? 'v' : 'h'} onChange={(ev) => p.onChange({ vertical: ev.currentTarget.value === 'v' || undefined })}>
              <option value="h">가로 (왼쪽부터)</option>
              <option value="v">세로 (아래부터)</option>
            </select>
          </div>
          <div class="field">
            <span class="lbl">모서리 둥글기</span>
            <NumInput value={e.radius} onChange={set('radius')} placeholder="0" min={0} />
          </div>
          {B('fill', '채움 색', 'paint')}
          <div class="field">
            <span class="lbl">바탕 색</span>
            <PaintInput value={e.track ?? '#000000'} onChange={set('track')} />
          </div>
        </>
      )}

      {e.type === 'repeat' && (
        <>
          <h4>반복</h4>
          <NumOrParam label="개수" value={e.count} onChange={set('count')} params={params} hint="(최대 64)" />
          <div class="grid2">
            <div class="field">
              <span class="lbl">가로 간격 dx</span>
              <NumInput value={e.dx} onChange={set('dx')} placeholder="0" />
            </div>
            <div class="field">
              <span class="lbl">세로 간격 dy</span>
              <NumInput value={e.dy} onChange={set('dy')} placeholder="0" />
            </div>
            <div class="field">
              <span class="lbl">최대 개수</span>
              <NumInput value={e.max} onChange={set('max')} placeholder="64" min={0} max={64} />
            </div>
          </div>
          <p class="hint">
            안쪽 요소의 글자·이름에 <code>$i</code>를 쓰면 1, 2, 3…으로 바뀌어요. 예: <code>{'{a$i}'}</code> → <code>{'{a1}'}</code>, <code>{'{a2}'}</code>
          </p>
        </>
      )}

      <h4>보이기</h4>
      <WhenField value={e.when} onChange={set('when')} params={params} />
      <div class="grid2">
        {B('opacity', '불투명도 (0~1)', 'number', { placeholder: '1' })}
        {e.type !== 'repeat' && B('rotate', '회전 (도)', 'number', { placeholder: '0' })}
      </div>
    </div>
  );
}

export function CanvasProps(p: { spec: Spec; onChange: (s: Spec) => void }) {
  const c = p.spec.canvas;
  const set = (patch: Partial<Spec['canvas']>) => p.onChange({ ...p.spec, canvas: { ...c, ...patch } });
  return (
    <div class="props">
      <h4>캔버스</h4>
      <div class="grid2">
        <div class="field">
          <span class="lbl">너비</span>
          <NumInput value={c.w} onChange={(v) => set({ w: Math.max(1, Math.min(4096, v ?? 1)) })} min={1} max={4096} />
        </div>
        <div class="field">
          <span class="lbl">높이</span>
          <NumInput value={c.h} onChange={(v) => set({ h: Math.max(1, Math.min(4096, v ?? 1)) })} min={1} max={4096} />
        </div>
        <div class="field">
          <span class="lbl">배율 (0.25~2)</span>
          <NumInput value={c.scale} onChange={(v) => set({ scale: v === undefined ? undefined : Math.max(0.25, Math.min(2, v)) })} placeholder="1" />
        </div>
      </div>
      <div class="field">
        <span class="lbl">배경색 (비우면 투명)</span>
        <ColorInput value={c.background} onChange={(v) => set({ background: v })} placeholder="투명" />
      </div>
      <p class="hint">배율을 낮추면 출력 그림이 작아지고 서버 CPU를 덜 써요. 좌표는 그대로예요.</p>
    </div>
  );
}
