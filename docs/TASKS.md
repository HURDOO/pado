# Pado 사용자 흐름

## 2026-09-19 — 실제 명령 대기에 연결된 Terminal

- [x] 일반 `exec`/`run`을 현재 루트 에이전트의 native 도구 호출·반환·대기 상태와 실제 실행 ID에 연결한다. 실제 결과를 기다리는 실행만 읽기 전용 로그를 공개하고 단순 백그라운드 실행·내부 파일 작업·Input 대기를 제외한다.
- [x] 서버 시작 로그는 기존처럼 유지한다. 내부 작업의 `--quiet`와 명시적 로그 요청의 `--show`를 구분하고, 새 대기 로그가 Agent·Context·모바일 포커스를 빼앗지 않게 한다. 닫은 로그를 다시 열거나 끝난 명령을 뒤늦게 공개하지 않는다.
- [x] 원시 native 로그 대신 앱 runtime의 실제 stdout/stderr·종료 코드를 사용한다. 루트 대화·turn·step·관측 시각·실행 ID를 검증하고 공개 전 출력 버퍼를 제한한다. pane 제한에 걸려도 명령 실행은 유지한다.
- [x] `pnpm check`(단위 137개·타입·린트·빌드), 최종 전체 브라우저 37개, 실제 Docker 앱 4개를 통과한다. 일반/공개 모드의 실제 Antigravity 통합 각 1개에서 14초 명령의 초기 4초 이내 로그 공개·내부 명령 숨김·실제 종료 코드·데스크톱/320px 모바일·포커스 유지를 확인했다. 공개 hook 통합 후 실제 공개 모드도 재검증했다.

최종 native 기록은 `test-results/waiting-terminal-enter-live`, `test-results/waiting-terminal-public-integrated`, 전체 브라우저 기록은 `.pado/waiting-terminal-browser-verified`에 남긴다. 초기 실연동에서는 도구 반환과 invocation hook 시점 차이로 공개가 늦는 것을 발견해 고정 helper의 정확한 호출 진입 확인을 추가하고 초기 공개 검증을 강화했다. 동시 공개 Subagent 작업으로 중복된 PostToolUse 키도 두 관측 항목을 보존해 통합하고 회귀 테스트를 추가했다. Chromium의 macOS sandbox 실행 차단 시도는 제품 검증에서 제외하고 허용된 환경에서 전체 37개를 다시 통과했다. 검증 이미지는 `pado-agent:waiting-terminal-20260919`이며 **공유 공개 서버·기본 이미지 태그·Tunnel 설정은 변경하거나 재시작하지 않았다.** 반영하려면 새 서버와 helper/hook 이미지가 함께 필요하다. 직접 native shell·모호한 복합 호출은 자동 연결 대상이 아니며, 물리 Android 검증은 포함하지 않는다. [사용법과 추적 범위](WAITING_TERMINALS.md).

## 2026-09-19 — 해커톤 참가자 CLI 직접 조작

- [x] `PADO_PARTICIPANT_TUI=1`을 공개 입력 opt-in으로 분리하고 원본 TUI·슬래시 메뉴·모바일 보조 키를 복구한다. `PADO_PUBLIC_MODE=1` 컨테이너/네트워크 격리는 그대로 유지한다.
- [x] 발언자와 현재 작업 요청자만 직접 조작하며 관객·이전 발언자·비참여 프로젝트의 쓰기 차단을 유지한다. 서버가 입력 모드를 snapshot으로 전달한다.
- [x] `pnpm check` 128개, 기존 E2E 34개, 실제 공개 모드 브라우저 2개, 직접 입력 모드의 host/LAN 차단 smoke를 통과한다. desktop/mobile에서 입력 echo, `/help`, Esc와 발언권 반환 후 입력 거부를 확인했다.
- [x] 사용자의 현재 작업 중단 승인을 받은 뒤 정상 재시작하고, loopback에서 직접 입력 설정·3개 TUI ready·저장된 앱 미리보기 200을 확인한다.

6시간 행사용이라는 사용자의 운영 범위를 기록하되 자동 종료 시각이나 동아리 인증은 임의로 추가하지 않는다. 자세한 경계와 종료 명령은 [PUBLIC_DEPLOY.md](PUBLIC_DEPLOY.md).

## 2026-09-19 — 개인 열람과 프로젝트별 상주 TUI

