# Pado

### 에이전트가 작업에 필요한 화면만 펼치는 공유형 Generative Workspace

Pado는 Antigravity 같은 코딩 에이전트와 함께 바이브코딩할 때 사용하는 웹 기반 작업 공간입니다. 사용자가 파일 트리와 터미널을 계속 관리하는 대신, 에이전트가 현재 작업에 필요한 `Agent`, `Terminal`, `File`, `Docs`, `Input`, `Browser` pane을 상황에 맞게 공개하고 배치합니다.

Pado는 한 사람의 개발 환경을 여러 사람이 함께 보는 **shared stage**로 확장합니다. 관리자는 작업 흐름과 발언권을 제어하고, 관객은 데스크톱이나 모바일에서 현재 작업을 관람하고 필요한 순간에 참여할 수 있습니다.

<p align="center">
  <video src="./docs/assets/pado-demo.mp4" controls muted playsinline width="100%">
    브라우저가 동영상 미리보기를 지원하지 않습니다.
  </video>
</p>

<p align="center">
  <a href="./docs/assets/pado-demo.mp4">시연 영상 직접 열기</a>
</p>

> 현재 Pado는 로컬 및 신뢰할 수 있는 내부망에서 검증 중인 데모입니다. 공개 배포 전용 안전성 검증은 아직 완료되지 않았습니다.

## Pado가 해결하는 문제

기존 IDE는 에이전트가 무엇을 하고 있는지와 관계없이 Editor, Terminal, Chat, Preview를 항상 준비해 둡니다. 바이브코딩에서 사용자가 주로 하는 일은 코드를 직접 편집하는 것이 아니라 요구사항을 전달하고, 선택을 하고, 필요한 값을 입력하고, 결과를 확인하는 것입니다.

Pado는 이 흐름에 맞춰 작업 공간을 바꿉니다.

- 에이전트가 현재 작업에 필요한 pane만 공개합니다.
- 파일을 읽거나 수정했다는 이유만으로 File pane을 만들지 않습니다.
- 실제 에이전트 TUI와 명령 실행 결과를 필요한 범위에서 공유합니다.
- 여러 사람이 같은 작업을 실시간으로 보고, 한 번에 한 명만 프롬프트를 제출합니다.
- 모바일에서는 현재 pane 하나에 집중하고 필요한 pane으로 전환합니다.

## 핵심 경험

```text
관람 및 참여
  → 발언권 획득
  → 실제 Agent TUI에 프롬프트 입력
  → 에이전트 작업 진행
  → 필요한 Input 선택 또는 결과 확인
  → Terminal / File / Docs / Browser 결과 검토
  → 다음 작업 참여
```

### 동적으로 변하는 pane

| Pane | 사용 순간 |
| --- | --- |
| Agent | 에이전트의 현재 작업과 사용자 대상 메시지를 확인할 때 |
| Terminal | 사용자에게 보여줄 가치가 있는 실제 명령과 stdout/stderr를 확인할 때 |
| File | 직접 확인하거나 수정해야 하는 파일을 공개할 때 |
| Docs | 계약, 명세, 작업 기준, 결정사항을 검토할 때 |
| Input | 에이전트가 사용자에게 값이나 선택을 요청할 때 |
| Browser | 생성한 HTML이나 실제 React/Vite/Node 앱을 확인할 때 |

### 여러 역할이 하나의 stage를 공유

참가자는 닉네임으로 입장해 현재 workspace를 관람합니다. `Raise Hand`로 발언권을 요청하면 선착순으로 한 명이 제한된 시간 동안 프롬프트를 제출할 수 있습니다. 관리자는 참여 프로젝트, pane, 발언권, turn을 제어하고 필요하면 workspace를 초기화할 수 있습니다.

각 프로젝트는 resident TUI, 파일, 대화, pane, 앱 runtime을 독립적으로 유지합니다. 다른 프로젝트를 둘러보거나 참여 프로젝트를 바꿔도 실행 중인 runtime을 다시 시작하지 않습니다.

## 지금 구현된 것

- Antigravity CLI와 연결되는 실제 Agent TUI
- 에이전트 내부 작업과 사용자에게 공개하는 presentation의 분리
- 실시간 SSE workspace 동기화와 speaker lease
- Terminal 명령의 실시간 출력, 중단, 관리자 제어
- 생성형 Input과 프로젝트별 secret 입력 흐름
- 샌드박스 iframe 기반 HTML 및 실제 React/Vite/Node 앱 미리보기
- 데스크톱 split pane과 모바일 Focus Mode
- 프로젝트별 workspace 보존과 읽기 전용 프로젝트 탐색
- Docker로 분리된 에이전트 실행 환경 및 앱 runtime 경계

