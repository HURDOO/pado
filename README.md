# Pado

공개 Mac mini/Tunnel 배포 및 운영: [docs/PUBLIC_DEPLOY.md](docs/PUBLIC_DEPLOY.md).

현재 작업에 필요한 화면을 에이전트가 펼쳐 놓는, 해커톤용 공유 Generative Workspace.

[작업 기준 → Review](docs/WORKING_CONTEXT.md): 구현 중 참고하는 요청·합의·가정을 Markdown으로 확인하고, 완료 후 같은 작업의 변경·검증 결과로 이어집니다. 당시 기준은 Review 안에서 다시 펼쳐볼 수 있습니다.

[원본 TUI 사용·검증 안내](docs/TUI.md). 이전 커스텀 채팅 버전의 기록은 [22시 초안](docs/DRAFT.md)에 남겼습니다.

[Pane별 표시 조건과 활용 사례](docs/PANES.md): 작업 현황은 Tasks, 정책 검토는 Docs, 선택은 Input, 실행 결과는 Browser로 구분합니다.

[시각적 비교 선택과 Review](docs/DECISIONS_AND_REVIEW.md): 구현 전에 안을 미리 보고 선택·확인하고, 완료 후 변경점과 실제 성공·실패·미검증 근거를 함께 검토합니다. Review의 재현 화면은 실행 중인 샌드박스 앱에 연결됩니다.

시연 프로젝트는 세 개로 나눕니다. [해커톤 데스크](examples/hackathon-ops/README.md)는 팀·질문을 실제 저장하고, [아이디어 보드](examples/idea-board/README.md)는 최초 정적 보드를 그대로 보존하며, [개발자 블로그](examples/dev-blog/README.md)는 Markdown 글·상세·태그·검색을 제공하는 작은 Node 앱입니다. 각 프로젝트에 독립된 brief·작업 목록·결정 문서가 있고, 관리자 프로젝트 선택은 관객에게도 함께 반영됩니다. 아직 최종 시연 주제는 아닙니다.

## 지금 사용할 수 있는 것

오른쪽 위 `+`에서 **직접 입력하는 Terminal**, 앱 Browser, 이전에 공유된 Docs·File·Tasks 등을 열 수 있습니다. 참여 프로젝트의 관리자 또는 현재 발언자/작업 요청자가 조작하며, 직접 연 창은 다음 turn에도 유지됩니다. 터미널은 프로젝트 파일을 공유하는 별도 Docker 셸에서 실행하고 닫으면 종료됩니다. 모바일 보조 키와 재연결을 지원하며, 리허설 모드에서는 공개된 pane 다시 열기만 사용할 수 있습니다. [pane 안내](docs/PANES.md).

로컬 MVP입니다. 닉네임 입장 → 30초 선착순 발언권 → **실제 Antigravity TUI 안에 직접 입력** → 프로젝트 작업 → 생성 Input 선택 → 명령 stdout/stderr → File/HTML 미리보기로 이어집니다. Agent pane은 커스텀 채팅이 아니라 지속 실행되는 `agy`의 원본 터미널입니다. 슬래시 명령·도구 승인·작업 진행도 원본 TUI에서 조작합니다. 공유 stage는 실시간 동기화되며 모바일은 pane 탭으로 전환합니다. 관리자 인증 후 pane focus/resize/close, 발언권 회수, 작업 중단, 대화·화면 초기화가 가능합니다.

**공개 배포용 안전성 검증은 아직 완료되지 않았습니다.** 현재는 로컬/내부망에서 신뢰할 수 있는 요청만 사용하세요. 설정이 없으면 고정 리허설이 기본이며, `.env`의 `PADO_RUNNER=antigravity`가 실제 TUI를 켭니다. 원본 TUI의 입력·모델 메뉴·공유 관람·모바일 한글 입력, 생성 Input·파일 작성·명령 출력·중단·초기화를 브라우저에서 검증했습니다.

