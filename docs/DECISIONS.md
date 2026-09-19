# Decisions

## 2026-09-19 — 작업 기준 Context와 Review 연결

사용자가 구현 중 확인하고 싶은 것은 작업 순서보다 에이전트가 따르는 요청·합의·가정이다. 이를 별도 `context` pane에 짧은 Markdown 개요로 공개한다. 표·카드나 필수 Plan을 만들지 않으며, 단순한 구현은 요청 한 줄로 충분하다. 가정은 사용자 확인 전까지 합의로 취급하지 않고 실제 출처를 서술한다.

첫 공개와 갱신은 읽던 pane의 포커스를 바꾸지 않는다. 서버는 한 작업의 Context를 하나로 관리하고 작업 ID·변경 시각·종료 상태를 부여한다. 마지막 기준은 완료 Review로 넘기며 접어서 다시 읽을 수 있게 한다. 다른 ID의 Review도 현재 작업의 Context를 대체하지만 과거 작업의 기준은 연결하지 않는다. 중단이나 보고 없는 종료를 검증 성공으로 바꾸지 않는다. 기존 Subagent 표시와 Review의 실제 실행 근거 규칙은 유지한다.

구현은 [작업 기준 안내](WORKING_CONTEXT.md)에 기록한다. 기존 제품 브리프는 보존한다.

## 2026-09-19 — Terminal TUI와 서버 시작 로그

중요한 명령을 공개하는 기존 기준을 유지하되 서버 시작·재시작도 포함한다. `serve`는 `--quiet` 여부와 관계없이 Terminal을 열고 HTTP 준비 확인 후에도 Browser와 함께 유지한다. 일반 내부 검사는 `exec --quiet`를 계속 지원한다.

실제 실행 argv와 workspace 상대 디렉터리를 서버가 기록하고, 고정된 명령 헤더와 읽기 전용 xterm 출력, 관측된 준비·종료 상태를 분리해 표시한다. 기본 출력은 중립색이며 프로세스의 ANSI 색상은 보존한다. 명령 프롬프트를 출력에서 추측하지 않으며 clipboard·링크·화면 제어 같은 escape sequence는 제거한다. 새 대화형 shell을 추가하지 않는다.

## 2026-09-19 — Terminal 출력 출처 강제

실제 stdout/stderr와 에이전트가 재작성한 로그가 같은 Terminal로 표시되는 결함을 수정한다. Terminal 생성·본문·종료 이벤트를 일반 presentation 및 관리자 HTTP API에서 제거하고 서버 내부 프로세스 콜백으로만 처리한다. `run`도 인증 없는 앱 컨테이너의 호스트 관측 경로를 사용하며 지정한 pane ID를 유지한다. 일반 작업 이벤트는 여전히 Terminal을 자동으로 열지 않는다.

실행 ID와 시작·종료 시각·종료 코드를 서버가 기록한다. 숨긴 로그는 계속 수집하되 포커스를 이동하지 않고, 이전 실행의 늦은 출력은 새 실행을 덮어쓸 수 없다. 대화 완료는 프로세스 완료가 아니다. 재시작 전 실행 중이던 로그는 종료 코드 미확인으로 처리하고 출처 메타데이터 없는 과거 Terminal은 복원하지 않는다. 출력은 명령이 실제 인쇄한 내용이라는 근거이며, 그 내용의 주장까지 검증했다는 뜻은 아니다. 고정 리허설은 이름과 부제로 계속 구분한다.

## 2026-09-18 — 첫 구현 범위

브리프의 첫 로컬 흐름을 React/TypeScript/Vite와 단일 Node 서버로 구현한다. DB 없이 메모리에 stage 상태를 보관하며 재시작하면 사라진다. SSE snapshot으로 재접속 시 전체 상태를 복구하고 명령은 인증된 HTTP POST로 받는다. 복잡한 양방향 프로토콜 없이 관객 동기화를 구현할 수 있다.

서버가 30초 발언권을 원자적으로 배정한다. 대기열은 없다. 실행 중에는 다음 발언권을 주지 않는다. Input 답변은 작업을 시작한 참가자와 관리자만 제출하며 공개 상태에는 답변 값을 넣지 않는다.