- [x] 프로젝트마다 StageStore·Runner·TUI·앱 gateway를 유지한다. 서버 시작 시 각 TUI/저장 앱을 복원하고, 열람/참여 지정만으로 기존 프로세스를 재시작하지 않는다. 자동 앱 복원은 로그 pane 생성이나 focus 변경을 하지 않는다.
- [x] 관객/관리자 모두 프로젝트를 자유롭게 열람하고 탭별 선택을 기억한다. 관리자의 별도 `참여 프로젝트로 지정`만 입력 대상을 바꾸며, 작업/발언권/Enter hook 대기/변경 요청 중에는 지정을 차단한다.
- [x] 서버에서 비활성 프로젝트의 관리자·관객 TUI 입력/resize, 손들기, Input·시크릿 응답, pane 변경, 중단·초기화를 거부한다. 앱 HTTP 변경 요청/WS도 거부하고 기존 변경 연결을 취소한다. GET 부작용이나 앱의 배경 실행까지 동결하는 기능은 아니다.
- [x] 실제 Docker TUI 3개와 앱 3개를 동시에 실행해 A→B→C→A epoch/초안/앱 상태 유지, TUI SSE 분리, 비활성 입력 거부, 한 프로젝트만 중단, 서버 종료 시 테스트 소유 runtime 전체 종료를 검증한다. AI 요청은 하지 않았다. 기록: `.pado/project-sessions-9pGg5T`.
- [x] 4173이 idle인 것을 확인한 뒤 정상 재시작한다. 기존 파일 48개와 앱 API 데이터, 프로젝트/대화/앱 메타데이터, 기존 pane을 보존한다. 실제 세 TUI ready·앱 HTTP 200·PC/320px 열람·새로고침·입력 잠금·왕복 epoch 유지 및 JS 오류 없음을 확인한다. 기록: `.pado/multi-session-handoff`.

최종 `pnpm check` 단위 121개·타입·린트·빌드 통과. 전체 브라우저 31개 최초 통과 후 동시 pane 추가 변경에서 관리자 안내 upsert가 제한된 일반 조작 경로로 전송되는 회귀를 발견해 관리자 전용 경로로 수정했다. 최종 전체 실행 30개 통과·해당 실패 1개 후, 실패 항목과 프로젝트 읽기 관련 4개를 재검증해 모두 통과했다(`.pado/multi-session-browser-final`, `.pado/multi-session-final-recheck`). 물리 Android/WireGuard 키보드 검증은 포함하지 않는다.

## 2026-09-19 — Markdown 작업 기준과 Review 연결

- [x] 요청·기존 합의·에이전트 가정을 제목·문단·목록으로 서술하는 Context pane을 추가한다. 계획표·표·카드를 요구하지 않으며, 작은 구현은 요청 한 줄로 충분하다.
- [x] 서버가 현재 작업과 기준을 연결한다. 갱신 시 포커스·크기·순서를 유지하고, 숨김·재접속·저장 수 제한·프로젝트 복원·중단에서도 기준과 수명이 섞이지 않게 한다.
- [x] 같은 작업의 Review가 Context를 이어받고 마지막 Markdown을 펼쳐볼 수 있도록 한다. 다른 ID의 Review도 중복 없이 대체한다. 보고 없는 종료·중단을 성공으로 표시하지 않는다.
- [x] 실제 Input 응답 뒤 같은 기준을 갱신하도록 에이전트 지침과 wait helper 안내를 연결한다. stdout 답변 JSON은 유지한다. 실연동 검증은 선택 전후 Markdown이 실제로 바뀌었는지와 선택 출처를 확인한다.
- [x] `pnpm check` 최종 단위 115개·타입·린트·빌드, 수정 파일 포맷을 확인한다. 전체 E2E 최초 30개 통과. 동시 프로젝트 API 변경 후 재실행은 29개 통과·잘못된 프로젝트 ID의 응답 코드 기대값 1개 불일치였으며, 400 검증으로 조정 후 해당 테스트와 Context 흐름 2개를 재실행해 모두 통과했다.
- [x] 실제 Antigravity가 정책 읽기 → 기준 공개 → 사용자 선택 대기 → 기준 갱신 → 설정 변경 → 실제 명령 검증 → Review를 수행하는 강화된 실연동 1개를 통과한다. 데스크톱·390/320px 레이아웃과 실제 생성 Markdown·Review를 확인했다.

- [x] 후속 반영 요청으로 최신 통합 소스의 `pnpm check`(단위 124개), 전체 브라우저 34개, 새 이미지의 실제 Docker 앱 4개를 통과한다. 중간에 다른 세션의 새 테스트 타입 오류가 있었으나 해당 세션의 수정 이후 전체 check를 재실행해 통과했다.
- [x] 세 프로젝트가 모두 idle인 상태에서 4173을 정상 재시작하고 `pado-agent:context-integrated-20260919`를 기본 `pado-agent:local`에 반영한다. 세 실제 TUI의 지침·helper 해시가 현재 소스와 일치하며, 기존 파일 48개·프로젝트/대화/앱 메타데이터·앱 API 데이터·표시/저장 pane 내용과 배치·대화를 보존했다. TUI 3개 ready, 실행 앱 2개 HTTP 200, 데스크톱·320px 모바일 및 JS 오류 없음을 확인한다. 내부망 origin은 유지하고 공개 접속 설정은 바꾸지 않았다.

사용법은 [작업 기준 안내](WORKING_CONTEXT.md), 최종 실제 AI 검증과 화면은 `test-results/work-context-live-choice`에 남긴다. 통합 브라우저 검증은 `.pado/context-handoff-browser`, 4173 반영 전후 기록과 PC/모바일 화면은 `.pado/context-handoff.8Zp6PG`에 보존한다. 이전 기본 이미지는 `pado-agent:before-context-20260919-8Zp6PG`로 남겼다. 실제 Android 기기·공개 인터넷 검증은 포함하지 않는다.