실제 연결은 사용자 터미널에서 `pnpm agent:login`으로 전용 환경에 로그인한 뒤 `pnpm agent:check`로 확인합니다. 연결 확인은 짧은 모델 요청 한 번을 실행합니다. 이미지 빌드와 실행 모드 설정은 [연동 안내](docs/AGENT.md)를 참고하세요. 인증 코드나 토큰을 채팅에 보내지 마세요.

## 실행

API 키가 필요하면 “필요한 키는 시크릿 Input으로 받아서 실행해줘”라고 요청할 수 있습니다. Pado가 프로젝트별로 값을 저장하고 에이전트에는 이름·설정 여부만 전달하며, 지정한 앱/테스트 실행에 환경변수로 주입합니다. 로컬 데모용이며 사용법과 한계는 [시크릿 입력 안내](docs/SECRETS.md)를 참고하세요.

Browser pane은 단일 HTML 외에 **샌드박스의 실제 React/Vite/Node 서버**에도 연결됩니다. HTTP API, 공유 데이터 저장, WebSocket HMR을 지원합니다. 실행 방법과 내부망 포트, 연결 검증용 예제는 [실제 앱 안내](docs/LIVE_APPS.md)를 참고하세요. [해커톤 데스크](examples/hackathon-ops/README.md)를 **교체 가능한 임시 시연 베이스**로 준비했습니다. 최종 시연 주제 확정은 아닙니다.

Node 24 이상, pnpm 11.12.0을 사용합니다.

```sh
pnpm install
pnpm dev
```