## Presentation / execution 경계

pane.upsert / pane.close / pane.focus / pane.resize / terminal.append / terminal.exit / agent.message로 공개 화면을 관리한다. CLI의 파일 읽기·쓰기 이벤트는 pane을 열지 않는다. 생성 HTML은 opaque-origin iframe에서 실행하며 popup 및 same-origin 권한을 주지 않는다. `allow-scripts allow-forms`로 로컬 JavaScript submit 이벤트를 지원하되 `form-action 'none'` CSP로 실제 전송·form navigation을 차단한다. CSP로 fetch와 일반 외부 리소스 접근을 제한하지만 iframe 자체 navigation 등 모든 유출 경로를 차단하지는 않으므로 비밀값 입력을 허용하는 범용 sandbox로 간주하지 않는다. 메시지는 iframe source와 일회성 nonce로 식별한다.

리허설은 명확히 표시된 고정 시나리오이며 AI 응답으로 표시하지 않는다. Terminal은 실제 Node 자식 프로세스 출력이다. Antigravity 연결은 별도 인증된 Docker 컨테이너만 허용하고 사용자 홈, Docker socket, host credential을 마운트하지 않는다. 공개 URL은 아직 만들지 않는다.

## Antigravity 세션 수명

turn마다 컨테이너와 presentation bridge를 분리하되 성공한 conversation ID를 다음 요청에 전달한다. stage 초기화와 실행 실패는 해당 ID를 지우며 작업 파일과 인증 volume은 유지한다. 이전 컨테이너의 종료 확인과 출력 처리를 마쳐야 다음 작업을 허용한다. 종료를 확인하지 못하면 새 작업을 차단한다.

최종 stream-json 결과와 명시적인 presentation만 공개한다. 인증 요구나 권한·실행 오류는 분류된 안내로 바꾸고 원시 CLI 진단은 관객에게 보내지 않는다. 터미널 종료 상태는 별도 이벤트로 전달한다. 자동 테스트의 모의 프로세스 검증과 실제 인증된 AI 작업 검증은 구분해 기록한다.

CLI 1.2.6은 headless 도구 권한을 soft-deny한 뒤에도 `SUCCESS` 및 exit 0을 반환할 수 있음을 실제로 확인했다. 따라서 인증·권한 거부 진단은 성공 envelope보다 우선한다. 실제 AI 브라우저 테스트는 명시적 opt-in 명령으로 분리하고 실행별 작업 디렉터리를 사용해 기존 작업 파일을 덮어쓰지 않는다.

HTML은 JSON 파일을 통해 helper에 전달한다. 입력 오류를 비공개 bridge로 돌려줘 수정·재게시를 지원한다. 이전 공개 결과는 다음 turn이 시작돼도 유지하며, agent/admin의 명시적 pane.close나 reset으로 닫는다. CLI progress는 정해진 작업 종류와 검증된 subagent 상태만 표시하고, 내부 프롬프트·대화 ID·로그 경로는 버린다. 위임 도구의 DONE은 위임 등록 완료일 뿐 하위 작업 성공이 아니므로 작업 중/대기/종료를 구분한다.

22시 초안은 로컬 실사용 가능 흐름에 집중한다. 공개 URL 생성과 호스트 접근 확대, GitHub 푸시는 범위 밖이다. 초기화 스킬은 종료했으며 추가 구현은 브리프와 사용자의 자율 개발 지시를 따른다.

## 2026-09-18 — WireGuard 내부망 접근

사용자가 Android에서 WireGuard로 내부망 접속 중임을 확인하고 LAN 접근을 요청했다. 서버의 `PADO_BIND_HOST`를 설정 가능하게 하고 현재는 Mac의 확인된 LAN IP `<LAN_IP>`에만 바인딩한다. 허용 origin도 `http://<LAN_IP>:4173`으로 일치시킨다. 실제 내부 IP는 문서에서 생략한다. wildcard Host/Origin, 공개 tunnel, 공유기 포트 포워딩은 사용하지 않는다. 재시작 전 공개 pane을 보관하고 복원하며 작업 파일은 유지한다. 서버 재시작으로 기존 세션과 에이전트 대화 맥락은 새로 시작한다.