## 2026-09-19 — 시크릿 Input과 실행 환경 연결

- [x] 생성 HTML과 분리한 native password Input을 만들고 요청자/관리자만 입력하도록 한다. 320px 모바일에서도 입력란과 저장 버튼을 유지한다.
- [x] 프로젝트 workspace 밖의 0600 평문 파일에 저장하고 에이전트에는 변수 이름·설정 여부만 반환한다. 공유 snapshot, 대화, 일반 입력 bridge에는 원문을 넣지 않는다.
- [x] helper의 `secrets` 이름 조회와 `--secrets NAME` 선택 주입을 연결한다. 에이전트 컨테이너와 기본 앱 실행에는 주입하지 않으며 프로젝트별 값·실행 메타데이터를 분리한다. 원문을 확인·출력하지 않는 에이전트 지침을 추가한다.
- [x] `pnpm check`(단위 105개), 전체 E2E 29개, 실제 Docker 앱 검증 4개 통과. 실제 Antigravity가 입력을 요청하고 names-only 응답을 받은 뒤, 입력 키로 HMAC 서명하는 앱을 실행하는 실연동 1개도 통과했다. 시연용 임의 키만 사용했다.
- [x] 기존 4173의 진행 중 작업이 끝난 뒤 정상 재시작하여 `pado-agent:local` 이미지와 프런트엔드를 반영했다. 프로젝트 3개와 기존 pane을 보존하고 앱 HTTP 200·Antigravity TUI ready를 확인했다. 기록: `.pado/secrets-handoff.hnlUZu/result.json`.

입력·실행 사용법은 [SECRETS.md](SECRETS.md), 실제 AI 검증 화면은 `test-results/secret-live`, PC/모바일 UI는 `test-results/browser`에 보존한다. 프롬프트 기반 협조와 정상 사용 흐름을 위한 데모 기능이며 임의 앱 코드의 비밀값 접근을 기술적으로 차단하지 않는다.

## 2026-09-19 — Subagent 수정본을 4173에 통합, 4183 종료

- [x] 공유 main의 다른 Codex 변경을 유지하고, 실제 진행 중인 작업이 끝난 뒤 4173을 정상 재시작한다. Git 초기 커밋/병합이나 다른 작업 파일 덮어쓰기는 하지 않았다.
- [x] 현재 소스로 `pado-agent:main-subagent-resume-20260919`를 빌드하고 `pado-agent:local`에도 반영한다. 이전 기본 이미지는 `pado-agent:before-subagent-main-20260919-b7f520`로 보존한다. 실제 4173 컨테이너의 로그 수집기 해시와 재사용 처리 코드를 확인한다.
- [x] 프로젝트 3개와 작업 파일 48개, 기존 pane·대화 연결·앱 설정 및 실제 앱 API 데이터가 보존됨을 확인한다. 실행 중이던 앱은 저장된 명령으로 다시 연결하며, main 작업에서 추가한 앱 서버 로그 pane도 유지한다. PC/모바일 TUI ready 및 화면 오류 없음을 확인한다.
- [x] 사용자 요청대로 4183과 그 TUI를 정상 종료하고 포트가 닫힌 것을 확인한다. `.pado/subagent-demo.yYJkW3`의 파일·대화 기록은 삭제하지 않았다.

전환 기록: `.pado/subagent-main-handoff-20260919` (`before.json`, `result.json`, PC/모바일 화면). 4173은 기존 `.env`로 `pnpm start` 실행 중이다. `pnpm check`(단위 99개) 통과. 브라우저는 26개 통과 후, 동시 Terminal UI 변경으로 이전 문구/pre 선택자를 기대하던 2개를 main의 최신 테스트로 다시 실행해 통과했다(`.pado/subagent-main-browser-v2`, `.pado/subagent-main-browser-recheck`). 테스트 이미지를 별도 서버에서만 쓰던 이전 기록과 구분한다.

## 2026-09-19 — 화면 장식 축소와 TUI 참여 버튼

- [x] workspace 소개 헤더·하단 footer·pane 부제목·중복 종류 라벨을 제거한다. 상단은 48px(모바일 44px), pane 제목줄은 34px(모바일 38px)로 줄이고 프로젝트 이름은 상단에 유지한다.
- [x] 참여 가능한 때만 TUI 안에 파란 손들기 버튼을 겹쳐 표시한다. 다른 발언자·작업·전환·재연결·요청 처리 중에는 숨기고, 내 발언 차례에는 남은 시간과 양보만 작은 줄로 표시한다. 기존 입력 잠금·보조 키·서버 권한 경계는 유지한다.
- [x] 타입·린트·포맷·단위 99개·빌드, 최종 전체 브라우저 28개를 통과한다. 1646×838, 390/320px 및 가로 모드에서 배치·버튼 숨김·TUI 높이 유지·입력 포커스·양보·모바일 탭 전환을 검증한다.
- [x] 실제 내부망의 관리자·관객 화면을 desktop/mobile로 확인하고 프런트엔드에 반영한다. 진행 중인 실제 작업은 중단하거나 전환하지 않았고, 원본 프로젝트·데이터·서버 프로세스는 변경하지 않았다.

