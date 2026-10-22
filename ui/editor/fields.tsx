// Property inputs. A "bindable" value is either fixed or depends on a parameter (switch = per value, steps = by range).
import { useEffect, useState } from 'preact/hooks';
import type { Cond, ParamDef } from '../../src/spec';

export type Kind = 'number' | 'text' | 'color' | 'paint' | 'select';
type Params = Record<string, ParamDef>;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isSwitch = (v: unknown) => isObj(v) && 'switch' in v;
export const isSteps = (v: unknown) => isObj(v) && 'steps' in v;

export function NumInput(p: { value: unknown; onChange: (v: number | undefined) => void; placeholder?: string; step?: number; min?: number; max?: number }) {
  const [txt, setTxt] = useState(p.value === undefined ? '' : String(p.value));
  useEffect(() => {
    if (Number(txt) !== p.value || (p.value === undefined && txt !== '')) setTxt(p.value === undefined ? '' : String(p.value));
  }, [p.value]);
  return (
    <input
      type="number"
      step={p.step ?? 'any'}
      min={p.min}
      max={p.max}
      value={txt}
      placeholder={p.placeholder}
      onInput={(e) => {
        const t = e.currentTarget.value;
        setTxt(t);
        if (t === '') p.onChange(undefined);
        else if (Number.isFinite(Number(t))) p.onChange(Number(t));
      }}
    />
  );
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const toHex6 = (c: string) => (HEX6.test(c) ? c : /^#[0-9a-fA-F]{3}$/.test(c) ? '#' + [...c.slice(1)].map((x) => x + x).join('') : /^#[0-9a-fA-F]{8}$/.test(c) ? c.slice(0, 7) : '#000000');

export function ColorInput(p: { value: unknown; onChange: (v: string | undefined) => void; placeholder?: string }) {
  const v = typeof p.value === 'string' ? p.value : '';
  return (
    <span class="color">
      <input type="color" value={toHex6(v)} onInput={(e) => p.onChange(e.currentTarget.value)} />
      <input value={v} placeholder={p.placeholder ?? '#ffffff'} onInput={(e) => p.onChange(e.currentTarget.value || undefined)} />
    </span>
  );
}

export function PaintInput(p: { value: unknown; onChange: (v: unknown) => void }) {
  const g = isObj(p.value) && Array.isArray(p.value.gradient) ? (p.value as { gradient: [string, string]; dir?: 'v' | 'h' }) : null;
  return (
    <span class="paint">
      {g ? (
        <>
          <ColorInput value={g.gradient[0]} onChange={(c) => p.onChange({ ...g, gradient: [c ?? '#000', g.gradient[1]] })} />
          <ColorInput value={g.gradient[1]} onChange={(c) => p.onChange({ ...g, gradient: [g.gradient[0], c ?? '#000'] })} />
          <select value={g.dir ?? 'v'} onChange={(e) => p.onChange({ ...g, dir: e.currentTarget.value })}>
            <option value="v">위→아래</option>
            <option value="h">왼→오른</option>
          </select>
        </>
      ) : (
        <ColorInput value={p.value} onChange={p.onChange} />
      )}
      <label class="check small" title="두 색을 섞는 그라데이션">
        <input
          type="checkbox"
          checked={!!g}
          onChange={(e) => p.onChange(e.currentTarget.checked ? { gradient: [typeof p.value === 'string' ? p.value : '#ffffff', '#000000'], dir: 'v' } : (g?.gradient[0] ?? '#ffffff'))}
        />
        그라데이션
      </label>
    </span>
  );
}

function BaseInput(p: { kind: Kind; value: unknown; onChange: (v: any) => void; options?: [string, string][]; placeholder?: string }) {
  switch (p.kind) {
    case 'number':
      return <NumInput value={p.value} onChange={p.onChange} placeholder={p.placeholder} />;
    case 'color':
      return <ColorInput value={p.value} onChange={p.onChange} placeholder={p.placeholder} />;
    case 'paint':
      return <PaintInput value={p.value} onChange={p.onChange} />;
    case 'select':
      return (
        <select value={String(p.value ?? '')} onChange={(e) => p.onChange(e.currentTarget.value || undefined)}>
          {p.options!.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      );
    default:
      return <input value={p.value === undefined ? '' : String(p.value)} placeholder={p.placeholder} onInput={(e) => p.onChange(e.currentTarget.value)} />;
  }
}

/** A property that can be fixed or follow a parameter. */
export function BindField(p: { label: string; value: unknown; onChange: (v: unknown) => void; kind: Kind; params: Params; options?: [string, string][]; placeholder?: string; hint?: string }) {
  const v = p.value as any;
  const names = Object.keys(p.params);
  const numParams = names.filter((k) => p.params[k].type === 'number');
  const head = (
    <span class="lbl">
      {p.label}
      {p.hint && <small> {p.hint}</small>}
    </span>
  );
  if (isSwitch(v) || isSteps(v)) {
    const mode = isSwitch(v) ? 'switch' : 'steps';
    const param: string = v[mode];
    const def = p.params[param];
    const set = (patch: any) => p.onChange({ ...v, ...patch });
    const toMode = (m: string) => {
      if (m === 'fixed') return p.onChange(v.default);
      if (m === mode) return;
      if (m === 'steps') p.onChange({ steps: numParams[0] ?? '', stops: [], default: v.default });
      else p.onChange({ switch: names[0] ?? '', cases: {}, default: v.default });
    };
    return (
      <div class="field bind">
        {head}
        <div class="bind-head">
          <select value={mode} onChange={(e) => toMode(e.currentTarget.value)}>
            <option value="fixed">고정값</option>
            <option value="switch">값에 따라 고르기</option>
            <option value="steps">숫자 구간에 따라</option>
          </select>
          <select value={param} onChange={(e) => set({ [mode]: e.currentTarget.value })}>
            {(mode === 'steps' ? numParams : names).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        {mode === 'switch' && (
          <>
            {Object.entries<any>(v.cases ?? {}).map(([key, val]) => (
              <div class="bind-row" key={key}>
                <span>= {key}</span>
                <BaseInput kind={p.kind} value={val} options={p.options} onChange={(x) => set({ cases: { ...v.cases, [key]: x } })} />
                <button
                  class="ghost small"
                  onClick={() => {
                    const c = { ...v.cases };
                    delete c[key];
                    set({ cases: c });
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <AddCase
              suggestions={def?.type === 'enum' ? def.options : def?.type === 'bool' ? ['true', 'false'] : []}
              existing={Object.keys(v.cases ?? {})}
              onAdd={(k) => set({ cases: { ...v.cases, [k]: v.default } })}
            />
          </>
        )}
        {mode === 'steps' && (
          <>
            {(v.stops ?? []).map((s: any, i: number) => (
              <div class="bind-row" key={i}>
                <span>
                  <NumInput value={s.gte} onChange={(n) => set({ stops: v.stops.map((x: any, j: number) => (j === i ? { ...x, gte: n ?? 0 } : x)) })} /> 이상
                </span>
                <BaseInput kind={p.kind} value={s.value} options={p.options} onChange={(x) => set({ stops: v.stops.map((y: any, j: number) => (j === i ? { ...y, value: x } : y)) })} />
                <button class="ghost small" onClick={() => set({ stops: v.stops.filter((_: any, j: number) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <button class="small" onClick={() => set({ stops: [...(v.stops ?? []), { gte: 0, value: v.default }] })}>
              + 구간
            </button>
          </>
        )}
        <div class="bind-row">
          <span>그 밖</span>
          <BaseInput kind={p.kind} value={v.default} options={p.options} onChange={(x) => set({ default: x })} />
        </div>
      </div>
    );
  }
  if (isObj(v) && p.kind !== 'paint') return <JsonField label={p.label} value={v} onChange={p.onChange} />;
  return (
    <div class="field">
      {head}
      <div class="with-btn">
        <BaseInput kind={p.kind} value={v} options={p.options} onChange={p.onChange} placeholder={p.placeholder} />
        {!!names.length && (
          <button class="ghost small" title="파라미터 값에 따라 바뀌게" onClick={() => p.onChange({ switch: names[0], cases: {}, default: v })}>
            값에 따라
          </button>
        )}
      </div>
    </div>
  );
}

function AddCase(p: { suggestions: string[]; existing: string[]; onAdd: (k: string) => void }) {
  const [k, setK] = useState('');
  const left = p.suggestions.filter((s) => !p.existing.includes(s));
  return (
    <div class="bind-row">
      <input list="case-sugg" value={k} placeholder="값 (예: HP)" onInput={(e) => setK(e.currentTarget.value)} />
      <datalist id="case-sugg">
        {left.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button class="small" disabled={!k || p.existing.includes(k)} onClick={() => (p.onAdd(k), setK(''))}>
        + 경우
      </button>
      {!!left.length && (
        <button class="small ghost" onClick={() => left.forEach(p.onAdd)}>
          모두 추가
        </button>
      )}
    </div>
  );
}

/** Number, or the name of a parameter (bar value/max, repeat count). */
export function NumOrParam(p: { label: string; value: unknown; onChange: (v: unknown) => void; params: Params; hint?: string }) {
  const nums = Object.keys(p.params).filter((k) => p.params[k].type === 'number');
  if (isObj(p.value)) return <BindField label={p.label} value={p.value} onChange={p.onChange} kind="number" params={p.params} />;
  const isParam = typeof p.value === 'string';
  return (
    <div class="field">
      <span class="lbl">
        {p.label}
        {p.hint && <small> {p.hint}</small>}
      </span>
      <div class="with-btn">
        <select value={isParam ? String(p.value) : ''} onChange={(e) => p.onChange(e.currentTarget.value || 0)}>
          <option value="">직접 입력</option>
          {nums.map((k) => (
            <option key={k} value={k}>
              파라미터 {k}
            </option>
          ))}
        </select>
        {!isParam && <NumInput value={p.value} onChange={(n) => p.onChange(n ?? 0)} />}
      </div>
    </div>
  );
}

export function JsonField(p: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [txt, setTxt] = useState(JSON.stringify(p.value, null, 1));
  const [err, setErr] = useState('');
  useEffect(() => setTxt(JSON.stringify(p.value, null, 1)), [JSON.stringify(p.value)]);
  return (
    <div class="field">
      <span class="lbl">{p.label} (JSON)</span>
      <textarea
        rows={4}
        class="mono"
        value={txt}
        onInput={(e) => {
          const t = e.currentTarget.value;
          setTxt(t);
          try {
            p.onChange(t.trim() ? JSON.parse(t) : undefined);
            setErr('');
          } catch {
            setErr('JSON 형식이 아니에요');
          }
        }}
      />
      {err && <small class="err">{err}</small>}
    </div>
  );
}

// ---- show-when conditions ----
const OPS: [string, string][] = [
  ['eq', '='],
  ['ne', '≠'],
  ['gt', '>'],
  ['gte', '≥'],
  ['lt', '<'],
  ['lte', '≤'],
  ['in', '중 하나'],
];
type Row = { param: string; op: string; value: string };

function toRows(c: Cond | undefined): { mode: 'and' | 'or'; rows: Row[] } | null {
  if (!c) return { mode: 'and', rows: [] };
  const one = (x: any): Row | null => {
    if (!isObj(x) || !('param' in x)) return null;
    const ops = OPS.map(([k]) => k).filter((k) => k in x);
    if (ops.length !== 1 || Object.keys(x).length !== 2) return null;
    const val = x[ops[0]];
    return { param: x.param, op: ops[0], value: Array.isArray(val) ? val.join(',') : String(val) };
  };
  if ('and' in c || 'or' in c) {
    const mode = 'and' in c ? 'and' : 'or';
    const rows = ((c as any)[mode] as any[]).map(one);
    return rows.every(Boolean) ? { mode, rows: rows as Row[] } : null;
  }
  const r = one(c);
  return r ? { mode: 'and', rows: [r] } : null;
}

function fromRows(mode: 'and' | 'or', rows: Row[], params: Params): Cond | undefined {
  const conds = rows.map((r) => {
    const numeric = params[r.param]?.type === 'number';
    const val = (s: string) => (numeric && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : s.trim());
    return { param: r.param, [r.op]: r.op === 'in' ? r.value.split(',').map(val) : r.op === 'eq' || r.op === 'ne' ? val(r.value) : Number(r.value) || 0 } as Cond;
  });
  if (!conds.length) return undefined;
  if (conds.length === 1) return conds[0];
  return mode === 'and' ? { and: conds } : { or: conds };
}

export function WhenField(p: { value: Cond | undefined; onChange: (c: Cond | undefined) => void; params: Params }) {
  const parsed = toRows(p.value);
  const names = Object.keys(p.params);
  if (!parsed) return <JsonField label="보이는 조건" value={p.value} onChange={(v) => p.onChange(v as Cond | undefined)} />;
  const { mode, rows } = parsed;
  const set = (m: 'and' | 'or', r: Row[]) => p.onChange(fromRows(m, r, p.params));
  return (
    <div class="field bind">
      <span class="lbl">
        보이는 조건 <small>{rows.length ? '' : '(항상 보임)'}</small>
      </span>
      {rows.length > 1 && (
        <select value={mode} onChange={(e) => set(e.currentTarget.value as 'and' | 'or', rows)}>
          <option value="and">모두 맞을 때</option>
          <option value="or">하나라도 맞을 때</option>
        </select>
      )}
      {rows.map((r, i) => {
        const upd = (patch: Partial<Row>) => set(mode, rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        const d = p.params[r.param];
        return (
          <div class="bind-row cond" key={i}>
            <select value={r.param} onChange={(e) => upd({ param: e.currentTarget.value })}>
              {names.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select value={r.op} onChange={(e) => upd({ op: e.currentTarget.value })}>
              {OPS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            {d?.type === 'enum' && r.op !== 'in' ? (
              <select value={r.value} onChange={(e) => upd({ value: e.currentTarget.value })}>
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : d?.type === 'bool' && r.op !== 'in' ? (
              <select value={r.value} onChange={(e) => upd({ value: e.currentTarget.value })}>
                <option value="true">참</option>
                <option value="false">거짓</option>
              </select>
            ) : (
              <input value={r.value} placeholder={r.op === 'in' ? 'a,b,c' : d?.type === 'text' ? '(빈칸)' : '0'} onInput={(e) => upd({ value: e.currentTarget.value })} />
            )}
            <button class="ghost small" onClick={() => set(mode, rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        );
      })}
      {!!names.length && (
        <button
          class="small"
          onClick={() => {
            const k = names[0];
            const d = p.params[k];
            set(mode, [...rows, { param: k, op: d.type === 'number' ? 'gt' : 'ne', value: d.type === 'number' ? '0' : d.type === 'bool' ? 'false' : '' }]);
          }}
        >
          + 조건
        </button>
      )}
    </div>
  );
}