일반 HTTP 내부 IP는 브라우저의 secure context가 아니므로 Input nonce는 `crypto.randomUUID` 대신 `crypto.getRandomValues`의 128비트 난수로 만든다. UUID API가 없는 환경의 생성 Input 흐름도 회귀 테스트로 검증한다. 내부망에서 생성 작업을 요청할 수 있으므로 신뢰할 수 있는 LAN/WireGuard 사용자에게만 허용한다.

## 2026-09-18 — 커스텀 채팅을 원본 TUI로 교체

사용자가 원한 Agent pane은 Antigravity의 원본 TUI다. headless stream-json을 별도 React 채팅으로 재구성한 방향을 수정한다. 이전의 turn별 컨테이너·conversation resume 결정은 실제 UI 경로에서 폐기하고, 단일 장기 실행 Docker PTY + xterm 브라우저 화면으로 전환한다. 리허설 채팅만 기존 고정 시나리오를 유지한다.

CLI의 입력·슬래시 명령·승인·진행 화면은 그대로 전달한다. Pado는 인증과 단일 조작자 권한, 관객 공유 화면, 명시적 presentation pane만 관리한다. 별도 대화 사본이나 가짜 진행 카드를 만들지 않는다. 내부 파일 작업이 별도 pane을 자동 생성하지 않는 원칙은 유지한다.

재접속은 headless xterm의 전체 terminal buffer snapshot으로 복구하며 raw byte stream은 별도 SSE로 전달한다. `PreInvocation`/`Stop fullyIdle` hook으로 turn 시작·완료를 판단하고 화면 문구를 추측해 완료 처리하지 않는다. 도구 승인과 선택은 native TUI에서, 생성 Input은 기존 격리 iframe과 bridge에서 처리한다.

전용 로그인 volume을 읽기 전용으로 유지하고, 사용자 onboarding 결과 및 토큰만 tmpfs 프로필로 복사한다. CLI가 설정을 atomic rename으로 저장하므로 settings 파일 자체를 읽기 전용 bind-mount하는 방식은 사용하지 않는다. 로그인을 대신 수행하거나 새 약관에 동의하지 않는다.

## 2026-09-19 — 실제 샌드박스 앱 연결

정적 HTML만으로는 실제 프로젝트 개발을 시연할 수 없다는 사용자 피드백에 따라 Browser pane에 실제 HTTP/WS 서버 연결을 추가한다. 앱은 에이전트 인증이 없는 별도 컨테이너에서 실행하고 작업 폴더만 공유한다. 검증된 helper 요청을 호스트가 Docker argv로 실행하며 임의 호스트 URL이나 호스트 shell 실행은 허용하지 않는다.

앱 포트 3000/3001/5173/8080을 loopback에만 publish하고, Pado와 다른 origin의 인증된 gateway에서 HTTP·WebSocket을 전달한다. Pado 쿠키는 앱에 전달하지 않으며, live iframe에만 분리 origin 전제로 allow-same-origin을 허용한다. 기존 srcdoc/Input의 opaque origin은 유지한다. 실제 앱은 turn 완료 후에도 유지하고 중단·초기화 시 함께 종료한다. workspace 저장 파일은 유지한다. 상세 경계와 사용법은 [실제 앱 안내](LIVE_APPS.md)에 기록한다.

사용자는 시연 프로젝트 선택을 뒤로 미루고 서버 연결부터 완성하기로 했다. React/Node/SQLite 질문 보드는 별도 테스트 workspace에서만 사용하는 검증 예제이며 실제 시연 stage에 올리거나 최종 앱으로 확정하지 않는다.

## 2026-09-19 — 필요한 pane의 판단과 수명

실제 TUI 무작위 평가에서 단순 계산도 Docs/Terminal로 출력하고, 선택 요청은 Docs만 열거나, 같은 원문을 File 두 개로 공개하는 문제가 관찰됐다. pane 수를 일괄 제한하거나 특정 프롬프트에 UI를 하드코딩하지 않고 공통 presentation 기준을 강화한다. 내부 검사는 `exec --quiet`로 실제 결과를 받되 공개 pane을 만들지 않고, 사용자가 실제 로그·종료 결과를 검토해야 하면 공개 Terminal 하나를 사용한다. Input은 실제 응답을 기다리고, 공유 메모·기존 결과는 보존하며, 종료된 임시 결과만 정리한다.