최종 브라우저 기록은 `.pado/compact-ui-browser-final`, 실제 화면은 `.pado/compact-ui-handoff`에 보존한다. 초기 회귀에서 새 제목 툴팁과 iframe 제목이 중복되는 것을 확인해 불필요한 툴팁을 제거하고 전체 재검증했다. 물리 Android 검증은 포함하지 않는다.

## 2026-09-19 — 왼쪽 프로젝트 목록

- [x] 데스크톱의 현재 프로젝트 표시를 전체 프로젝트 선택 목록으로 바꾸고 선택 표시·키보드 조작·새 프로젝트 생성을 연결한다. 긴 이름은 줄바꿈하고 목록은 스크롤한다.
- [x] 태블릿·모바일은 상단 선택기를 유지한다. 관리자만 전환하고 관객도 함께 이동하며, 작업·발언·전환·재연결 중 중복 선택을 차단한다.
- [x] 타입·린트·단위 99개·빌드와 전체 브라우저 27개, 최종 포커스 표시 회귀 1개를 통과했다. 공유 선택·별도 pane 복원·관객 읽기 전용·전환 요청 중 잠금·긴 이름·키보드·850/390/320px 화면을 검증했다.
- [x] 내부망의 실제 세 프로젝트를 왼쪽 목록으로 왕복 전환하고 모바일 관객 동기화를 확인했다. 기존 작업 파일과 앱 데이터는 수정하지 않았으며 해커톤 데스크로 돌아왔다. 프런트엔드만 반영해 Pado 서버는 재시작하지 않았다.

실제 내부망 결과와 화면은 `.pado/project-sidebar-handoff`, 전체 브라우저 회귀는 `test-results/browser`, 최종 목록 회귀는 `.pado/project-sidebar-final-browser`에 남겼다. 물리 Android 기기 검증은 포함하지 않는다.

## 2026-09-19 — 재사용 Subagent의 빈 로그 수정

- [x] 4183에서 기존 자식을 후속 turn에 재사용할 때 원래 spawnStepIndex가 부모의 이번 시작 step보다 작아 출력 관측에서 제외되는 원인을 확인하고, 수정 전 실패하는 회귀 테스트로 재현한다.
- [x] 부모-자식 메타데이터와 같은 turn의 자식 hook을 함께 검증해 재개된 실행도 관측한다. 이번 자식 실행 시작 step 이후만 표시하고 과거·잘못된 turn의 hook은 거부한다.
- [x] `pnpm check`(단위 99개), 전체 브라우저 26개 통과. 실제 최초 위임 → 완료 → 다음 사용자 turn에서 동일 자식에 send_message → 데스크톱/모바일 로그 출력 → 완료/자동 닫힘까지 통과한다. 자식 수는 1개로 유지되고 이전 작업 출력은 섞이지 않는다.
- [x] 4183에 `pado-agent:subagent-resume-log-20260919`를 적용한다. workspace 파일 4개의 해시와 기존 Browser pane을 보존한다. 4173과 기본 이미지 태그는 변경하지 않는다.

검증 기록: `.pado/subagent-resume-proof`, `.pado/subagent-resume-live`, `.pado/subagent-resume-browser`, `.pado/subagent-resume-handoff`. 실제 재사용 중 화면은 `subagent-resumed-desktop.png`, `subagent-resumed-mobile.png`에 남겼다.

## 2026-09-19 — 세 개의 프로젝트 베이스

- [x] 기존 default 프로젝트는 해커톤 데스크로 이름을 바꾸되 ID·파일 경로·데이터·사용자가 정한 일정/공지 다음 작업을 유지한다. 관리자 이름 변경 API와 공유 반영·권한 검증을 추가한다.
- [x] 초기 파란색 아이디어 보드의 HTML을 그대로 복사해 별도 workspace와 Browser·Tasks를 준비한다. 원본 해시와 카드 추가·좋아요·삭제·모바일을 확인한다. 현재 화면 내 상태라는 경계를 문서화한다.
- [x] 개발자 블로그 ‘작은 기록’을 Node HTTP + Markdown으로 만든다. 글 3편, 목록·상세·검색·태그·빈 결과·직접 URL·새로고침·오류 화면과 텍스트 중심 안전 렌더링을 구현한다.
- [x] 새 프로젝트마다 PROJECT_BRIEF, AGENTS, README, TASKS, DECISIONS를 두고 미구현 기능과 결정할 사항을 구분한다. 새 두 프로젝트의 다음 작업은 임의로 지정하지 않는다.
- [x] 블로그 문법/HTTP 검증은 credential-free AppRuntime에서 실행하고 실제 Chromium 1280/390/320px의 탐색·검색·상세·가로 넘침·script 문자열 비실행을 확인한다. Pado check(단위 93개)와 전체 브라우저 26개를 통과했다.
- [x] 내부망에서 아이디어 → 블로그 → 아이디어 → 해커톤으로 함께 전환하고 기존 데이터·작업 원문 보존을 최종 확인한다. 마지막에는 해커톤 Browser와 실제 작업 목록을 보여준다.

