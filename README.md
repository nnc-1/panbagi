# 판박이 (panbagi)

주소에 값을 넣으면 그 값으로 그림을 조립해 이미지 한 장(WebP/PNG)으로 돌려주는 Cloudflare Worker예요.
캐릭터 챗봇의 상태창, 카드, 만화 컷처럼 "틀은 같고 값만 바뀌는" 그림을 만들 때 써요.

```
https://내주소/채팅/템플릿.webp?name=도키&hp=72
```

템플릿은 브라우저 관리 화면에서 만들고 고쳐요. 요소를 SVG로 겹친 뒤 resvg(WASM)로 평면화해 R2에 잠깐 저장하고, 같은 값이면 저장본을 다시 써요.
한 설치는 한 사람의 것이고, 각자 자기 Cloudflare 계정(무료 플랜 가능)에 설치해요.

## 설치 (5분, 코드 몰라도 돼요)

**준비물**: Cloudflare 계정(무료), GitHub 계정. 둘 다 없으면 먼저 만들어 두세요.

설치하면서 세 곳을 오가요. 단계마다 어디서 하는지 맨 앞에 적어 뒀어요.

| 표시 | 어디 | 주소 |
|---|---|---|
| 🟠 **Cloudflare** | Cloudflare 대시보드 | <https://dash.cloudflare.com> |
| ⚫ **GitHub** | GitHub 웹사이트 | <https://github.com> |
| 🟢 **관리 화면** | 설치한 판박이의 관리 화면 | `https://내주소/admin` |
| 💻 **내 컴퓨터** | 설치.bat으로 설치할 때만 | 내려받은 폴더 |

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nnc-1/panbagi)

1. ⚫ **GitHub** (지금 보고 있는 이 페이지): 위 **Deploy to Cloudflare** 버튼을 눌러요.
   → 🟠 **Cloudflare** 로그인 화면으로 넘어가요. 로그인해요.
2. 🟠 **Cloudflare** "애플리케이션 설정" 화면에서
   - **Git 계정**: "새로운 GitHub 연결"을 눌러요. → ⚫ **GitHub** 창이 열리면 **Install / Authorize(허용)** 를 누르고, → 🟠 **Cloudflare** 화면으로 돌아와요.
     이 코드의 사본이 내 GitHub에 새 저장소로 만들어져요(이 저장소를 나중에 5단계에서 써요).
   - **개인 Git 리포지토리 생성**: 체크하면 사본이 비공개가 돼요(추천).
   - **프로젝트 이름**: 그대로 `panbagi`로 둬도 돼요. Worker 이름이에요.
   - **D1 데이터베이스**, **R2 버킷**: "신규 생성" 그대로 둬요.
   - **ADMIN_TOKEN**: 관리 화면 비밀번호예요. **16자 이상**으로 남이 짐작하기 어렵게 넣고, 따로 적어 둬요.
   - 빌드·배포 명령 칸은 손대지 않아요.
3. 🟠 **Cloudflare**: **배포**를 누르고 1~3분 기다려요. 끝나면 `https://panbagi.○○○.workers.dev` 같은 임시 주소가 나와요(`○○○`는 내 계정 이름).
4. 🟠 **Cloudflare** <https://dash.cloudflare.com> → 왼쪽 메뉴 **Workers & Pages → panbagi → Settings → Domains & Routes → Add → Custom Domain**에 `svg.내도메인.com`처럼 넣어요.
   DNS 기록과 인증서는 Cloudflare가 자동으로 만들어요. 도메인은 같은 Cloudflare 계정에 있어야 하고, 몇 분 뒤부터 열려요.
5. ⚫ **GitHub** <https://github.com> → 오른쪽 위 내 프로필 → **Your repositories** → 2단계에서 만들어진 **내 사본 저장소** → `wrangler.jsonc` 파일 → 연필(✏️ Edit) 버튼.
   `"workers_dev": true` 를 `"workers_dev": false` 로 바꾸고 **Commit changes**를 눌러요.
   1~2분 뒤 🟠 Cloudflare가 자동으로 다시 배포하면서 임시 주소(`workers.dev`)가 꺼져요. 이미지 주소에 계정 이름이 드러나지 않게 하는 단계예요.
   (4단계 주소가 열리는 걸 확인한 다음에 해요. 🟠 Cloudflare 화면에서만 끄면 다음 배포 때 다시 켜져요.)
