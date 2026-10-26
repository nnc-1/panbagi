import { useState } from 'preact/hooks';
import { HASH_KEY, HASH_MAX, normalizeParams } from '../../src/params';
import { LIMITS, type Spec } from '../../src/spec';
import { call, copy } from '../api';
import { defaultsOf } from '../model';
import { Modal, fail, toast } from '../ui';

/** templates with a random param also take `hash=1..10000` in the address, mixed into every roll */
export const takesHash = (spec: Spec) => !(HASH_KEY in spec.params) && Object.values(spec.params).some((d) => d.type === 'random');

/** Encode only what would break a query value; Korean stays readable for people and chatbots. */
export const enc = (s: string) => s.replace(/[\s%&#?+=\/\\"'<>()[\]]/g, (c) => encodeURIComponent(c).replace(/[()'[\]]/g, (x) => '%' + x.charCodeAt(0).toString(16).toUpperCase()));

export function imageUrl(chat: string, slug: string, spec: Spec, values: Record<string, string>, onlyChanged = true) {
  const { values: norm } = normalizeParams(spec, values);
  const defs = normalizeParams(spec, {}).values;
  const q = Object.entries(norm)
    .filter(([k]) => spec.params[k]?.type !== 'random') // rolled by the server, not sent
    .filter(([k, v]) => !onlyChanged || v !== defs[k])
    .map(([k, v]) => `${k}=${enc(typeof v === 'boolean' ? (v ? '1' : '0') : String(v))}`)
    .join('&');
  const h = Math.round(Number(values[HASH_KEY]));
  const hq = takesHash(spec) && h >= 1 && h <= HASH_MAX ? `${HASH_KEY}=${h}` : '';
  const all = [q, hq].filter(Boolean).join('&');
  return `${location.origin}/${chat}/${slug}.webp${all ? '?' + all : ''}`;
}

/** Chatbot instructions generated from the parameter definitions. */
export function promptSnippet(chat: string, slug: string, name: string, spec: Spec, values: Record<string, string>) {
  const base = `${location.origin}/${chat}/${slug}.webp`;
  const sent = Object.entries(spec.params).filter(([, d]) => d.type !== 'random');
  const lines = sent.map(([k, d]) => {
    const desc = d.desc ? `${d.desc}. ` : '';
    let what = '';
    if (d.type === 'number') what = `숫자${d.min !== undefined || d.max !== undefined ? ` ${d.min ?? ''}~${d.max ?? ''}` : ''}${d.decimals ? ` (소수 ${d.decimals}자리)` : ''}`;
    else if (d.type === 'text') what = `글자, 최대 ${Math.min(d.maxLength ?? LIMITS.textLength, LIMITS.maxTextLength)}자`;
    else if (d.type === 'enum') what = `${d.options.join(', ')} 중 하나`;
    else what = '1(예) 또는 0(아니오)';
    return `- ${k}: ${desc}${what}`;
  });
  const example = imageUrl(chat, slug, spec, values, false);
  return [
    `[${name} 이미지]`,
    `매 답변 끝에 현재 상태를 아래 형식의 이미지 한 줄로 출력하세요. 주소는 바꾸지 말고 ? 뒤의 값만 채웁니다.`,
    `![](${base}?${[...sent.map(([k]) => `${k}=값`), ...(takesHash(spec) ? [`${HASH_KEY}=숫자`] : [])].join('&')})`,
    ...lines,
    ...(takesHash(spec) ? [`- ${HASH_KEY}: 1~${HASH_MAX} 사이 아무 숫자. 매 답변마다 다른 숫자를 넣으세요(주사위를 새로 굴려요). 결과는 이미지가 정하니 미리 짐작해서 쓰지 마세요.`] : []),
    `값을 모르면 그 항목은 빼도 됩니다(기본값으로 그려짐). 글자 값의 공백은 %20으로 씁니다.`,
    `예시: ![](${example})`,
  ].join('\n');
}

function ValueInput(p: { name: string; def: any; value: string; onChange: (v: string) => void }) {
  const d = p.def;
  if (d.type === 'number')
    return (
      <span class="with-btn">
        {d.min !== undefined && d.max !== undefined && d.max - d.min <= 100000 && (
          <input type="range" min={d.min} max={d.max} step={d.decimals ? 10 ** -d.decimals : 1} value={p.value} onInput={(e) => p.onChange(e.currentTarget.value)} />
        )}
        <input type="number" class="num" value={p.value} onInput={(e) => p.onChange(e.currentTarget.value)} />
      </span>
    );
  if (d.type === 'enum')
    return (
      <select value={p.value} onChange={(e) => p.onChange(e.currentTarget.value)}>
        {d.options.map((o: string) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (d.type === 'bool') return <input type="checkbox" checked={p.value === '1'} onChange={(e) => p.onChange(e.currentTarget.checked ? '1' : '0')} />;
  return <input value={p.value} maxLength={Math.min(d.maxLength ?? LIMITS.textLength, LIMITS.maxTextLength)} onInput={(e) => p.onChange(e.currentTarget.value)} />;
}

export function PreviewPanel(p: {
  chat: string;
  slug: string;
  name: string;
  spec: Spec;
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
  published: boolean;
  draftDiffers: boolean;
}) {
  const [server, setServer] = useState<{ url: string; ms: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const url = imageUrl(p.chat, p.slug, p.spec, p.values);
  const rolled = normalizeParams(p.spec, p.values).values;
  const renderServer = async () => {
    setBusy(true);
    try {
      const t = performance.now();
      const r = await call('POST', '/preview', { spec: p.spec, values: p.values });
      const b = await r.blob();
      setServer({ url: URL.createObjectURL(b), ms: performance.now() - t, bytes: b.size });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const c = (text: string, what: string) => (copy(text), toast(`${what}을 복사했어요`));
  return (
    <div class="props">
      <h4>미리보기 값</h4>
      <p class="hint">여기서 바꾼 값은 가운데 그림에 바로 보여요. 서버를 쓰지 않아요.</p>
      {Object.entries(p.spec.params).map(([k, d]) =>
        d.type === 'random' ? (
          <div class="value" key={k}>
            <span class="mono">
              {k}
              <small> 무작위{d.desc ? ' · ' + d.desc : ''}</small>
            </span>
            <span>
              <b>{String(rolled[k])}</b> <small class="hint">다른 값이 바뀌면 새로 굴려요</small>
            </span>
          </div>
        ) : (
        <label class="value" key={k}>
          <span class="mono">
            {k}
            {d.desc && <small> {d.desc}</small>}
          </span>
          <ValueInput name={k} def={d} value={p.values[k] ?? ''} onChange={(v) => p.setValues({ ...p.values, [k]: v })} />
        </label>
        ),
      )}
      {takesHash(p.spec) && (
        <label class="value">
          <span class="mono">
            {HASH_KEY}
            <small> 1~{HASH_MAX}, 바꾸면 새로 굴려요</small>
          </span>
          <span class="with-btn">
            <input type="number" class="num" min={1} max={HASH_MAX} value={p.values[HASH_KEY] ?? ''} placeholder="없음" onInput={(e) => p.setValues({ ...p.values, [HASH_KEY]: e.currentTarget.value })} />
            <button class="small" onClick={() => p.setValues({ ...p.values, [HASH_KEY]: String(1 + Math.floor(Math.random() * HASH_MAX)) })}>
              🎲 굴리기
            </button>
          </span>
        </label>
      )}
      <button class="small" onClick={() => p.setValues(defaultsOf(p.spec))}>
        기본값으로
      </button>

      <h4>주소</h4>
      {!p.published && <p class="warn">아직 게시하지 않아서 이 주소는 지금 열리지 않아요. 위의 "게시"를 누르세요.</p>}
      {p.published && p.draftDiffers && <p class="warn">게시하지 않은 변경이 있어요. 주소는 게시한 버전으로 그려져요.</p>}
      <textarea class="mono url" rows={3} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      <div class="row wrap tight">
        <button class="small" onClick={() => c(url, '이미지 주소')}>
          주소 복사
        </button>
        <button class="small" onClick={() => c(`![](${url})`, '마크다운')}>
          마크다운 복사
        </button>
        <button class="small" onClick={() => c(promptSnippet(p.chat, p.slug, p.name, p.spec, p.values), '챗봇 안내문')}>
          챗봇 안내문 복사
        </button>
        {p.published && (
          <a class="btn small" href={url} target="_blank" rel="noopener">
            새 탭에서 열기
          </a>
        )}
      </div>
      <p class="hint">"챗봇 안내문"은 캐릭터 설정에 붙여 넣는 글이에요. 파라미터 설명을 채우면 챗봇이 더 정확하게 써요.</p>

      <h4>실제 결과 확인</h4>
      <p class="hint">브라우저 미리보기는 글자 위치가 실제와 1~2px 다를 수 있어요. 서버 렌더는 실제 PNG를 만들어요(저장 안 함). 무료 플랜 CPU를 쓰니 가끔만 누르세요.</p>
      <button class="small" onClick={renderServer} disabled={busy}>
        {busy ? '그리는 중…' : '서버로 렌더'}
      </button>
      {server && (
        <Modal title="서버 렌더 결과" onClose={() => setServer(null)} wide>
          <div class="server-shot">
            <img src={server.url} alt="서버 렌더" />
          </div>
          <p class="hint">
            {Math.round(server.bytes / 1000)}KB · 왕복 {Math.round(server.ms)}ms (네트워크 포함, CPU 시간이 아니에요)
          </p>
        </Modal>
      )}
    </div>
  );
}
