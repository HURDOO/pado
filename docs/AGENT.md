# Antigravity 원본 TUI 연결

공개 배포는 [PUBLIC_DEPLOY.md](PUBLIC_DEPLOY.md)의 별도 실행 제한을 따른다. 아래 subagent·파일 도구 설명은 기본 로컬 모드 기준이다. 공개 모드의 기본 입력은 프롬프트 form이지만, 이번 동아리 해커톤은 `PADO_PARTICIPANT_TUI=1`로 발언자/작업 요청자의 원본 TUI 입력을 허용한다. credential-free 앱 실행 helper와 네트워크 격리는 유지한다.

## 현재 실행 경로 — Native TUI

사용자 정정에 따라 Agent pane의 커스텀 채팅과 stream-json 렌더링을 원본 `agy` 대화형 터미널로 교체했다. 아래 과거 headless 검증 기록은 새 TUI 검증과 구분한다. 현재 경로에서 headless fallback은 없다.

- Docker `create -it` → `start --attach --interactive`로 프로젝트마다 한 개의 PTY와 CLI 프로세스를 유지한다. 관리자 지정 참여 프로젝트만 입력을 받으며 다른 프로젝트의 살아 있는 TUI는 읽기 전용이다. 브라우저는 xterm.js, 서버는 headless xterm + serialized snapshot으로 화면과 커서·대체 버퍼를 복원한다. PTY 크기 변경용 Docker socket은 서버만 사용하며 컨테이너에 마운트하지 않는다.
- `/api/tui/events`는 인증된 터미널 스트림이며 재접속 시 전체 화면을 보낸다. `/api/tui/input`, `/api/tui/resize`는 현재 발언자·작업 요청자 또는 관리자만 허용한다. 관객은 읽기 전용이다. `/api/prompt`는 실제 모드에서 거부한다.
- 발언자가 보는 화면 크기에 맞춰 공유 PTY를 조절하며 관객은 같은 열·행 수를 축소하거나 스크롤해서 본다. 모바일에는 Esc, Tab, 방향키, 줄바꿈, Enter 보조 키가 있다. 한글은 xterm의 원래 IME 처리 경로를 사용한다.
- native `PreInvocation` hook이 작업을 시작하고 presentation 사용 지침을 주입한다. `Stop`의 `fullyIdle`이 참일 때만 발언권을 다음 참가자에게 열어 준다. 자식 conversation의 종료로 부모 turn을 끝내지 않는다. 원본 TUI의 도구 승인과 Esc 취소도 그대로 사용한다.
- 자식 conversation의 호출은 별도 Subagent pane으로 표시한다. 작업 중·응답 완료·실행 종료·오류를 구분하고, 종료 3초 뒤 서버가 pane을 제거한다. 재개하면 닫힘을 취소하며 종료만으로 성공을 주장하지 않는다. 내부 conversation ID 대신 일반 이름과 서버 생성 pane ID를 사용한다. 일반 File/Terminal 생성 규칙은 그대로다. 변경된 hook을 사용하려면 agent Docker 이미지를 다시 빌드하고 새 TUI 세션을 시작해야 한다.
- 실제 CLI는 자식에 부모 hook을 상속하지 않아 부모의 `PostToolUse`와 invocation/Stop hook에서 자식 생성 메타와 최종 응답 상태도 확인한다. 관측은 컨테이너 내부의 고정 brain 경로로 제한하고 원시 transcript·경로·프롬프트를 bridge에 복사하지 않는다. 자식의 중간 메시지는 완료 근거가 아니며, 다음 부모 hook에서 완료를 확인한 시점부터 3초를 센다. 알 수 없는 형식은 무시하고 부모 종료 시 남은 pane을 종료 처리한다.
- 기존 전용 인증 volume은 읽기 전용 `/auth`로 연결한다. 로그인 토큰과 사용자가 이미 완료한 onboarding 상태만 세션 전용 tmpfs 프로필로 복사한다. 설정 파일은 해당 임시 프로필에서 원자적으로 저장 가능하다. 원본 인증 설정을 덮어쓰거나 host 인증을 복사하지 않는다. 세션을 종료하면 이 임시 프로필과 대화 맥락은 사라진다. 인증 만료 시 `pnpm agent:login`으로 전용 로그인을 갱신한다.
- 관리자 중단은 실제 컨테이너 종료를 확인한다. 다음 손들기 또는 초기화로 새 원본 TUI를 시작한다. 초기화해도 workspace 파일은 삭제하지 않는다. 단순 resize나 관객 재접속은 중단된 프로세스를 다시 실행하지 않는다.