6. 🟢 **관리 화면**: 브라우저 주소창에 `https://svg.내도메인.com/admin`을 넣어 열고, ADMIN_TOKEN으로 들어가요.
7. 🟢 **관리 화면**: 처음 한 번 **"한글 폰트와 샘플 넣기"** 를 눌러요. 한글 폰트와 샘플 템플릿이 들어가요.

> 도메인이 없으면 4~5단계를 건너뛰고 임시 주소(`https://panbagi.○○○.workers.dev/admin`)로 써도 돼요.

### 꼭 적어 둘 것

| 무엇 | 어디서 보나 | 왜 필요한가 |
|---|---|---|
| **ADMIN_TOKEN** (관리 토큰) | 2단계 🟠 Cloudflare 화면에서 직접 넣은 값. **다시 볼 수 없어요** | 🟢 관리 화면에 들어갈 때 |
| **내 주소** | 4단계 🟠 Cloudflare에서 붙인 내 도메인 (도메인이 없으면 3단계의 임시 주소) | 이미지 주소와 관리 화면 주소의 앞부분 |
| **관리 화면 주소** | `내 주소/admin` (주소를 바꿨다면 바꾼 주소) | 🟢 템플릿을 만들고 고칠 때 |
| **내 사본 저장소** | ⚫ GitHub → Your repositories (2단계에서 만들어진 것) | 설정을 바꾸거나 업데이트할 때 |

ADMIN_TOKEN을 잊어버렸으면 🟠 Cloudflare 대시보드 **Workers & Pages → (내 Worker) → Settings → Variables and Secrets**에서 ADMIN_TOKEN을 새 값으로 바꾸면 돼요.

### GitHub이 없거나 Windows에서 설치하고 싶다면

⚫ **GitHub**(이 페이지)의 **Code → Download ZIP**으로 받아 💻 **내 컴퓨터**에 풀고 `설치.bat`을 더블클릭해요. 로그인할 때만 🟠 Cloudflare 창이 열려요. 계정에 있는 도메인 목록에서 번호를 고르면 `svg.내도메인.com` 같은 주소로 설치되고(DNS 자동), 나중에 같은 파일로 업데이트도 돼요.

자세한 안내: [docs/설치.md](docs/설치.md) · 관리 화면 쓰는 법: [docs/관리-화면.md](docs/관리-화면.md) · 무료 플랜 CPU 재기: [docs/배포와-측정.md](docs/배포와-측정.md)

## 관리 화면 (`/admin`)

같은 Worker의 정적 파일(Workers Static Assets, `public/admin/`)입니다. 주소를 바꿀 수 있게 Worker가 받아서 `ASSETS`로 넘기는데, 파일을 읽어 넘기기만 해서 CPU는 거의 안 씁니다. `ADMIN_TOKEN`으로 들어가고, 토큰은 그 브라우저의 localStorage에만 둡니다.

주소는 secret `ADMIN_PATH`로 바꿉니다(`npx wrangler secret put ADMIN_PATH`, 영문·숫자·`-`·`_` 64자까지, `admin`/`api`는 안 됨). 정하면 그 주소에서만 열리고 `/admin`은 404입니다. 안 정하거나 값이 맞지 않으면 `/admin`. 주소를 숨기는 것은 덧붙인 가림일 뿐이고, 막는 것은 여전히 토큰입니다. 같은 이름의 채팅이 있으면 그 채팅 이미지 주소가 가려지니 겹치지 않게 정하세요.

- 채팅·템플릿 목록, 템플릿 편집기(레이어 순서·그룹, 캔버스에서 끌어 옮기기/크기, 속성 패널, 값 바인딩 `switch`/`steps`, 보이는 조건, 파라미터 정의, JSON, 버전 되돌리기), 에셋·폰트 관리
- **미리보기는 브라우저가 그립니다.** 서버와 같은 `composeSvg`를 돌려 만든 SVG를 shadow DOM에 넣어 그리고(에셋 SVG의 `<style>`이 화면에 새지 않게), 폰트는 FontFace로 올립니다. 한 번 더 막기 위해 스크립트·이벤트 속성·외부 링크를 지운 뒤 넣습니다. 실제 PNG는 "서버로 렌더"(`POST /api/admin/preview`)로만 만듭니다.
- 주소·마크다운·챗봇 안내문 복사. 안내문은 파라미터 정의(`desc` 포함)로 만듭니다.
- **zip 번들 내보내기/가져오기도 브라우저에서** 합니다(`bundle.json` + `assets/` + 선택 `fonts/`). 템플릿은 에셋을 별명→이름으로 부르므로, 가져올 때 이름이 겹치는 다른 에셋은 `-2` 등으로 새로 올리고 템플릿의 이름을 바꿔 씁니다.
- 소스는 `ui/`(Preact + TypeScript). `wrangler dev`/`wrangler deploy`가 `npm run build:ui`로 `public/admin/app.js`를 만들고 함께 올립니다(빌드 결과는 저장소에 넣지 않음).
- 요소에 `name`(레이어 이름), 파라미터에 `desc`(설명)를 둘 수 있습니다. 엔진은 무시합니다.