앱 검증 기록: `.pado/demo-projects-check/b89d28d6-7ea3-4f19-b23e-ef211778a6f5`. 프로젝트 구성·내부망 화면: `.pado/three-projects-handoff`. 템플릿은 `examples/idea-board`, `examples/dev-blog`에 둔다. 물리 Android와 공개 인터넷 배포는 검증하지 않았다.

## 2026-09-19 — Subagent 상세 터미널 로그

- [x] 실행 구조를 유지한 채 READ/EDIT/RUN/MESSAGE/RESPONSE 블록에 작업 설명·상대 경로·행 범위·실제 diff 발췌·필터링한 stdout·종료 코드·중간 메시지를 표시한다. 클라이언트에서만 안전한 색상을 추가한다.
- [x] 실제 CLI의 JSON 인자 문자열과 잘린 문자열을 처리한다. 추론/프롬프트/진단/인증정보 패턴을 제외하고, 모호한 결과는 성공으로 추정하지 않는다.
- [x] `pnpm check`(단위 94개), 전체 브라우저 25개, 실제 파일 조회·수정·명령·보고를 포함하는 native 위임 1개를 통과한다. pane 1개와 완료 후 3초 닫힘, 데스크톱·모바일 화면을 확인한다.
- [x] 별도 4183 테스트 서버에 `pado-agent:subagent-detailed-log-20260919`를 적용한다. 기존 workspace 파일 4개의 해시와 공개 Browser pane을 보존한다. 4173 서버와 기본 이미지 태그는 변경하지 않는다.

검증 기록: `.pado/subagent-detailed-browser`, `.pado/subagent-detailed-proof-v3`, `.pado/subagent-detailed-live-v3`. 초기 실제 실행에서 인자의 JSON 인코딩을 발견해 보정했다. 별도 관찰: 초기 시나리오에서 자식이 최종 결과까지 `send_message`로 먼저 전달하면 부모의 마지막 Stop이 `fullyIdle:false`, 자식의 Stop만 `true`여서 메인 turn 대기가 남는 기존 lifecycle 예외가 재현됐다(`.pado/subagent-detailed-proof-v2`). 이번 변경에서는 lifecycle을 수정하지 않았다. 최종 검증은 중간 보고 1회와 정상 최종 응답을 분리했고 전체 흐름이 통과했다.

## 2026-09-19 — 시각적 비교 선택과 변경·검증 Review

- [x] 기존 Input에 2–4개 시각적 비교안, 장단점, 선택 확인, 추가 요청을 연결한다. 실제 응답 전에는 구현하지 않고 관객의 제출과 잘못된 선택 ID를 차단한다.
- [x] Review에 변경 요약·관련 파일·통과/실패/미검증·남은 확인을 표시한다. 실제 exec runId의 종료 코드·시각을 서버가 연결하고 수동 확인 보고와 구분한다.
- [x] Review 재현 화면을 현재 프로젝트의 허용된 실제 앱 포트에 연결한다. Browser를 닫아도 공개 Review의 재현은 작동하고, 비공개·임의 포트는 허용하지 않는다.
- [x] 데스크톱 비교 배치, 320/390px 모바일 스크롤·확인 버튼, Review 포커스 확대, 완료 시 불필요한 앱 로그 정리를 검증한다.
- [x] 타입·린트·빌드·포맷, 단위 85개, 전체 브라우저 25개 및 최종 UI 회귀 2개를 통과한다. 실제 Antigravity가 비교 선택을 기다린 뒤 선택한 설정을 구현하고 실제 명령 성공·실패·미검증과 재현 화면을 전달하는 흐름을 두 차례 통과했다.
- [x] 내부망 서버에 반영하고 기존 프로젝트·pane·파일 보존과 데스크톱·모바일 화면을 검증한다. 앱은 반영 전부터 중지되어 있어 자동 시작하지 않았으며, 앱 API 데이터 전후 비교는 이번 handoff 검증에서 제외했다.

최종 실제 검증: `test-results/decision-review-live-v2`, `.pado/decision-review-live-v2`. 내부망 반영·보존 결과는 `.pado/decision-review-handoff/result.json`에 기록했다. 검증 이미지는 `pado-agent:decision-review`이며 기본 `pado-agent:local`에도 반영했고, 이전 기본 이미지는 `pado-agent:before-decision-review`로 보존한다. [사용 예와 경계](DECISIONS_AND_REVIEW.md). Browser 요소 지정 피드백은 요청에 따라 제외했다. 실기기 Android와 공개 인터넷은 검증하지 않았다.

## 2026-09-19 — Subagent TUI와 중복 pane 수정