UI는 Agent와 결과의 공간 비율을 현재 focus에 맞추고, 해당 pane을 보이는 범위로 이동한다. Terminal 내부 스크롤이 workspace를 끌고 가지 않게 한다. Input 관객은 긴 내용을 스크롤할 수 있지만 컨트롤·bridge 제출은 비활성이다. 부모 메시지 검사와 서버 역할 검사가 최종 권한 경계이며 iframe의 DOM 비활성만을 보안 장치로 믿지 않는다.

생성 콘텐츠는 짧고 근거 중심이어야 한다. 정해진 올바른 pane 종류가 나왔더라도 내용이 지나치게 길거나 확인되지 않은 원인을 사실로 제시하면 부분 성공/실패다. 평가 기준과 반복 결과는 [pane 평가 기록](PANE_AUDIT.md)에 보존한다.

## 2026-09-19 — 교체 가능한 시연 베이스

사용자가 해커톤 운영 도구를 임시로 만들되 나중에 바꿀 수 있다고 지정했다. `examples/hackathon-ops`에 독립적인 브리프·작업 목록·결정 기록과 팀 등록/질문 접수 앱을 둔다. 실제 workspace에는 새 `hackathon-ops` 하위 폴더로만 복사하고 기존 `다음 아이디어` 산출물을 보존한다. Pado 원본 브리프의 “Demo project 미정”은 최종 주제를 확정한 것이 아니므로 수정하지 않는다.

`vibe-project` 방식으로 문서만 만들고 멈추지 않고 첫 입력→검증→SQLite 저장→공유 조회까지 검증한다. 공개 범위·운영자 권한·질문 우선순위는 실제 후속 결정으로 남기며, 모든 pane을 억지로 띄우는 전용 시연 로직은 넣지 않는다. 최초 버전은 공동 열람·가상 데이터용이고 실제 행사 서비스나 인증된 팀 계정 시스템이 아니다.

## UI

### 2026-09-19 — Tasks는 작업 검토 전용

사용자가 작업 언급에 맞춰 목록을 볼 수 있는 Tasks pane을 요청했다. 기존 Docs와 별도 `kind: tasks`로 추가하고 실제 TASKS/backlog의 명시적인 체크리스트 상태를 표시한다. 상태 편집 컨트롤이나 새로운 작업 DB는 만들지 않는다. 원문은 에이전트가 변경하고 같은 presentation ID로 다시 공개한다. 목록 순서로 다음 작업을 추정하지 않으며 `[>]`가 없으면 미선택, 여러 개면 충돌을 표시한다.

“작업 관련 언급”은 작업 현황·남은 일·우선순위·다음 작업을 검토하는 의도로 해석한다. “작업해줘” 같은 일상적인 구현 요청마다 열거나 파일 읽기에 자동 반응시키지 않는다. 정책과 선택지 설명은 Docs, 실제 결정은 Input, 원문/diff 검토는 File을 유지한다. [활용 안내](PANES.md)에 자연어 예시와 예외를 기록한다.

SEED Design의 명확한 위계와 접근성, dark surface를 참고하되 Pado의 밝은 blue와 split workspace를 사용한다. Desktop은 agent rail + 가변 pane 영역, mobile은 pane tab 기반 Focus Mode다. 관객의 모바일 탭 선택은 로컬 상태이며, agent의 focus 변경은 모든 화면에 전달한다. 관리자만 공유 레이아웃을 변경한다. 모션 감소 설정을 존중한다.

### 2026-09-19 — Subagent는 서버가 관리하는 임시 pane

사용자 요청에 따라 실제 위임마다 `kind: subagent` pane을 자동 생성한다. 일반 presentation의 `pane.upsert`로는 만들 수 없고, 내부 파일·명령 이벤트가 File/Terminal pane을 만드는 기존 금지 규칙은 유지한다. 서버가 검증한 이름·실행 상태·시각만 공개하고, 종료 상태를 3초간 보여준 뒤 SSE 상태에서 제거한다. 재개는 기존 닫힘을 취소하며 중복 종료는 시간을 연장하지 않는다. 오류·중단·초기화·이전 turn의 늦은 이벤트도 처리한다.