## 주소

```
GET /{chat}/{template}.webp?값들       # 기본(관리 화면이 복사해 주는 주소). 무손실이라 PNG와 픽셀이 같고 파일은 40~60% 작음
GET /{chat}/{template}.png?값들        # PNG도 계속 됨(인코딩 CPU가 가장 적음)
GET /{chat}/{template}.jpg?값들        # JPG: 기본 꺼짐(ENABLE_JPG=true로 켬). 투명 → 템플릿 배경색 위에 깔림
GET /{chat}/{template}@3.webp?값들     # 특정 게시 버전 고정(선택)
```

- 값은 템플릿의 `params` 정의에 있는 키만 받습니다. 모르는 키는 버리고, 빠지면 기본값, 범위를 넘으면 잘라 씁니다(별칭 `alias` 지원).
- 저장 키 = `SHA-256(chat/template@버전 + 정규화한 값 + 형식)`. 값 순서·잡음이 달라도 같은 그림이면 같은 저장본입니다.
- 흐름: 엣지 캐시 → R2 `renders/` → 없으면 렌더 후 응답, R2 저장은 `waitUntil`로 응답 뒤에 합니다.
- 응답 헤더 `Cache-Control: public, max-age=<저장본 남은 수명>`. 사용자 캐시가 저장본보다 오래 남지 않습니다.

## 저장본 수명

`RENDER_TTL_HOURS`(기본 **6**, 1~24). 만든 시점 기준이고, 매시 정각 Cron Trigger가 지난 `renders/`를 지웁니다.
Cron이 돌기 전에 만료된 저장본은 읽을 때 무시하고 다시 렌더합니다. R2 Lifecycle 규칙(1일)은 안전망이고 설치기가 걸어 줍니다.
(`npx wrangler r2 bucket lifecycle add <버킷> expire-renders renders/ --expire-days 1`)

## 설정 (`vars`: 설치기로 설치했으면 `wrangler.local.jsonc`, 버튼이면 내 저장소의 `wrangler.jsonc`)

| 이름 | 기본 | 설명 |
|---|---|---|
| `RENDER_TTL_HOURS` | 6 | 저장본 수명(1~24시간) |
| `RENDER_SCALE` | 1 | 모든 템플릿의 `canvas.scale`에 곱함(0.25~2). **무료 플랜에서 CPU가 모자라면 0.75, 0.5로 낮춤.** 값이 바뀌면 저장 키도 바뀌어 새로 그려짐 |
| `MAX_PIXELS` | 2048 | 출력 긴 변 상한 |
| `ENABLE_JPG` | false | JPG는 순수 JS 인코더라 PNG보다 100ms 이상 더 걸려 기본으로 끔 |
| `ADMIN_TOKEN` | (비밀값) | 16자 이상. 없거나 짧으면 관리 API는 닫힘(503) |

**남용 방지**: `wrangler.jsonc`에 속도 제한(IP당 새 렌더 분당 30회)이 기본으로 들어 있습니다. 저장본을 돌려주는 요청은 세지 않습니다.
응답 헤더 `Server-Timing`에 새로 그린 시간이 나오지만, Workers의 시계는 입출력 때만 움직여서 CPU 시간은 `wrangler tail --format json`의 `cpuTime`으로 봐야 정확합니다.

## 무료 플랜에서 쓰기

무료 플랜은 요청당 CPU 10ms입니다. **처음 그릴 때만** CPU를 쓰고, 저장본을 돌려주는 요청은 거의 쓰지 않습니다.
로컬 Node 측정(Cloudflare 실제 값과 몇 배 차이 나진 않지만 같지는 않음)으로 새 렌더 래스터화 시간은 대략 이렇습니다.

| 템플릿 | 크기 | 시간 |
|---|---|---|
| `lite` (아이콘 없음, 요소 10개 안팎) | 400×140 | 약 6ms |
| `hud` (아이콘 여러 개, 반복 포함) | 520px (`RENDER_SCALE=0.5`) | 약 20ms |
| `hud` | 1040px | 약 40ms |