- [x] 상태 카드를 실제 자식 응답·도구 이름이 표시되는 읽기 전용 xterm TUI로 교체한다. 내부 추론·프롬프트·원시 도구 결과는 제외하고 출력은 컨테이너 내 관측으로 연결한다.
- [x] 자식 hook과 부모 observer의 식별자를 통일해 실제 자식 하나당 pane 하나만 생성한다. 늦은 상태/출력 이벤트로 재생성하거나 닫힘 기한을 늘리지 않는다.
- [x] 타입·린트·빌드와 단위 78개, 전체 브라우저 21개, 마지막 UI 회귀 7개를 통과한다. 실제 `self` subagent 호출에서도 공유 pane 1개, 실제 응답 출력, 완료 후 3초 제거, desktop/mobile 화면을 확인한다.

실제 검증은 `.pado/subagent-tui-proof-v2`, 전체 브라우저는 `.pado/subagent-tui-browser`, 마지막 UI 회귀는 `.pado/subagent-tui-browser-final`에 보존한다. 실행 이미지는 `pado-agent:subagent-tui-fix-20260919`이다. Subagent TUI는 원본 CLI의 별도 대화형 PTY가 아닌 실제 실행 로그의 읽기 전용 터미널이다.

## 2026-09-19 — 프로젝트 workspace와 유기적인 창 관리

- [x] 관리자 프로젝트 생성·선택, 모든 관객의 공유 전환, 작업/발언 중 전환 차단, 늦은 이전 프로젝트 입력 거부를 구현한다.
- [x] 파일·pane·최근 artifact·원본 TUI 대화 DB·앱 실행을 프로젝트별로 분리하고 기존 workspace를 보존한다.
- [x] 새 turn에는 이전 창을 접고 Agent에 집중한다. 결과 Browser와 갱신된 Tasks를 같은 ID로 복원·확대·앞쪽 이동한다.
- [x] 실제 A→B→A로 대화 기억·파일 격리·별도 Browser origin·앱 복원·Tasks 갱신·모바일 관객 동기화를 검증한다.
- [x] 내부망에 적용하고 기존 파일 5종·작업 문서·앱 데이터·공개 창 3개의 내용 보존과 desktop/mobile 연결을 검증한다.

타입·린트·빌드·포맷, 브라우저 전체 20개 및 최종 관련 회귀 4개 통과. 마지막 단위 실행은 함께 통합된 Subagent 테스트를 포함해 71개 통과했다. 실제 통합 성공 기록은 `test-results/projects-live-v4`, 새 수명 정책의 Tasks 3-turn 성공은 `test-results/projects-tasks`, 내부망 보존 결과와 화면은 `.pado/projects-handoff`에 남겼다. 실제 Docker 시작 직후 취소·정상 종료도 별도 smoke test로 확인했다.

최초 중복 Browser, 로컬 대화 DB 미보존, nested mount의 비루트 쓰기 문제는 실제 검증에서 발견해 보완했다. 이전 CLI 프로젝트 레코드가 없는 기존 대화는 원본 DB를 보관하고 원본 `/fork`로 내용을 이어받아 유효한 프로젝트에 연결했다. 이후 프로젝트 설정 레코드도 함께 보존하며 native fork/resume 선택을 종료 시 반영한다. 프로젝트 생성·전환은 관리자 전용이며 최대 12개, 물리 Android 실기기와 공개 인터넷은 검증 범위 밖이다. [사용 안내](WORKSPACES.md).

## 2026-09-19 — Subagent 호출과 pane 수명

- [x] 서브에이전트 호출마다 전용 pane을 열고, 종료 감지 후 3초 뒤 모든 관객 화면에서 닫는다.
- [x] 재개 시 닫힘 취소, 중복·이전 turn 이벤트 무시, 동시 작업, 중단·오류·초기화, 관리자 조작과 모바일 탭 전환을 검증한다.
- [x] 자식 hook을 상속하지 않는 실제 CLI를 부모 hook의 컨테이너 내부 메타 관측으로 연결한다. 중간 메시지는 완료로 간주하지 않으며 내부 프롬프트·로그·경로를 공개하지 않는다.

분리 워크트리에서 UI와 native 연결을 구현해 통합했다. 타입·린트·빌드와 단위 63개, desktop/mobile을 포함한 브라우저 20개 검증을 통과했다. 실제 Antigravity 위임 → 두 관객의 pane 생성 → 종료 후 3초 제거 시나리오도 통과했으며, 최종 실제 기록은 `.pado/subagent-proof-v3`, 브라우저 회귀 기록은 `.pado/subagent-e2e-final`에 보존한다. 초기 자식 hook 미상속과 hook 경로 차이는 실제 검증에서 발견해 보완했다. 완료 시각은 부모 hook이 확인한 시각이며 별도 상주 관측 프로세스는 추가하지 않았다. 검증된 이미지는 `pado-agent:local`에도 반영했으며 기존 실행 서버와 TUI는 재시작 후 적용된다.

## 2026-09-19 — 작업 목록 검토와 pane 활용 안내

- [x] 실제 작업 문서를 Tasks pane으로 보고 진행/다음/대기/보류/완료를 구분한다. 단순 구현 언급과 목록 검토 의도를 구분하고, 같은 pane 갱신·관객 읽기 전용·모바일·원본 TUI의 자동 선택을 검증한다.
- [x] Agent/Tasks/Docs/Input/File/Terminal/Browser의 표시 조건과 해커톤 앱 활용 예시를 [pane 안내](PANES.md)에 정리한다.

