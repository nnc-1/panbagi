import { useEffect, useMemo, useState } from 'preact/hooks';
import { kb, send, type Font } from '../api';
import { DRAG_TYPE, FONT_FOLDER_KEY, FolderBar, MoveDialog, byFolder, fontFolderOf, type FolderPick } from '../folders';
import { loadFont } from '../preview';
import { fail, toast, useData } from '../ui';

const SAMPLE = '다람쥐 헌 쳇바퀴에 타고파 ABC 123 ㅋㅋ';

function FontRow(p: { f: Font; isDefault: boolean; onDefault: () => void; onDelete: () => void; onMove: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadFont(p.f).then(setReady);
  }, [p.f.id]);
  return (
    <tr draggable onDragStart={(e) => e.dataTransfer?.setData(DRAG_TYPE, p.f.family)}>
      <td>
        <b>{p.f.family}</b> {p.isDefault && <span class="badge ok">기본</span>}
        <br />
        <small>
          굵기 {p.f.weight}
          {p.f.style === 'italic' ? ' 기울임' : ''} · {kb(p.f.bytes)}
          {p.f.license_note && ` · ${p.f.license_note}`}
        </small>
      </td>
      <td class="sample" style={{ fontFamily: `"${p.f.family}"`, fontWeight: p.f.weight, opacity: ready ? 1 : 0.3 }}>
        {SAMPLE}
      </td>
      <td class="row end">
        {!p.isDefault && <button onClick={p.onDefault}>기본으로</button>}
        <button onClick={p.onMove}>옮기기</button>
        <button class="danger" onClick={p.onDelete}>
          삭제
        </button>
      </td>
    </tr>
  );
}

export function FontsPage() {
  const { fonts, settings, reload } = useData();
  const [family, setFamily] = useState('');
  const [weight, setWeight] = useState('400');
  const [license, setLicense] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const def = settings.default_font ?? fonts[0]?.family;
  const [folder, setFolder] = useState<FolderPick>(null);
  const [moving, setMoving] = useState<string | null>(null); // family
  const families = useMemo(() => [...new Set(fonts.map((f) => f.family))], [fonts]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const fam of families) m.set(fontFolderOf(settings, fam), (m.get(fontFolderOf(settings, fam)) ?? 0) + 1);
    return m;
  }, [families, settings]);
  const shown = fonts.filter((f) => folder === null || fontFolderOf(settings, f.family) === folder);

  // a folder belongs to the family, so every weight of it moves together
  const setFolderOf = async (fam: string, to: string) => {
    if (fontFolderOf(settings, fam) === to) return;
    try {
      await send('PUT', `/settings/${encodeURIComponent(FONT_FOLDER_KEY(fam))}`, to, 'text/plain');
      reload(['settings']);
    } catch (e) {
      fail(e);
    }
  };
  const renameFolder = async (from: string, to: string) => {
    try {
      for (const fam of families.filter((x) => fontFolderOf(settings, x) === from))
        await send('PUT', `/settings/${encodeURIComponent(FONT_FOLDER_KEY(fam))}`, to, 'text/plain');
      toast(`폴더 이름을 ${to}(으)로 바꿨어요`);
    } catch (e) {
      fail(e);
    }
    reload(['settings']);
  };

  const upload = async (e: Event) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({ weight, license });
      await send('PUT', `/fonts/${encodeURIComponent(family.trim())}?${q}`, await file.arrayBuffer(), 'application/octet-stream');
      if (!fonts.length) await send('PUT', '/settings/default_font', family.trim(), 'text/plain');
      if (folder && !families.includes(family.trim())) await send('PUT', `/settings/${encodeURIComponent(FONT_FOLDER_KEY(family.trim()))}`, folder, 'text/plain');
      toast('폰트를 올렸어요');
      setFile(null);
      reload(['fonts', 'settings']);
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };
  const setDefault = async (fam: string) => {
    try {
      await send('PUT', '/settings/default_font', fam, 'text/plain');
      reload(['settings']);
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (f: Font) => {
    if (!confirm(`${f.family} ${f.weight}을 지울까요? 이 폰트를 쓰는 글자는 기본 폰트로 그려져요.`)) return;
    try {
      await send('DELETE', `/fonts/${f.id}`);
      reload(['fonts']);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <section class="page">
      <h2>폰트</h2>
      <p class="hint">
        이미지 안의 글자는 여기 올린 폰트로만 그려져요. 한글 폰트가 하나도 없으면 한글이 네모로 나와요. 무료 플랜에서는 <code>npm run font:subset</code>으로 만든 작은
        폰트(약 0.5MB)를 권해요. 폰트 이름이 템플릿에 없거나 틀리면 "기본" 폰트로 그려요.
      </p>
      <FolderBar counts={counts} total={families.length} current={folder} onPick={setFolder} onDropTo={(f, fam) => setFolderOf(fam, f)} onRename={renameFolder} />
      <table class="list">
        <tbody>
          {byFolder(shown, (f) => fontFolderOf(settings, f.family)).map(([f, list]) => [
            folder === null && [...counts.keys()].some((x) => x) && (
              <tr class="folder-head" key={'h-' + f}>
                <td colSpan={3}>{f ? `📁 ${f}` : '폴더 없음'}</td>
              </tr>
            ),
            ...list.map((x) => (
              <FontRow key={x.id} f={x} isDefault={x.family === def} onDefault={() => setDefault(x.family)} onDelete={() => remove(x)} onMove={() => setMoving(x.family)} />
            )),
          ])}
        </tbody>
      </table>
      {folder !== null && fonts.length > 0 && !shown.length && <p class="empty">이 폴더는 비어 있어요. 아래에서 올리면 이 폴더에 들어가요.</p>}
      {moving !== null && (
        <MoveDialog
          title={`${moving} 옮기기 (모든 굵기)`}
          folders={[...counts.keys()].filter((x) => x).sort((a, b) => a.localeCompare(b, 'ko'))}
          current={fontFolderOf(settings, moving)}
          onClose={() => setMoving(null)}
          onOk={(f) => (setMoving(null), setFolderOf(moving, f))}
        />
      )}
      {!fonts.length && <p class="empty">아직 폰트가 없어요.</p>}
      <h3>폰트 올리기{folder ? ` → 📁 ${folder}` : ''}</h3>
      <form class="form narrow" onSubmit={upload}>
        <label>
          파일 (TTF 또는 OTF)
          <input
            type="file"
            accept=".ttf,.otf"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0] ?? null;
              setFile(f);
              if (f && !family) setFamily(f.name.replace(/\.(ttf|otf)$/i, '').replace(/[-_](Regular|Bold|Medium|Light|\d00)$/i, ''));
              if (f && /bold|700/i.test(f.name)) setWeight('700');
            }}
          />
        </label>
        <label>
          폰트 이름 (템플릿에서 이 이름으로 골라요. 굵기만 다른 파일은 같은 이름으로)
          <input value={family} onInput={(e) => setFamily(e.currentTarget.value)} placeholder="Noto Sans KR" />
        </label>
        <label>
          굵기
          <select value={weight} onChange={(e) => setWeight(e.currentTarget.value)}>
            {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {w}
                {w === 400 ? ' (보통)' : w === 700 ? ' (굵게)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          라이선스 메모 (선택)
          <input value={license} onInput={(e) => setLicense(e.currentTarget.value)} placeholder="OFL" />
        </label>
        <button class="primary" disabled={busy || !file || !family.trim()}>
          {busy ? '올리는 중…' : '올리기'}
        </button>
      </form>
    </section>
  );
}