**WebP와 PNG 비교** (같은 그림, 로컬 Node, 인코딩만 잰 시간. 위 표의 래스터화 시간에 더해져요):

| 템플릿 | PNG | WebP 무손실(기본 설정) | 참고: WebP 손실 q90 |
|---|---|---|---|
| `lite` 400×140 | 5.3KB · 3ms | 1.8KB · 2ms | 3.4KB · 10ms |
| `hud` 1040×500 | 40.5KB · 11ms | 16.3KB · 32ms | 19.5KB · 71ms |

WebP 무손실은 디코드했을 때 PNG와 픽셀이 완전히 같아서(직접 비교함) 글자 선명도 차이가 없어요. 손실 압축은 이런 카드에서는 더 크고 더 느려서 쓰지 않아요.
큰 카드에서는 WebP가 처음 그릴 때 CPU를 20ms쯤 더 써요. 한 번 그린 그림은 저장본으로 나가서 다시 인코딩하지 않아요. 무료 플랜에서 CPU가 빠듯하면 주소를 `.png`로 쓰면 돼요.

그래서 무료 플랜에서는 `lite`처럼 가볍게 만들거나 `RENDER_SCALE`을 낮추고, 정 안 되면 유료($5/월)로 바꾸는 순서를 권합니다.
실제 Cloudflare에서의 값은 [배포와 측정 안내](docs/배포와-측정.md)대로 재 주세요.
성능 팁: SVG 아이콘은 본문에 직접 끼워 넣어(`<svg>` 중첩) 그립니다. 그림 파일(PNG 등)이나 요소를 줄일수록, 크기가 작을수록 빠릅니다.

## 템플릿 규칙 (spec)

`samples/hud.json`(무거운 예시: 프로필·게이지·파티 반복·의뢰, `scripts/build-hud.mjs`로 생성)과 `samples/lite.json`(가벼운 예시)이 있습니다. 구성은 `canvas`, `params`, `assets`(별칭 → 에셋 이름), `elements`.

| 요소 | 설명 |
|---|---|
| `shape` | `rect`(둥근 모서리 `radius`)·`ellipse`·`line`, 색/그래디언트(`{gradient:[a,b],dir}`)/테두리 |
| `image` | 에셋 배치, `fit`: contain·cover·stretch |
| `text` | `{param}` 치환, 필터 `{n|comma}` `{t|or:없음}` `{t|upper}` `{hp|pct:maxhp}`(hp÷maxhp를 0~100%로, 인자는 파라미터 이름이나 숫자, 기본 100), 폰트·굵기·정렬·`maxWidth`(넘치면 글자 크기를 줄임, 폭은 추정치)·`fit`(`w`를 넘칠 때 `"shrink"` 실제 폰트 글자 폭으로 줄이기, `minSize`까지 줄여도 넘치면 잘라냄 / `"clip"` 넘친 부분 숨기기) |
| `bar` | 값/최대 비율 게이지, 가로·세로 |
| `repeat` | `count`만큼 `dx,dy`씩 옮겨 반복. 자식 문자열의 `$i`는 1부터 시작하는 번호(`{a$i}` → `{a1}`) |
| `group` | 자식 묶음(이동·표시 조건·투명도) |

모든 요소는 절대 좌표 `x,y(,w,h)`와 선택 `when`·`opacity`·`rotate`를 가집니다.
값 연결은 `{치환}`, 수치 연결(`value`), 조건·분기(`when`, `switch`, `steps`)만 지원하고 코드 실행은 없습니다.
`when`: `{param, eq|ne|lt|lte|gt|gte|in}` 과 `and`/`or`/`not`.
`switch`: `{switch:"param", cases:{...}, default}` · `steps`: `{steps:"param", stops:[{gte,value}], default}` — 어떤 속성에도 쓸 수 있습니다.

한계: 한 줄 글자만(줄바꿈 없음), 애니메이션 없음, 그림자·필터 효과 없음. 캔버스 최대 4096, 출력 긴 변은 `MAX_PIXELS`(기본 2048)로 제한.

## 관리 API (`x-admin-token: <ADMIN_TOKEN>`)