타입·린트·빌드와 단위 42개, 브라우저 13개 통과. 실제 AI 3-turn 흐름은 작업 현황의 Tasks 선택, 원문 변경 없이 조회, 같은 ID의 다음 작업 갱신, 보류 유지, 계산 질문에 불필요한 pane 미생성을 검증했다. 최초 시도는 문서 수정 중 불필요한 `git status` 승인을 요청해 타임아웃됐고, 파일 도구만 사용하도록 정책을 보강한 후 재검증했다. 최초 기록은 `test-results/live`, 성공 기록은 `.pado/tasks-live-v2`에 보존한다. 기존 고정 포트 테스트의 소켓 재사용과 추가 로그인에 따른 테스트 순서를 조정했으며 실제 인증 제한은 변경하지 않았다.

내부망 4173에도 적용했다. 기존 정적 Browser 내용과 해커톤 앱 데이터를 보존하고 앱 서버를 재연결했다. 실제 stage의 원본 TASKS 미변경, Tasks(완료 1/대기 4/보류 1/다음 0), desktop/mobile 공유 표시와 Browser 탭 전환을 확인했다. 앱 재연결 helper의 기본 제목은 기존 “해커톤 데스크”로 복원했다. 결과와 화면은 `.pado/tasks-lan-review`에 보존한다. 물리 Android 검증은 포함하지 않는다.

실제 desktop에서 Browser 두 개와 함께 열면 Tasks가 180px로 압축되는 것을 발견해, 집중된 Tasks는 가용 높이 안에서 최소 480px의 검토 공간을 확보하도록 수정했다. 관련 작은 화면·Tasks·focus 회귀 3개와 실제 LAN 첫 작업의 가시성을 다시 검증했다.

## 2026-09-19 — 01:30 pane 적절성 반복 검증

- [x] PROJECT_BRIEF를 다시 읽고 Luna의 독립 무작위 상황 10종으로 실제 native TUI를 반복 평가한다.
- [x] 과잉 Docs/Terminal, 선택 Input 누락, 동일 원문 File 중복, 공유 메모 누락을 관찰하고 공통 정책·quiet 실행·ID 재사용을 수정한다.
- [x] 결과 focus 시 공간 확대, 배경 로그의 workspace 스크롤 방지, 모바일 활성 탭 가시성과 읽기 전용 Input 스크롤을 검증한다.
- [x] 실제 오류 로그/종료 코드와 원인 설명, 비밀값 없는 안전 안내, Browser 생성·클릭 확인·후속 정리, 두 문서 유지·단일 갱신을 재검증한다.
- [x] 39개 단위, 12개 브라우저, 실제 Docker 앱 2개, 실제 AI 통합 3개, Docker bridge, 18 SSE 관객/40 burst 부하 검증을 통과한다.
- [~] 모델의 응답 길이·추론 범위는 pane 선택과 별도로 평가한다. 임의 상황 전체의 적절성을 보장하는 것으로 간주하지 않는다.

실행별 실패와 개선, 무효 테스트 제외, desktop/mobile 캡처 및 남은 한계는 [pane 평가 기록](PANE_AUDIT.md)에 남긴다. 실제 운영 stage의 기존 pane과 작업 파일을 보존하며, 시연 앱은 확정하지 않는다.

## 2026-09-19 — 실제 샌드박스 앱 연결

- [x] Browser pane에서 React/Vite/Node HTTP 서버와 WebSocket/HMR에 연결한다.
- [x] 설치·테스트·서버는 인증 없는 앱 컨테이너에서 실행한다. 승인된 4개 포트만 loopback 매핑을 통해 연결한다.
- [x] 분리 origin, 세션 인증·쿠키 제거, 외부 redirect 차단, pane 닫기·세션 만료 시 연결 해제를 검증한다.
- [x] 검증용 React/Node/SQLite 예제로 두 관객의 데이터 공유, HMR 입력 유지, 모바일, 서버 재시작 후 데이터 유지와 중단을 확인한다.
- [x] 기존 내부망 주소에 적용하고 기존 정적 보드 pane을 보존한다. 시연 앱은 미정이며 검증 예제를 실제 stage에 올리지 않는다.

타입·린트·빌드·포맷, 단위 39개, 실제 Docker 2개, 기존 브라우저 10개, 실제 AI 앱 연결·원본 TUI 3개를 통과했다. 내부망 production에서 기존 pane 보존, 모바일 한글 입력, JavaScript 오류·가로 넘침 없음과 네 개 gateway의 인증 거부도 확인했다. 자세한 실행법과 경계는 [실제 앱 안내](LIVE_APPS.md)에 기록한다. 공개 인터넷과 물리 Android에서의 직접 검증은 범위 밖이다.

## 원본 TUI 전환 (현재)