Subagent pane은 일반 artifact 6개와 별도로 동시에 최대 8개를 표시한다. 모든 관객이 동일한 생성·종료 상태를 받고, 브라우저는 서버 시각을 기준으로 종료 애니메이션만 실행한다. 응답 완료와 실행 종료는 구분하며 작업 성공을 추정하지 않는다.

후속 사용자 피드백으로 상태 카드를 읽기 전용 xterm TUI로 교체한다. 원본 CLI를 자식마다 추가 실행하지 않고 컨테이너 내 실제 자식 transcript에서 공개 응답과 도구 이름만 제한적으로 추출한다. 내부 추론/프롬프트/원시 도구 출력은 제외한다. hook과 observer가 서로 다른 ID를 만들어 동일 자식의 pane이 2개 생기던 문제는 제출 토큰+실제 대화 ID의 동일 해시 및 서버 이름 배정으로 수정한다. 직접 실행 hook을 우선하여 늦은 observer 이벤트가 완료 상태를 되돌리지 않도록 한다. 출력은 원자적으로 교체되는 크기 제한된 최신 snapshot과 현재 프로젝트/turn 검증을 거쳐 전달하며, 완료 후 남은 3초 동안 최종 출력 갱신은 가능하지만 pane 생성/재오픈/기한 연장은 불가능하다.

## 2026-09-19 — 프로젝트별 공유 workspace와 turn 중심 창 관리

사용자가 프로젝트를 바꾸면 관객도 함께 이동하는 공유 stage를 선택했다. 프로젝트별 파일·pane·저장 artifact·원본 TUI 대화 DB와 식별자·앱 실행 명령을 분리한다. 동시에 하나의 TUI/앱만 활성화하며, idle/발언권 없음일 때 관리자만 전환한다. 기존 `.pado/workspace`는 이동·복사·삭제 없이 첫 프로젝트로 채택한다. 프로젝트 이름이 호스트 경로를 결정하지 않는다.

이전의 “turn이 바뀌어도 모든 공개 결과를 계속 표시” 정책은 사용자의 최신 지시에 따라 대체한다. 새 turn 시작에는 artifact를 저장한 뒤 접고 Agent로 집중한다. 필요해지면 같은 ID의 `pane.show`로 복원하거나 실제 원문을 읽어 갱신한다. focus/show는 앞으로 이동·확대하고, Tasks 갱신과 웹 결과 handoff에 실제 창 조작을 사용한다. 파일 삭제·서버 종료와 창 정리는 별개다. Input/Subagent는 저장 복원하지 않는다.

CLI ID만 저장한 첫 대화 복원 검증은 실패했다. 컨테이너 tmpfs가 없어지면서 실제 SQLite 대화 DB도 사라졌기 때문이다. 프로젝트별 `cli/{conversations,brain,cache}`만 보존하고 인증 토큰·설정·hook은 계속 임시 프로필에 둔다. 실제 A→B→A에서 파일에 남기지 않은 표식 기억과 같은 conversation ID, 앱 재연결, Tasks의 전면 확대를 재검증했다. 생성 Browser 중복도 발견해 serve helper의 기존 ID 재사용을 명시했다.

gateway origin은 프로젝트마다 별도 4개 포트를 사용한다. 쿠키는 포트로 분리되지 않으므로 서버 쿠키에 프로젝트별 이름과 HttpOnly를 적용한다. 공유 프로젝트는 비공개 사용자별 테넌트가 아니다. 상세 사용·경계는 [workspace 안내](WORKSPACES.md)에 기록한다.

## 2026-09-19 — 시크릿 Input과 프로젝트 환경변수

사용자가 해커톤 범위에서는 비밀값의 기술적 접근 차단보다 입력·설정 편의를 우선하기로 했다. 생성 HTML과 별도로 Pado가 password 필드를 제공하고, 값을 프로젝트의 workspace 밖에 평문 0600 파일로 저장한다. 일반 입력 bridge에는 보내지 않으며 에이전트의 wait 응답은 변수 이름과 설정 여부뿐이다. 현재 turn의 요청자/관리자 권한과 프로젝트 일치 여부를 검사한다.

