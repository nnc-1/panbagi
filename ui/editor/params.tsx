import { useEffect, useState } from 'preact/hooks';
import { LIMITS, type ParamDef, type Spec } from '../../src/spec';
import type { Asset } from '../api';
import { AssetOptions } from '../folders';
import { renameParam, usesParam } from '../model';
import { NumInput } from './fields';

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const TYPE_LABEL = { text: '글자', number: '숫자', enum: '목록에서 하나', bool: '예/아니오', random: '무작위 (주사위)' } as const;

/** Comma-separated list, applied when the field loses focus. Keeps what was typed across re-renders until then. */
function ListInput(p: { value?: string[]; onChange: (v: string[]) => void }) {
  const joined = (p.value ?? []).join(', ');
  const [txt, setTxt] = useState(joined);
  useEffect(() => setTxt(joined), [joined]);
  return <input value={txt} onInput={(e) => setTxt(e.currentTarget.value)} onChange={(e) => p.onChange(e.currentTarget.value.split(',').map((s) => s.trim()).filter(Boolean))} />;
}

function ParamCard(p: { name: string; def: ParamDef; spec: Spec; onSpec: (s: Spec) => void }) {
  const d: any = p.def;
  const [nm, setNm] = useState(p.name);
  const set = (patch: Record<string, unknown>) => {
    const next: any = { ...d, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
    p.onSpec({ ...p.spec, params: { ...p.spec.params, [p.name]: next } });
  };
  const changeType = (t: string) => {
    const base: any = { type: t, alias: d.alias, desc: d.desc };
    if (t === 'enum') base.options = ['none', 'A', 'B'];
    if (t === 'number') Object.assign(base, { default: 0, min: 0, max: 100 });
    if (t === 'random') Object.assign(base, { min: 1, max: 6 });
    for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
    p.onSpec({ ...p.spec, params: { ...p.spec.params, [p.name]: base } });
  };
  const rename = () => {
    if (nm === p.name) return;
    if (!NAME.test(nm) || nm in p.spec.params) return setNm(p.name);
    p.onSpec(renameParam(p.spec, p.name, nm));
  };
  const remove = () => {
    if (usesParam(p.spec, p.name) && !confirm(`"${p.name}"을 쓰는 요소가 있어요. 지우면 그 자리는 비거나 기본값이 돼요. 지울까요?`)) return;
    const params = { ...p.spec.params };
    delete params[p.name];
    p.onSpec({ ...p.spec, params });
  };
  return (
    <div class="param">
      <div class="row">
        <input class="mono pname" value={nm} onInput={(e) => setNm(e.currentTarget.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && rename()} title="주소에 쓰는 이름 (영문)" />
        <select value={d.type} onChange={(e) => changeType(e.currentTarget.value)}>
          {Object.entries(TYPE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button class="ghost small danger" onClick={remove} title="삭제">
          ✕
        </button>
      </div>
      {nm !== p.name && !NAME.test(nm) && <small class="err">영문으로 시작하는 영문·숫자·_ 32자 이하</small>}
      <input value={d.desc ?? ''} placeholder="설명 (챗봇 안내문에 들어가요. 예: 던전 체력)" onInput={(e) => set({ desc: e.currentTarget.value })} />
      <div class="grid3">
        {d.type === 'number' && (
          <>
            <label>
              기본
              <NumInput value={d.default} onChange={(v) => set({ default: v })} />
            </label>
            <label>
              최소
              <NumInput value={d.min} onChange={(v) => set({ min: v })} />
            </label>
            <label>
              최대
              <NumInput value={d.max} onChange={(v) => set({ max: v })} />
            </label>
            <label>
              소수 자리
              <NumInput value={d.decimals} onChange={(v) => set({ decimals: v })} min={0} max={6} step={1} />
            </label>
          </>
        )}
        {d.type === 'text' && (
          <>
            <label class="span2">
              기본
              <input value={d.default ?? ''} onInput={(e) => set({ default: e.currentTarget.value })} />
            </label>
            <label>
              최대 글자수
              <NumInput value={d.maxLength} onChange={(v) => set({ maxLength: v })} placeholder={String(LIMITS.textLength)} min={1} max={LIMITS.maxTextLength} step={1} />
            </label>
          </>
        )}
        {d.type === 'enum' && (
          <>
            <label class="span2">
              고를 수 있는 값 (쉼표로 구분)
              <ListInput value={d.options} onChange={(options) => set({ options })} />
            </label>
            <label>
              기본
              <select value={d.default ?? d.options?.[0]} onChange={(e) => set({ default: e.currentTarget.value })}>
                {(d.options ?? []).map((o: string) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {d.type === 'random' && (
          <>
            <label class="span2">
              굴리는 방식
              <select value={d.options ? 'list' : 'range'} onChange={(e) => set(e.currentTarget.value === 'list' ? { options: ['a', 'b', 'c'], min: undefined, max: undefined } : { options: undefined, min: 1, max: 6 })}>
                <option value="range">숫자 범위 (주사위)</option>
                <option value="list">목록에서 하나 뽑기</option>
              </select>
            </label>
            {d.options ? (
              <label class="span2">
                뽑을 값 (쉼표로 구분)
                <ListInput value={d.options} onChange={(options) => options.length && set({ options })} />
              </label>
            ) : (
              <>
                <label>
                  최소
                  <NumInput value={d.min} onChange={(v) => set({ min: v })} step={1} />
                </label>
                <label>
                  최대
                  <NumInput value={d.max} onChange={(v) => set({ max: v })} step={1} />
                </label>
              </>
            )}
          </>
        )}
        {d.type === 'bool' && (
          <label class="check">
            <input type="checkbox" checked={!!d.default} onChange={(e) => set({ default: e.currentTarget.checked || undefined })} />
            기본으로 켜기
          </label>
        )}
      </div>
      {d.type === 'random' && (
        <p class="hint">
          챗봇이 보내는 값이 아니라 판박이가 굴려요. 주소의 다른 값으로 굴려서 같은 주소는 늘 같은 결과이고, 값이 하나라도 바뀌면 새로 굴려요. 매 턴 새로 굴리려면 턴 번호 같은 숫자 파라미터를 하나 두세요.
          글자에 <code>{'{' + p.name + '}'}</code>로 넣거나, 이미지·색의 "값에 따라"에서 골라 써요.
        </p>
      )}
      {d.type !== 'random' && (
      <label>
        다른 이름 (쉼표로 구분, 챗봇이 이렇게 써도 알아들어요)
        <ListInput value={d.alias} onChange={(alias) => set({ alias })} />
      </label>
      )}
    </div>
  );
}

export function ParamsPanel(p: { spec: Spec; onSpec: (s: Spec) => void; assets: Asset[] }) {
  const [newName, setNewName] = useState('');
  const add = () => {
    if (!NAME.test(newName) || newName in p.spec.params) return;
    p.onSpec({ ...p.spec, params: { ...p.spec.params, [newName]: { type: 'number', default: 0, min: 0, max: 100 } } });
    setNewName('');
  };
  const aliases = Object.entries(p.spec.assets ?? {});
  const setAliases = (list: [string, string][]) => {
    const assets = Object.fromEntries(list);
    const s: Spec = { ...p.spec, assets };
    if (!list.length) delete s.assets;
    p.onSpec(s);
  };
  return (
    <div class="props">
      <h4>파라미터 (주소로 받는 값)</h4>
      <p class="hint">챗봇이 주소 뒤에 <code>?hp=72&amp;name=도키</code>처럼 붙이는 값이에요. 빠지거나 이상한 값은 기본값으로, 범위를 넘으면 잘라서 그려요.</p>
      {Object.entries(p.spec.params).map(([k, d]) => (
        <ParamCard key={k} name={k} def={d} spec={p.spec} onSpec={p.onSpec} />
      ))}
      <div class="row">
        <input class="mono" placeholder="새 이름 (예: hp)" value={newName} onInput={(e) => setNewName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button class="primary small" disabled={!NAME.test(newName) || newName in p.spec.params} onClick={add}>
          + 파라미터
        </button>
      </div>

      <h4>이 템플릿이 쓰는 에셋</h4>
      <p class="hint">템플릿은 에셋을 별명으로 불러요. 별명을 그대로 두고 에셋만 바꾸면 모든 이미지 요소가 따라 바뀌어요.</p>
      {aliases.map(([a, n], i) => (
        <div class="row" key={i}>
          <code class="alias">{a}</code>
          <span>→</span>
          <select value={n} onChange={(e) => setAliases(aliases.map((x, j) => (j === i ? [x[0], e.currentTarget.value] : x)))}>
            {!p.assets.some((x) => x.name === n) && <option value={n}>{n} (없음)</option>}
            <AssetOptions assets={p.assets} />
          </select>
          <button class="ghost small danger" onClick={() => setAliases(aliases.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      {!aliases.length && <p class="empty small">아직 없어요. 이미지 요소의 "라이브러리에서 고르기"로 추가돼요.</p>}
    </div>
  );
}