- [x] 커스텀 채팅 대신 지속 실행되는 Antigravity PTY를 xterm 화면으로 연결한다.
- [x] 원본 입력·슬래시 메뉴·발언권·관객 권한·재접속·모바일 한글 입력과 공유 크기를 검증한다.
- [x] native hook과 기존 presentation bridge로 생성 Input, 실제 파일·명령 출력, 중단·초기화를 연결한다.
- [x] 내부망 production 서버에 적용하고 기존 보드 pane을 보존한다.

최종 단위 테스트 34개, 기존 브라우저 10개, 실제 AI TUI 시나리오 2개 통과. 자세한 확인 범위는 [TUI 안내](TUI.md)를 참고한다. 물리 Android 키보드 확인과 공개 배포용 격리는 남아 있다.

## 이전 headless 초안 완료 기록

- [x] 닉네임으로 입장해 공유 stage를 보고 선착순 발언권을 얻는다. 두 브라우저가 같은 상태를 보고, 30초 만료·재접속·권한 거부를 검증한다.
- [x] 프롬프트를 제출하고 presentation에 따라 Agent/Docs/Terminal/File/Input이 나타나는 로컬 리허설을 완주한다. 실제 고정 명령의 stdout/stderr를 스트리밍하고 생성 HTML 입력을 격리한다.
- [x] 모바일 Focus Mode와 관리자 운영을 완성한다. pane focus/resize/close, 발언권 회수, 작업 중단 및 workspace 초기화를 검증한다.
- [x] 격리된 Antigravity가 실제 프로젝트를 수정하고 공개 presentation 도구를 사용한다. 실제 브라우저에서 생성 Input 선택 → HTML·결과 파일 작성 → 검증 명령 stdout/stderr → 모바일 동기화 → 다음 turn의 대화 맥락 재개를 통과했다. 전용 Docker에서 작업 폴더와 Pado helper만 허용하며 전역 권한 우회는 사용하지 않는다.
- [~] 공개 데모를 준비한다. 22시 초안은 로컬까지만 진행한다. 외부 공개 전 전용 데모 계정, 네트워크/인증 정보/리소스 격리, Cloudflare Tunnel, 외부 desktop/mobile 동시 접속을 별도로 검증한다.
- [x] 핵심 기능 안정화 후 subagent 진행 시각화를 구현하고 시연한다. 실제 define/invoke/manage 이벤트로 Agent 영역에 위임 준비·작업·대기·종료를 표시하며, 실제 데스크톱·모바일 브라우저 검증을 통과했다. 내부 프롬프트, 대화 ID, 로그 경로는 공개하지 않는다. 종료 상태를 성공으로 해석하지 않는다.
- [x] 생성된 HTML 결과를 격리된 Browser pane에서 확인한다. 명시적인 presentation으로만 열며 각 관객의 조작은 로컬 미리보기 안에서 끝난다. 실제 AI가 생성한 앱의 폼 조작과 모바일 표시, 외부 form 전송 차단을 검증했다.

## 2026-09-18 검증

후속 공개 배포(2026-09-19)는 [PUBLIC_DEPLOY.md](PUBLIC_DEPLOY.md)에 기록한다. API 기반 DNS/Tunnel, loopback HTTPS proxy, 공개 참가자 prompt-only/CLI helper 정책, 컨테이너 egress 차단, origin별 preview 입장권/쿠키, user LaunchAgent 적용 및 실제 외부 desktop/mobile 확인 완료. 공개 모드는 subagent/직접 CLI 파일 도구를 제한하며 hard disk quota는 후속 과제다.

타입 검사, 린트, 빌드 및 테스트 25개 통과. 일반 브라우저 시나리오 10개 통과: 공유 stage, 모바일, 관리자, 입력 오류 복구, Markdown 안전 렌더링, 세션 만료 복구, HTML 격리, 로컬 form 동작과 외부 전송 차단, 드래그 리사이즈, 작은 높이 화면의 키보드 참여와 설정 저장. 실제 AI 브라우저 시나리오 4개를 최종 연속 실행해 모두 통과했다: 생성 입력 오류의 실제 수정, 컨테이너 중단과 다음 작업 시작, subagent 진행 표시, 파일 생성·명령 실행·입력·미리보기 조작·모바일 동기화·맥락 재개의 통합 흐름. production 파일 접근·응답 헤더·Origin 경계, 18개 동시 SSE 관객과 40회 출력 burst 부하 테스트도 통과했다.

실제 검증에서 CLI 권한 soft-denial의 성공 오인, HTML 명령줄 따옴표 손실, iframe의 로컬 폼 이벤트 차단을 발견해 회귀 테스트를 추가했다. Docker bridge smoke test는 UTF-8 stdout/stderr, terminal 종료, input 답변, 파일 기반 rich HTML 전달, 입력 오류 피드백 및 경로 경계를 검증한다. 공개 인터넷 접근은 테스트하거나 개방하지 않았다.

작은 높이 화면에서 참여 버튼이 pane 바깥으로 밀려나는 문제도 발견해 compact 레이아웃과 회귀 검증을 추가했다. 로컬 4173의 실제 production build에서 생성한 보드까지 6가지 viewport로 검증했다. [초안 안내](DRAFT.md)를 참고한다.