| | |
|---|---|
| `GET /api/admin/assets` · `PUT /api/admin/assets/:name` · `GET …/:name/raw` · `DELETE …/:name` | 에셋 목록·올리기(본문 = svg/png/webp/jpeg, ≤5MB, SVG는 스크립트·외부 참조 제거)·원본·삭제. 이름에 폴더 한 단계를 둘 수 있어요(`던전/coin.svg`, 주소에서는 `%2F`) |
| `POST /api/admin/assets/:name/move` `{"to": "새/이름.svg"}` | 에셋 이름 바꾸기(폴더 옮기기). 그 에셋을 쓰는 템플릿의 초안과 게시 버전이 같이 바뀌어요 |
| `GET /api/admin/fonts` · `PUT /api/admin/fonts/:family?weight=400&license=` · `GET …/:id/raw` · `DELETE …/:id` | 폰트(TTF/OTF). 가장 가까운 굵기를 골라 씀 |
| `GET /api/admin/settings` · `PUT /api/admin/settings/default_font` | 설정(본문 = 기본 폰트 이름) |
| `GET /api/admin/chats` | 채팅과 그 템플릿 목록 |
| `PUT /api/admin/chats/:chat` · `DELETE /api/admin/chats/:chat` | `{name, description}` / 채팅과 템플릿 모두 삭제 |
| `GET /api/admin/templates` | 모든 템플릿의 초안(에셋 사용처 표시용) |
| `GET /api/admin/chats/:chat/templates/:tpl` | 초안, 게시 버전, 버전 목록 |
| `PUT /api/admin/chats/:chat/templates/:tpl?name=` | 본문 = spec JSON(초안 저장, 검증함) |
| `POST …/:tpl/publish` | 새 버전 게시(고정, 이후 변경 불가) |
| `GET …/:tpl/versions/:v` · `POST …/:tpl/rollback {version}` | 게시본 보기 / 주소가 쓸 게시 버전을 예전 것으로 되돌림 |
| `DELETE /api/admin/chats/:chat/templates/:tpl` | 템플릿과 버전 삭제 |
| `POST /api/admin/preview` | `{spec 또는 chat+template, values, format}` → 이미지(저장 안 함) |
| `POST /api/admin/purge` | 만료분 즉시 삭제 |

`ADMIN_TOKEN`이 없으면 관리 API는 503입니다.

## 로컬에서 해 보기

```bash
npm install
printf 'ADMIN_TOKEN=local-dev-token-1234\n' > .dev.vars
npm run migrate:local
npm run dev -- --port 8787               # 다른 터미널에서:
BASE_URL=http://localhost:8787 ADMIN_TOKEN=local-dev-token-1234 node scripts/seed.mjs
# → http://localhost:8787/demo/lite.webp?name=도키&hp=72
# → 관리 화면: http://localhost:8787/admin/ (토큰 local-dev-token-1234)
```

Cloudflare 없이 PNG만 보려면: `TEMPLATE=lite npm run render:sample -- out.png "hp=72&name=도키" fonts/NotoSansKR-400.ttf`

## 폰트

`npm run font:subset`은 Noto Sans KR(OFL)에서 ASCII, KS X 1001 한글 2350자, 자모(ㅋㅋ), 흔한 기호와 샘플에 쓰인 글자만 남긴 약 0.5MB 폰트를 만듭니다.
받아 둔 폰트를 쓰려면 `npm run font:subset -- 보통체.ttf 굵은체.ttf`. 2350자에 없는 한글(드문 글자)은 빈칸이 될 수 있으니,
사용자 이름에 드문 글자가 필요하면 전체 폰트를 `PUT /api/admin/fonts`로 직접 올리세요(CPU는 크게 늘지 않지만 R2 읽기와 메모리가 늘어요).
폰트가 이미지 안에 들어가므로 라이선스가 그것을 허용하는지 확인하세요(Noto Sans KR은 OFL).

## 설치기와 설정 파일