앱/테스트 실행은 `--secrets NAME`으로 필요한 이름만 지정하고, Pado가 Docker 자식 프로세스 환경을 통해 해당 앱 컨테이너에 값을 주입한다. 기본 실행과 Antigravity 컨테이너에는 주입하지 않는다. 기존 서버에는 재실행부터 반영한다. 프로젝트별 저장·전환·앱 복원에서 원문과 실행 명령 메타데이터를 분리한다. 실수로 출력된 원문의 정확한 일치는 가리지만, 앱 코드의 읽기·인코딩·유출을 차단하는 보안 경계라고 주장하지 않는다. API 중계/암호화 저장소/범용 권한 시스템은 이번 범위에서 제외한다. [사용법](SECRETS.md).

## 2026-09-19 — 개인 열람과 프로젝트별 상주 에이전트

사용자의 후속 결정으로 앞선 단일 TUI/앱 및 강제 공유 이동 정책을 대체한다. 프로젝트마다 StageStore·원본 TUI·앱 runtime·gateway를 유지하고 열람/참여 지정은 실행 수명과 분리한다. 서버 시작 시 저장된 세션과 앱 명령을 복원하되 새로운 로그 pane을 만들거나 focus를 바꾸지 않는다. 명시적으로 중단한 프로젝트만 멈추며 전체 서버 종료는 모든 소유 runtime의 종료를 확인한다. 브리프 원문은 보존하고 변경 근거를 여기 기록한다.

열람 프로젝트는 브라우저 탭별 sessionStorage와 명시적인 SSE/TUI 구독 ID로 구분한다. 기본 탭은 참여 지정을 따라가지만 직접 다른 곳을 선택한 탭은 그대로 남는다. 관리자는 별도 버튼으로 하나의 참여 프로젝트를 지정하며 현재 turn/발언권/제출 hook 대기/진행 중 변경 요청 중에는 지정을 바꾸지 못한다. 비활성 프로젝트는 관리자도 TUI 입력·resize·Input·pane 변경·중단/초기화를 할 수 없다. 앱 gateway도 GET/HEAD/OPTIONS 외 요청 및 WebSocket을 거부한다. HTTP 메서드 기반 보호이며 앱의 잘못된 GET 부작용/백그라운드 실행까지 동결하는 것은 아니다.

실제 Docker 검증에서 TUI 3개와 앱 3개를 동시에 실행하고 A→B→C→A 후 epoch·프로젝트별 입력 초안·앱 상태가 유지됨을 확인했다. TUI SSE 혼선 없음, 관리자 비활성 입력 거부, 한 프로젝트만 중단, 전체 서버 종료 시 테스트 소유 6개 runtime 종료도 확인했다. 검증은 AI 요청 없이 CLI 입력 초안만 사용했다. 빈 TUI 3개의 관측 메모리는 총 약 0.6~0.7GiB였으며 앱·대화 크기에 따라 증가하므로 보장치가 아니다. 재현: `PLAYWRIGHT_BROWSERS_PATH=.cache/playwright pnpm exec tsx --env-file-if-exists=.env tests/project-sessions.smoke.ts`.

## 2026-09-19 — 닉네임 공개와 Cloudflare API 배포

사용자가 초대제 대신 격리 보완 후 닉네임 공개를 선택했고 브라우저 로그인 대신 제공한 제한 API 토큰 사용을 요청했다. Pado용 named Tunnel을 별도로 만들고 Naru는 변경하지 않았다. 실제 공개 도메인은 문서에서 생략한다. Pado는 loopback 4173, 앱 gateway는 프로젝트/승인 포트별 별도 첫 단계 HTTPS hostname을 쓴다. main 쿠키를 sibling 앱에 공유하지 않고 fragment 일회용 입장권을 host-only preview 쿠키로 바꾼다.