**이 TUI는 로그인 계정 표시, 작업 내용, 승인 화면까지 참가자에게 공유한다.** 비밀번호·API 키를 입력하지 않으며 신뢰된 LAN/WireGuard 사용자에게만 열어 둔다. 원본 도구 출력과 subagent 화면이 보이지만 이것만으로 별도 File/Terminal pane을 만들지는 않는다. 공개 프롬프트용 credential·egress 격리는 별도 미완료 사항이다. OSC clipboard·링크 실행은 비활성화했고 Docker client stderr는 공유하지 않는다.

공식 자료: [CLI reference](https://antigravity.google/docs/cli/reference/), [Lifecycle hooks](https://antigravity.google/docs/hooks), [xterm.js](https://github.com/xtermjs/xterm.js).

## 이전 headless 구현에서 확인한 내용 (이력)

2026-09-18: host와 새 Docker 이미지의 `agy --version`은 모두 1.2.6입니다. `pado-agent:local` 빌드와 격리된 컨테이너 실행, 실제 UTF-8 stdout/stderr → presentation event 및 input 답변 수신 smoke test를 통과했습니다. 인증 없는 컨테이너에서 headless 요청을 실행하니 Google 인증이 필요했고, 해당 확인용 컨테이너는 중지했습니다. host의 Keychain이나 `.gemini` 인증은 복사하지 않았습니다.

이후 사용자가 전용 환경에 로그인했고, `pnpm agent:check`가 실제 모델의 `PADO_READY` 응답을 확인했습니다. 실제 브라우저에서 파일 생성, Input 답변, 명령 출력, 모바일 동기화, 대화 맥락 재개를 통과했습니다. 별도 실제 subagent 위임도 확인했고 Agent 영역의 진행 표시를 데스크톱·모바일에서 검증했습니다.

초기 검증에서는 CLI의 도구 권한 soft-denial이 `SUCCESS`와 exit 0을 반환했습니다. Pado는 이 경우 성공으로 처리하지 않습니다. `agent/settings.json`은 각 작업 컨테이너에 읽기 전용으로 마운트하며 `/workspace` 읽기·쓰기, 현재 turn의 `/bridge` 읽기, helper 읽기, `node /opt/pado/present.mjs` 명령만 허용합니다. 기존 인증 volume의 설정 파일은 변경하지 않습니다. 전체 도구 승인 우회 옵션은 사용하지 않습니다. 이 CLI 규칙은 OS 보안 경계나 credential 격리를 대신하지 않으며 공개 프롬프트용 안전성은 아직 완료되지 않았습니다.

## 전용 인증 준비

```sh
docker build -f agent/Dockerfile -t pado-agent:local .
pnpm agent:login
```

사용자의 터미널에서 실행하고, 출력되는 Google 로그인 절차를 직접 완료합니다. 해커톤 데모 전용 계정을 권장합니다. 로그인 스크립트는 전용 `pado-agent-auth` volume을 사용하며, 기존 컨테이너가 Pado 로그인용인지 확인한 뒤 재사용합니다. host 인증 정보는 복사하지 않습니다. 인증 코드나 토큰은 채팅·저장소에 기록하지 않습니다.

로그인 후 `pnpm agent:check`로 headless 연결을 확인합니다. 인증이 있으면 짧은 모델 요청 한 번을 실행하며, 인증이 없으면 공개 가능한 오류만 출력합니다. 이 확인은 실제 파일 수정이나 presentation 흐름의 검증을 대신하지 않습니다.

`pnpm test:agent`는 인증과 도구 권한이 준비된 뒤 실행하는 실제 AI 브라우저 검증입니다. 기본 작업 파일과 분리된 `.pado/live/<실행 ID>/workspace`를 사용하며 결과는 보존합니다. 서버의 `PADO_DATA_DIR` 설정은 테스트 데이터 경로를 분리하는 용도이며, 일반 실행에서는 `.pado`를 사용합니다.

인증 후 `.env`에서 `PADO_RUNNER=antigravity`를 설정하고 Pado를 재시작합니다. `PADO_AGENT_IMAGE` 기본값은 `pado-agent:local`입니다. `--mode accept-edits`를 사용하며 전역 도구 승인 우회 옵션은 사용하지 않습니다. 실제 작업에서 CLI 도구 권한 승인이 막히는 경우 전용 환경에서 필요한 최소 규칙을 정한 뒤 검증해야 합니다.

## Presentation bridge

에이전트는 사용자 요청을 받으면 `/workspace`에서 작업합니다. 현재는 CLI 파일/도구 진행 화면 자체가 원본 TUI 안에 보이지만 별도 pane을 자동으로 생성하지 않습니다. 사용자에게 별도 화면을 펼칠 때만 다음 도구를 사용합니다.

```sh
node /opt/pado/present.mjs '{"type":"pane.upsert","pane":{"id":"plan","kind":"docs","title":"작업 계획","content":"# 계획\n\n사용자가 확인할 내용"}}'
node /opt/pado/present.mjs run checks node --test
node /opt/pado/present.mjs '{"type":"pane.close","id":"plan"}'
```

HTML처럼 따옴표가 많은 내용은 내장 파일 도구로 `/workspace/event.json`을 만든 뒤 `node /opt/pado/present.mjs --file /workspace/event.json`으로 공개합니다. 파일 인자는 작업 폴더 안의 크기가 제한된 일반 파일만 읽습니다. inline JSON 인자와 달리 shell quoting 때문에 HTML JavaScript가 변형되지 않습니다.

허용 presentation 이벤트는 `pane.upsert`, `pane.show`, `pane.close`, `pane.focus`, `pane.resize`, `agent.message`입니다. 일반 pane kind는 `docs`, `tasks`, `file`, `input`, `browser`, `review`이며 Agent 대화 pane은 항상 존재합니다. Terminal 생성·본문·종료 상태는 서버의 실제 프로세스 콜백만 갱신합니다. 에이전트/관리자의 Terminal upsert 및 terminal 이벤트는 거부합니다. `exec`/`serve`는 `ID-logs`, `run`은 지정한 ID로 로그를 만듭니다. 세 명령 모두 인증 없는 앱 컨테이너를 사용합니다. 기존 출력은 `pane.show`로 복원하며 출처 메타데이터가 없는 과거 Terminal은 복원하지 않습니다. ID는 영문·숫자·하이픈·언더스코어 1~64자(실행 helper ID는 1~48자)입니다. 입력 요청마다 고유 ID를 사용합니다.

Input HTML은 `window.pado.submit({ key: 'value' })`로 답변을 전달합니다. 에이전트는 `node /opt/pado/present.mjs wait PANE_ID`로 답변을 기다립니다. 답변 원문은 SSE snapshot에 넣지 않습니다. File pane은 공개된 텍스트의 읽기 전용 표현이며 host 파일 접근 API가 아닙니다.

입력 HTML 실행 오류는 요청자/관리자의 브라우저에서만 검증된 오류 경로로 전달합니다. bridge의 비공개 오류 파일을 `wait`가 감지하면 에이전트가 HTML을 수정하고 다시 공개할 수 있습니다. 전송 계층은 오류 원문이나 입력 답변을 public snapshot에 추가하지 않지만, 에이전트가 이후 공개 응답에 내용을 요약·인용할 수 있습니다. 따라서 생성 HTML에는 비밀번호나 API 키를 입력하지 않습니다. 실행에 필요한 키는 별도 [시크릿 Input](SECRETS.md)으로 요청하며, 같은 `wait`가 값 대신 변수 이름과 설정 여부만 반환합니다.

Browser pane은 [실제 앱 서버](LIVE_APPS.md)와 기존 단일 HTML을 모두 지원합니다. `server: {port, path}`는 인증 없는 앱 컨테이너의 HTTP/WS 서버에 분리된 origin으로 연결하며 React/Vite/Node와 서버 저장을 지원합니다. `content`만 있는 HTML 미리보기는 기존처럼 opaque origin, inline JS/CSS, data 이미지, `allow-scripts allow-forms`와 CSP를 유지합니다. 단일 HTML의 조작은 관객별 로컬 상태이며 공유 저장이 아닙니다. Input의 form navigation 차단도 유지합니다.

## 이전 headless 세션과 종료 처리 (현재 TUI에는 적용하지 않음)

turn마다 별도 컨테이너와 bridge 디렉터리를 사용합니다. 성공한 요청의 conversation ID를 다음 turn에 전달하며, stage 초기화 또는 실행 실패 시 보관한 ID를 잊습니다. 중단·시간 초과 시 컨테이너 종료를 확인하기 전에는 다음 작업을 시작하지 않습니다. 종료를 확인할 수 없으면 새 실행을 차단하므로 컨테이너 상태 확인 후 서버를 재시작해야 합니다.

stream-json의 최종 결과만 Agent 응답으로 사용합니다. 원시 내부 도구 이벤트와 진단 출력은 공개하지 않습니다. 작업 종류와 실제 subagent 위임에서 검증된 이름·상태만 별도 진행 정보로 추출합니다. bridge는 일반 파일만 읽고 크기를 제한하며, 프로세스 종료 직전 남은 이벤트도 끝까지 처리합니다. 입력 답변과 오류 파일은 원자적으로 기록합니다. 인증된 실제 CLI의 대화 재개도 브라우저에서 확인했습니다.

## 공개 전 남은 검증

- 로컬 기능 검증을 넘어, 악의적인 공개 prompt·대량 접속·장시간 운영 조건을 검증. 동시 실행은 하나로 제한됨.
- Docker는 non-root, read-only rootfs, capability 제거, pid/CPU/memory 제한을 사용하며 `.pado/workspace`, turn bridge, 전용 인증 volume만 마운트. host home과 Docker socket은 마운트하지 않음.
- 기본 로컬 모드의 Docker egress는 host/LAN을 차단하지 않는다. 공개 모드는 별도 네트워크 gate와 고정 firewall 정책을 적용하고 실제 차단 smoke test를 수행한다. 저장 공간 watchdog은 있지만 하드 quota는 없다.
- **자유 JavaScript를 허용한 Input iframe은 비밀값 입력 용도가 아님.** 시크릿 입력은 별도 native UI와 저장 경로를 사용한다. 생성 HTML의 opaque origin과 CSP를 범용 실행 sandbox로 간주하지 않으며, 환경변수를 주입한 앱 코드의 임의 유출을 차단하지 않는다.
- Cloudflare Tunnel 연결, HTTPS origin/cookie, 프록시를 통한 관객별 rate-limit 정책, 외부 desktop/mobile 동시 접속과 부하 검증.
- 현재 로그·출력 제한은 메모리 보호 목적. agent가 의도적으로 공개한 텍스트의 민감정보 검토/비밀값 마스킹은 추가 필요.

컨테이너와 `.pado/` 산출물은 진단을 위해 남깁니다. 관리자 stage 초기화는 작업 파일과 인증 volume을 삭제하지 않습니다.

## 공식 자료

- [Headless / stream-json](https://antigravity.google/docs/cli/headless/)
- [CLI installation / authentication](https://antigravity.google/docs/cli/install)
- [Terminal sandbox](https://antigravity.google/docs/sandbox/)