[http://127.0.0.1:4173](http://127.0.0.1:4173)에서 접속합니다. 별도 관객은 시크릿 창이나 다른 브라우저로 입장하세요. 같은 브라우저 프로필의 탭은 한 참가자로 취급합니다.

관리자를 사용하려면 `.env.example`을 참고해 `.env`에 16자 이상의 `PADO_ADMIN_PASSWORD`를 직접 설정하고 서버를 다시 시작합니다. 화면 우측 위 설정에서 해당 비밀번호를 입력합니다. 설정하지 않으면 관리자 인증은 비활성화됩니다. 실제 값을 저장소에 커밋하지 마세요.

`pnpm setup:local`은 기존 유효한 비밀번호를 보존하면서, 없는 경우에만 임의의 로컬 관리자 비밀번호를 `.env`에 생성합니다. 비밀번호는 터미널 로그나 채팅에 출력하지 않습니다. `.env`에서 직접 확인해 사용하세요.

```sh
pnpm build
pnpm start
```

프로덕션 빌드도 같은 포트에서 실행합니다. 기존 개발 서버를 종료하고 실행하세요. 기본 바인딩은 `127.0.0.1`이며 공개 URL은 생성하지 않았습니다. 개발 서버는 프런트엔드 HMR을 지원하며 서버 코드 변경은 재시작이 필요합니다.

### WireGuard / 내부망 접속

현재 Mac의 내부 IP에서만 `http://<LAN_IP>:4173`으로 열어 두었습니다. Android에서 WireGuard를 켜고 이 주소로 접속합니다. `.env`의 `PADO_BIND_HOST=<LAN_IP>`, `PADO_ORIGIN=http://<LAN_IP>:4173`이 바인딩과 허용 요청 출처를 지정합니다. 공유기 포트 포워딩이나 공개 터널은 만들지 않았으며, WireGuard가 Mac의 내부망 대역으로 연결되어 있어야 합니다. `<LAN_IP>`는 실제 주소를 생략한 자리표시자입니다. Mac의 IP가 바뀌면 두 설정을 함께 바꾸고 재시작하세요. 신뢰하는 내부망 사용자만 접속하는 환경에서 사용합니다.

## 검증

```sh
pnpm check
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright pnpm exec playwright install chromium
pnpm test:e2e
pnpm format:check
# Docker 이미지 빌드 후, AI 호출 없는 presentation bridge 검증
pnpm test:runner
pnpm test:apps
pnpm test:load
# 전용 로그인·도구 권한 준비 후 실제 AI 요청을 하는 별도 브라우저 검증
pnpm test:agent
```

브라우저 테스트는 별도 14735 포트에서 실행합니다. desktop 1440×950과 mobile 390×844의 실제 Chromium에서 참가자 동기화, 발언권, 권한 거부, iframe 입력, 실시간 출력, 재접속, 관리자 제어를 검증합니다. 스크린샷은 `test-results/`에 저장합니다.

`test:agent`는 명시적으로 실행할 때만 실제 Antigravity를 호출합니다. 별도 14736 포트와 `.pado/live/<실행 ID>/workspace`에서 원본 TUI 입력·모델 메뉴·관객 권한·재접속·모바일 한글 입력, 생성 Input → 파일 작성 → 명령 출력 → 관리자 중단·초기화를 검증합니다. `preview.spec.ts`는 실제 React/Node 앱 실행, HMR, 공유 API·SQLite, 격리와 모바일을 검증합니다(앱 게이트웨이 14836–14839). 일반 `check`와 `test:e2e`에는 포함되지 않습니다. 이전 headless 시나리오는 `tests/live/agent.spec.ts`에 참고용으로 남겼지만 실행하지 않습니다. 실패한 검증을 실제 AI 개발 완료로 간주하지 않습니다.

`tasks.spec.ts`는 pane 이름을 지정하지 않은 작업 현황 요청 → Tasks 선택 → 실제 TASKS 원문과 같은 pane의 다음 작업 갱신 → 작업과 무관한 짧은 질문에 pane 미생성을 확인합니다. `pnpm test:agent tasks.spec.ts`로 이 흐름만 실행할 수 있습니다.

`test:load`는 14737 포트의 별도 로컬 production-build 서버에서 18개의 SSE 연결, 발언권 경쟁, 출력 폭주 및 최종 상태 일치를 검증합니다. AI 호출이나 외부 네트워크 요청은 하지 않습니다. 일반 브라우저 테스트가 관리자 로그인 제한에 도달하면 `Retry-After`를 지키며 기다립니다.

## 구조

- `shared/protocol.ts`: pane / presentation / snapshot 계약
- `server/stage.ts`: 발언권과 turn, pane 상태의 단일 권위
- `server/index.ts`: HttpOnly 세션, 관리자 인증, POST 명령, SSE snapshot
- `server/runner.ts`: 고정 리허설 및 Docker Antigravity adapter
- `server/tui-session.ts`, `server/docker-terminal.ts`: 프로젝트별 지속 Docker PTY, 입력 권한, native lifecycle hooks, 중단 확인
- `server/terminal-screen.ts`, `web/src/TuiPane.tsx`: xterm 화면 재생, 전체 화면 재접속, 공유 크기와 모바일 키 입력
- `server/app-runtime.ts`, `server/preview-gateway.ts`, `web/src/BrowserPane.tsx`: 인증 없는 앱 컨테이너, 분리 origin의 HTTP/WS 연결과 실제 서버 미리보기
- `server/agent-session.ts`, `server/agent-stream.ts`: 이전 headless adapter (`agent:check` 전용, 실제 UI 경로에서는 미사용)
- `agent/present.mjs`: 에이전트가 명시적으로 공개하는 pane과 실제 명령 출력
- `web/src/`: React workspace, mobile Focus Mode, 격리된 HTML Input
- [작업 목록](docs/TASKS.md), [결정 기록](docs/DECISIONS.md), [연동 안내](docs/AGENT.md)

모두 왼쪽 목록(모바일 상단 선택기)에서 프로젝트를 자유롭게 둘러볼 수 있습니다. 열람 위치는 탭마다 유지하며, 관리자가 별도로 지정한 **참여 프로젝트 하나**에서만 손들기·TUI 입력·Input 응답·창 조작이 가능합니다. 다른 프로젝트는 관리자도 읽기 전용입니다. 프로젝트마다 원본 TUI와 앱 서버가 계속 살아 있어 왕복할 때 다시 시작하지 않습니다. 새 turn에는 이전 pane을 접고 Agent에 집중하며 결과가 준비되면 에이전트가 필요한 창을 다시 열고 앞쪽으로 확대합니다. 기존 `.pado/workspace`의 파일은 그대로 유지합니다. [프로젝트 workspace 안내](docs/WORKSPACES.md)에 저장·앱 복원·내부망 포트와 경계를 정리했습니다.