- 저장소의 `wrangler.jsonc`에는 계정 값(`database_id`, `account_id`, 도메인)이 없습니다. D1 `database_id`가 없으면 Wrangler와 Deploy 버튼이 데이터베이스를 만들어 연결합니다. 비밀값은 어떤 파일에도 쓰지 않습니다.
- **Deploy 버튼**: R2·D1을 만들고, `npm run deploy`(`d1 migrations apply DB --remote && wrangler deploy`)로 표를 만든 뒤 올립니다. `ADMIN_TOKEN`은 `.dev.vars.example`과 `package.json`의 `cloudflare.bindings` 설명으로 입력칸이 생깁니다.
- **`설치.bat` / `npm run setup`** (`scripts/setup.mjs`): 로그인 → R2 버킷(+ `renders/` 1일 수명 규칙) → D1 → 이 계정용 `wrangler.local.jsonc`(git 제외) → 마이그레이션 → 배포(늘 `-c wrangler.local.jsonc`) → secret `ADMIN_TOKEN`(없을 때만 새로 만들어 화면에 한 번 표시)·`ADMIN_PATH`(선택) → 처음 설치면 폰트와 샘플(`seed.mjs`). 이미 있는 것은 건너뛰어서 같은 명령이 업데이트입니다. `vars`는 업데이트해도 남깁니다. 예전 이름(`svg-engine`/`svg-store`/`svg-meta`)으로 설치한 계정은 찾아서 그대로 업데이트합니다.
- 도메인을 넣으면 Custom Domain(`routes` + `custom_domain`)으로 붙고 `workers_dev`는 꺼집니다. 도메인은 같은 Cloudflare 계정의 것이어야 하고 인증서는 몇 분~20분 걸립니다.
- 첫 실행용 파일은 `public/_seed/`에 있습니다: Noto Sans KR 부분 폰트(KS X 1001 한글 2350자 등, `npm run font:subset`으로 다시 만듦, SIL OFL 1.1, `OFL.txt`)와 샘플 아이콘. 관리 화면의 "한글 폰트와 샘플 넣기"와 `seed.mjs`가 이것을 올립니다.

## 보안

- 관리 API는 `x-admin-token` 헤더(16자 이상, 상수 시간 비교)로만 열립니다. 쿠키를 쓰지 않아 다른 사이트가 대신 요청하게 만들 수 없습니다. 틀린 토큰은 방문자(IP)당 분당 30번을 넘으면 1분 동안 429로 막습니다.
- 관리 화면은 `Content-Security-Policy`(자기 스크립트만, 외부 연결 없음, 프레임 금지), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`로 나갑니다. 토큰은 그 브라우저의 localStorage에만 있습니다.
- 올린 SVG 에셋은 서버에서 스크립트·이벤트 속성·외부 참조를 지우고, 미리보기는 브라우저에서 한 번 더 지운 뒤 그립니다. 공개 이미지는 래스터(WebP/PNG/JPG)로만 나갑니다.
- 공개 주소의 새 렌더는 IP당 분당 30회로 제한됩니다(저장본은 제외).

## 알려진 한계

- 에셋이나 폰트를 같은 이름으로 다시 올려도 이미 만든 그림은 수명(최대 6시간)까지 옛 모양으로 나갑니다.
- 같은 값을 동시에 처음 요청하면 각각 따로 그립니다.
- `repeat`은 `opacity`·`rotate`를 무시하고, `group` 회전의 기준점은 그룹의 x, y입니다. 다른 요소는 자기 가운데를 기준으로 돌아요(폭이 없는 글자는 추정한 글자 폭의 가운데).
- 관리 화면의 미리보기는 브라우저 글꼴 엔진으로 그려서 글자 위치가 resvg와 1~2px 다를 수 있습니다(정확한 결과는 "서버로 렌더").
- 캔버스에서 고른 요소의 상자는 어림값입니다(글자 폭, 반복의 첫 번째 복사본 기준).
- 같은 관리 화면을 두 탭에서 동시에 고치면 나중에 저장한 쪽이 이깁니다.
- 템플릿 검증은 구조만 봅니다(요소 속성 타입은 보지 않음).
- 본문 값은 요청마다 새 그림을 만들 수 있어 속도 제한으로만 막습니다.

## 테스트

`npm test` — 값 정규화, 합성(SVG 인라인 포함), PNG/JPG 평면화, SVG 정화, 설정, 관리 인증, 수명 삭제, 관리 화면의 레이어 이동·파라미터 이름 바꾸기·상자 계산·zip 왕복. `npm run typecheck`(Worker와 `ui/` 둘 다).
관리 화면 전체 흐름(채팅·템플릿 만들기, 끌어 옮기기, 에셋 올리기, 게시 후 공개 주소 PNG, 서버 렌더, 버전 되돌리기, zip 내보내기→가져오기)은 `wrangler dev` + 헤드리스 Chromium으로 확인했고, 자동 테스트로 넣지는 않았습니다.
Worker 전체 흐름(저장본 재사용, 속도 제한 429, JPG 404)은 `wrangler dev`로 확인했고 자동 테스트는 아직 없습니다.

## 라이선스

MIT ([LICENSE](LICENSE)). `public/_seed/fonts/`의 폰트(Noto Sans KR 부분 폰트)는 SIL Open Font License 1.1을 따릅니다.