공개 참가자가 CLI 권한 메뉴를 조작하지 못하도록 prompt-only 입력을 사용한다. 인증된 CLI의 모든 파일·코드 실행을 고정 helper 경유 credential-free app runner로 제한하고, 하위 CLI의 hook 상속이 보장되지 않는 subagent도 공개 모드에서는 막는다. 설정 파일 전체 read-only는 실제 CLI 초기 저장을 깨뜨렸으므로 세션 tmpfs 설정은 쓰기를 허용하고 정책 hook만 read-only로 유지한다. 악의적 입력의 실제 직접 명령 deny와 앱 실행 allow를 native CLI로 검증했다. local 모드는 기존 기능을 유지한다. 운영 한계와 실제 배포 증거는 [PUBLIC_DEPLOY.md](PUBLIC_DEPLOY.md)를 따른다.

## 2026-09-19 — 신뢰한 해커톤 참가자의 원본 CLI 복구

사용자가 6시간 동아리 해커톤에서는 프롬프트 form보다 직접 CLI 조작을 선호한다고 정정했다. `PADO_PARTICIPANT_TUI=1`을 별도 opt-in으로 도입해 발언자·현재 작업 요청자의 원본 TUI 입력과 모바일 보조 키를 복구한다. 입력 정책과 `PADO_PUBLIC_MODE` 네트워크/컨테이너 격리는 분리하며, spectator·만료된 발언자·비참여 프로젝트의 쓰기 차단은 유지한다. 기본 공개 입력은 여전히 prompt-only로 되돌릴 수 있다.

직접 CLI는 인증된 도구의 메뉴·파일 첨부를 다루므로 참가자를 신뢰하는 운영 결정이다. 컨테이너가 내부 CLI 인증정보까지 사용자에게 숨긴다고 주장하지 않는다. 동아리 인증이나 6시간 후 자동 차단을 새로 추가한 것은 아니며 운영자가 행사 종료 시 Tunnel을 maintenance로 전환한다.

## 2026-09-19 — 해커톤 공개 데모의 Subagent 허용

사용자가 해커톤 데모에서 Subagent를 허용하라고 명시했다. `PADO_PUBLIC_SUBAGENTS=1`일 때 `define_subagent`, `invoke_subagent`, `manage_subagents`, `send_message`를 공개 정책에서 허용한다. 공개 hook에도 기존 Subagent의 PostToolUse 관측을 연결하고 자식 작업에 helper 사용 지침을 전달한다. 기본 공개 모드는 계속 차단하며, 이 opt-in은 Docker/네트워크 격리나 나머지 파일·명령 제한을 끄지 않는다. 실제 위임·앱 파일 생성·pane 출력·완료 후 닫힘은 별도 workspace의 `pnpm test:public-subagent`로 검증한다.

## 2026-09-19 — 실제 명령 결과 대기를 Terminal 표시 기준으로 사용

사용자가 에이전트가 결과를 기다리는 터미널 작업은 보여주고 서버 시작 로그는 유지하도록 결정했다. 기본 exec/run은 검증된 native 대기 상태와 같은 실제 실행이 연결될 때만 공개한다. 단순 실행 중·추론·다른 작업·Input 대기는 새 pane의 근거가 아니다. 도구 반환 hook과 Stop fullyIdle를 함께 사용하고, 원시 native 로그 대신 기존 앱 runtime 출력을 표시한다. 내부 파일 작업은 --quiet, 명시적인 로그 요청은 --show로 구분한다. 판정 실패 시 추측하지 않고, 이미 열린 로그는 종료 증거와 사용자의 닫기 선택을 유지한다. [세부 규칙과 한계](WAITING_TERMINALS.md).

관리자 비밀번호는 재시작 중 드러난 기존 짧은 값을 사용자 요청에 따라 유지한다. `PADO_DEMO_SHORT_ADMIN_PASSWORD=1`은 이번 데모의 최소 길이 검사만 예외로 두며 로그인 인증을 제거하지 않는다. 기본값은 계속 16자 이상을 요구한다.

## 확인한 공식 자료

- [Antigravity headless stream](https://antigravity.google/docs/cli/headless/)
- [Antigravity installation and auth](https://antigravity.google/docs/cli/install)
- [SEED theming](https://seed-design.io/react/getting-started/styling/theming)
- [Vite guide](https://vite.dev/guide/)