시연 프로젝트는 다음 세 가지입니다.

- [해커톤 데스크](examples/hackathon-ops/README.md): 팀과 질문을 저장하고 공유하는 작업 앱
- [아이디어 보드](examples/idea-board/README.md): 최초 정적 보드를 보존한 예제
- [개발자 블로그](examples/dev-blog/README.md): Markdown 글, 상세, 태그, 검색을 제공하는 Node 앱

## 빠르게 실행하기

요구 사항은 Node 24 이상과 pnpm 11.12.0입니다.

```sh
pnpm install
pnpm dev
```

개발 서버는 [http://127.0.0.1:4173](http://127.0.0.1:4173)에서 실행됩니다. 다른 브라우저나 시크릿 창으로 접속하면 관객 역할을 확인할 수 있습니다.

프로덕션 빌드는 다음처럼 실행합니다.

```sh
pnpm build
pnpm start
```

관리자 기능이 필요하면 `.env.example`을 참고해 `.env`에 16자 이상의 `PADO_ADMIN_PASSWORD`를 설정하고 서버를 다시 시작하세요. 로컬에서만 사용할 임의의 비밀번호는 다음 명령으로 만들 수 있습니다.

```sh
pnpm setup:local
```

실제 Antigravity TUI를 연결하려면 전용 환경에 로그인한 뒤 상태를 확인합니다.

```sh
pnpm agent:login
pnpm agent:check
```

인증 코드와 토큰은 저장소나 채팅에 남기지 마세요. 내부망 접속, Cloudflare Tunnel, 에이전트 이미지 설정은 [연동 안내](docs/AGENT.md)와 [공개 배포 안내](docs/PUBLIC_DEPLOY.md)를 참고하세요.

## 검증

기본 검증은 다음 명령으로 실행합니다.

```sh
pnpm check
pnpm test:e2e
```

추가 검증 명령은 실행 환경에 따라 선택합니다.

```sh
pnpm test:runner   # Docker runner와 presentation bridge
pnpm test:apps     # 앱 runtime
pnpm test:load     # SSE, 발언권 경쟁, 출력 부하
pnpm test:agent    # 전용 로그인 후 실제 Antigravity
```

브라우저 테스트는 desktop과 mobile Chromium에서 참가자 동기화, 발언권, 권한 거부, iframe 입력, 실시간 출력, 재접속, 관리자 제어를 확인합니다. `test:agent`는 명시적으로 실행할 때만 실제 AI 요청을 사용합니다.

## 프로젝트 구조

- `web/src/`: React workspace와 모바일 Focus Mode
- `server/stage.ts`: 발언권, turn, pane 상태의 서버 권위
- `server/index.ts`: 세션, 관리자 인증, 명령 API, SSE snapshot
- `server/runner.ts`: 고정 리허설과 Docker Antigravity adapter
- `server/tui-session.ts`: 프로젝트별 지속 TUI와 입력 권한
- `server/app-runtime.ts`: 격리된 앱 runtime
- `server/preview-gateway.ts`: Browser pane용 별도 gateway origin
- `shared/protocol.ts`: pane, presentation, snapshot 계약
- `agent/present.mjs`: 에이전트가 명시적으로 공개하는 pane과 명령 출력
- `examples/`: 실제로 실행할 수 있는 시연 프로젝트

## 문서

| 문서 | 내용 |
| --- | --- |
| [PROJECT_BRIEF.md](PROJECT_BRIEF.md) | 제품 목적과 MVP의 기준 문서 |
| [작업 목록](docs/TASKS.md) | 현재 구현 작업과 완료 조건 |
| [결정 기록](docs/DECISIONS.md) | 구현 중 확정한 기술·제품 결정 |
| [Pane 안내](docs/PANES.md) | pane별 표시 조건과 활용 사례 |
| [작업 기준과 Review](docs/WORKING_CONTEXT.md) | 작업 전 기준과 완료 후 검토 흐름 |
| [Workspace 안내](docs/WORKSPACES.md) | 프로젝트 저장, 앱 복원, 내부망 포트 경계 |
| [실제 앱 안내](docs/LIVE_APPS.md) | React/Vite/Node 앱과 Browser pane 연동 |
| [Secret 입력 안내](docs/SECRETS.md) | 프로젝트별 secret 입력과 저장 범위 |
| [TUI 안내](docs/TUI.md) | 원본 Antigravity TUI 사용·검증 |

Pado의 제품 방향과 범위는 [PROJECT_BRIEF.md](PROJECT_BRIEF.md)를 기준으로 하며, 이 README는 프로젝트를 처음 보는 사람이 제품과 실행 방법을 빠르게 이해할 수 있도록 정리한 소개 문서입니다.
