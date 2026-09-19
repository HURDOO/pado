# PROJECT_BRIEF: <Pado>

> 새 프로젝트의 목적과 첫 번째 완성 범위를 정리하는 문서입니다. 아직 정하지 못한 항목은 `미정`으로 두고, 아는 내용부터 작성하세요.

## 1. 프로젝트 한 줄 소개

Pado는 바이브코딩 사용자를 위해, 에이전트가 현재 작업에 필요한 인터페이스만 동적으로 생성·배치해주는 Generative UI 기반 ADE(Agent Development Environment)다.

## 2. 배경과 문제

- 현재 겪는 문제:
  - 기존 AI 코딩 도구는 에이전트가 대부분의 구현을 수행하더라도 파일 트리, 코드 에디터, 터미널 등 전통적인 IDE 구조를 그대로 유지한다.
  - 현재 ADE들은 대개 정적인 레이아웃을 가지고 있으며, 이는 원격 코딩이 활성화된 현대의 바이브코딩 트렌드와 동떨어져 있다.
  - 반대로 환경변수 입력, 결과 화면 확인, 계약 문서 변경 확인 등 사용자가 실제로 개입해야 하는 순간에는 적절한 인터페이스가 자동으로 제공되지 않는다.
- 이 문제가 중요한 이유:
  - 바이브코딩에서는 사용자의 역할이 직접 코드를 작성하는 것보다 요구사항을 전달하고, 판단하고, 필요한 정보를 제공하고, 결과를 검토하는 쪽으로 이동하고 있다.
  - 따라서 에이전트 중심 개발 환경은 코드 중심 IDE, 정적인 인터페이스가 아니라 사용자와 에이전트 사이의 상호작용을 중심으로 설계될 필요가 있다.
- 지금 사용하는 대안과 그 한계:
  - 기존 IDE/ADE는 Editor, Terminal, Chat, Preview 등의 pane을 고정적으로 배치하거나 사용자가 직접 관리한다.
  - AI가 코드를 자동으로 작성하더라도 인터페이스 자체는 현재 작업이나 사용자의 필요에 따라 크게 달라지지 않는다.

## 3. 대상 사용자

- 주요 사용자:
  - Antigravity CLI, Codex 등 코딩 에이전트를 이용해 바이브코딩을 하는 사용자
- 사용자의 상황과 숙련도:
  - 직접 모든 코드를 작성하기보다 에이전트에게 구현을 맡기고 결과를 검토하는 사용자
  - 개발 경험은 있을 수도 있고 없을 수도 있으나, 코드 수정 과정을 계속 관찰하고 싶지는 않은 사용자
  - 데스크톱뿐 아니라 모바일에서 원격으로 에이전트의 진행 상황을 확인하거나 간단한 상호작용을 할 수 있다.
- 가장 중요한 사용자 요구:
  - 에이전트가 내부적으로 무엇을 하는지보다 지금 자신이 확인하거나 입력하거나 결정해야 할 내용을 명확하게 보고 싶다.
  - 작업에 따라 불필요한 UI를 직접 정리하거나 배치하지 않아도 되기를 원한다.
  - 데스크톱이 아닌 환경에서도 현재 작업 상태를 이해하고 필요한 개입을 수행할 수 있어야 한다.

## 4. 목표와 성공 기준

### 목표

- 에이전트의 내부 작업과 사용자에게 보여주는 인터페이스를 분리한다.
- 에이전트가 현재 상황에 따라 필요한 pane을 직접 열고, 닫고, 크기를 조정할 수 있도록 한다.
- 공개 데모의 일반 참가자는 shared workspace의 pane layout을 직접 변경하지 않는다. 동일한 화면을 모두가 공유해야 하기 때문이다.
- 관리자는 필요할 경우 에이전트를 대신해 pane을 직접 생성·삭제·focus·resize할 수 있다.
- 코드 중심 IDE가 아닌 사용자-에이전트 상호작용 중심 ADE의 가능성을 짧은 데모로 명확하게 보여준다.
- 여러 해커톤 참가자가 하나의 공개 웹 데모에 접속해 직접 프롬프트를 제출해볼 수 있게 한다.
- 데스크톱에서는 충분한 workspace 경험을 제공하면서, 모바일에서도 관람·발언권 신청·프롬프트 작성과 주요 상호작용이 가능하도록 한다.

### 성공 기준

- [ ] Antigravity CLI가 실제로 프로젝트 작업을 수행할 수 있다.
- [ ] Antigravity가 파일을 읽거나 수정해도 자동으로 File pane이 열리지 않는다.
- [ ] Antigravity가 필요하다고 판단하면 Terminal, File, Docs, Input 등의 pane을 사용자에게 표시하기 위해 열 수 있다.
- [ ] 관리자가 같은 workspace에서 pane을 직접 생성·삭제·focus·resize할 수 있다.
- [ ] 일반 spectator의 pane 조작은 shared layout을 변경하지 않는다.
- [ ] 열린 pane의 생성, 삭제, focus, resize가 부드러운 animation과 함께 실제 화면에 반영된다.
- [ ] Antigravity가 실행하는 terminal command의 stdout/stderr가 실행 중 실시간으로 Terminal pane에 표시된다.
- [ ] 여러 사용자가 동시에 동일한 workspace를 실시간으로 볼 수 있다.
- [ ] Raise Hand를 가장 먼저 누른 한 명에게만 발언권이 부여된다.
- [ ] 관리자가 현재 발언자의 발언권을 언제든 회수할 수 있다.
- [ ] 모바일 브라우저에서도 현재 workspace와 agent 진행 상황을 확인하고 발언권을 신청할 수 있다.
- [ ] 모바일에서 각 pane을 한 화면에 집중해서 볼 수 있고 pane 사이를 전환할 수 있다.
- [ ] 외부 네트워크에서 공개 URL로 접속할 수 있다.

### 이번 범위에서 하지 않을 일

- 완전한 IDE 또는 VS Code 대체 제품 개발
- 코드 에디터를 메인 인터페이스로 제공
- 사용자마다 독립적인 개발 환경 제공
- 여러 Antigravity 세션 동시 실행
- 범용 클라우드 개발환경 구축
- 장기적인 사용자 데이터 저장
- Naru의 기존 기능 전체 재구현
- 완전한 모바일 개발 환경 제공
- Browser preview를 위해 전체 MVP 안정성을 희생하는 일
- desktop에서 완전한 자유 배치 Windows-style window manager 구현
- 일반 spectator가 shared workspace layout을 직접 변경하는 기능
- 발언권 대기열(queue) 운영

## 5. 첫 번째 사용 가능 버전(MVP)

### 핵심 기능

1. Antigravity가 작업 상황에 따라 `Agent`, `Terminal`, `File`, `Docs`, `Input` pane을 생성·삭제·resize·focus할 수 있는 Generative Workspace
2. Antigravity CLI의 실제 작업 실행과 Pado의 UI presentation action을 분리하는 구조
3. Antigravity CLI의 command 실행 과정과 stdout/stderr를 Pado의 Terminal pane에 실시간으로 스트리밍하는 기능
4. 여러 사용자가 하나의 workspace를 실시간으로 보고, turn마다 선착순 한 명이 발언권을 얻어 프롬프트를 제출하는 Stage Mode
5. 모바일에서 한 번에 하나의 pane을 화면 전체에 집중 표시하고 다른 pane으로 쉽게 전환할 수 있는 Focus Mode
6. 관리자가 일반 workspace 안에서 pane 및 Stage Mode 상태를 직접 제어할 수 있는 Admin Mode
7. 핵심 MVP 완료 후 Antigravity subagent를 Generative Workspace에 시각화하는 기능 구현 시도

### 대표 사용 흐름

1. 사용자가 Pado의 공개 웹페이지에 접속한다.
2. 최초 접속 시 nickname을 입력한다.
3. 관리자는 동일한 진입 화면에서 관리자 인증을 추가로 수행해 Admin Mode로 접속할 수 있다.
4. 모든 사용자는 현재 진행 중인 shared workspace를 본다.
5. 현재 Antigravity turn이 종료되면 `Raise Hand`가 활성화된다.
6. 가장 먼저 `Raise Hand`를 누른 한 명에게 즉시 발언권이 부여되고 다른 참가자의 신청은 닫힌다.
7. 선정된 사용자는 약 60초 안에 프롬프트를 작성한다.
8. 관리자는 필요할 경우 언제든 현재 사용자의 발언권을 회수할 수 있다.
9. 발언권이 회수되거나 제한 시간 내 프롬프트를 제출하지 못하면 다시 `Raise Hand`를 활성화한다.
10. 시스템이 제출된 프롬프트를 Antigravity CLI에 전달한다.
11. Antigravity는 파일 탐색, 코드 수정, shell 실행 등의 작업을 뒤에서 수행한다.
12. 일반적인 파일 읽기·코드 수정 과정은 사용자에게 노출되지 않는다.
13. shell command 실행을 보여줄 가치가 있는 경우 Terminal pane을 생성하고 stdout/stderr를 실시간으로 표시한다.
14. 사용자의 입력이 필요하면 자유형 Input pane을 생성하고, 계약·명세·계획 등의 확인이 필요하면 Docs pane을 표시한다.
15. 필요가 없어진 pane은 Antigravity가 축소하거나 닫는다.
16. 관리자는 필요할 경우 Antigravity의 판단을 override하여 pane을 직접 조작할 수 있다.
17. 작업이 끝나면 결과를 모든 접속자가 확인하고 다시 `Raise Hand`를 활성화한다.

### 완료 조건

- [ ] 핵심 사용 흐름을 처음부터 끝까지 수행할 수 있다.
- [ ] 실제 Antigravity CLI가 최소 한 번 이상의 개발 작업을 성공적으로 완료한다.
- [ ] 한 작업 중 최소 2종류 이상의 pane이 상황에 따라 동적으로 생성되거나 재배치된다.
- [ ] Antigravity의 일반적인 파일 읽기·수정 과정은 사용자 UI에 노출되지 않는다.
- [ ] shell command의 실행 상태와 stdout/stderr가 Terminal pane에 실시간으로 반영된다.
- [ ] pane layout 변화가 끊기거나 순간이동하는 느낌 없이 자연스러운 animation으로 표현된다.
- [ ] 관리자가 agent와 동일한 layout control API를 통해 pane을 직접 조작할 수 있다.
- [ ] 2개 이상의 브라우저에서 동일 workspace 상태가 동기화된다.
- [ ] 데스크톱과 모바일 브라우저가 동시에 같은 세션을 정상적으로 관람할 수 있다.
- [ ] 모바일에서 현재 열린 pane 사이를 Focus Mode로 전환할 수 있다.
- [ ] 동시에 여러 사용자가 Raise Hand를 눌러도 서버가 원자적으로 한 명에게만 발언권을 부여한다.
- [ ] 관리자가 현재 speaker의 발언권을 즉시 회수할 수 있다.
- [ ] 관리자 조작으로 demo 환경을 초기 상태로 되돌릴 수 있다.
- [ ] 위 기능이 모두 안정화된 후 subagent 시각화를 최소 한 번 구현 시도한다.

## 6. 화면과 콘텐츠

- 필요한 화면 또는 주요 영역:
  - Entry / Nickname 화면
  - Shared Workspace
  - Agent pane
  - Terminal pane
  - File pane
  - Docs pane
  - Input pane
  - Raise Hand UI
  - 모바일 Focus Mode / Pane Switcher
  - Admin Control Strip
  - Settings sheet
  - Browser pane은 구현 여유가 있을 경우 추가
  - Subagent pane/status UI는 마지막 단계에서 구현 시도

- 각 화면에서 사용자가 할 수 있는 일:
  - Entry:
    - nickname 입력
    - 관리자인 경우 관리자 인증
  - Agent:
    - 현재 작업 상태와 사용자에게 필요한 설명 확인
  - Terminal:
    - Antigravity가 수행하는 명령 중 사용자에게 보여줄 가치가 있는 실행 과정과 stdout/stderr를 실시간으로 확인
  - File:
    - 사용자가 직접 확인하거나 수정해야 하는 파일 내용 확인
  - Docs:
    - 계약, 명세, 계획 등의 변경 사항 확인
  - Input:
    - 환경변수, secret, 선택지, slider, radio, text area 등 상황에 맞는 자유로운 입력 UI 사용
  - Stage Mode:
    - 발언권이 비어 있을 때 Raise Hand
    - 선착순 획득 여부 확인
    - speaker로 선정된 경우 프롬프트 작성
  - Mobile Focus Mode:
    - 현재 선택한 pane 하나를 화면 대부분 또는 전체에 표시
    - 현재 활성 pane 목록을 확인하고 다른 pane으로 전환
  - Admin:
    - pane 생성
    - pane 삭제
    - pane focus
    - pane resize
    - 현재 speaker의 발언권 회수
    - 필요 시 직접 발언권 상태 변경
    - 현재 turn 종료
    - prompt reject
    - checkpoint 복원
    - demo reset
    - 기타 드물게 사용하는 옵션은 Settings에서 조정
  - Browser:
    - 구현할 경우 에이전트가 만든 웹 결과물을 iframe으로 직접 확인

- Input pane:
  - 단순한 고정 form schema에 제한하지 않는다.
  - Antigravity가 상황에 맞는 input UI를 자유롭게 구성할 수 있게 한다.
  - MVP에서는 HTML 기반 UI를 허용하되, 메인 Pado DOM에 임의 HTML을 직접 삽입하지 않는다.
  - 생성된 HTML은 sandboxed iframe 또는 이에 준하는 격리 환경에서 렌더링한다.
  - 입력 결과는 제한된 message/API를 통해 Pado backend와 agent에 전달한다.
  - 이를 통해 text, password, textarea, select, checkbox, radio, range 등 다양한 input pattern을 지원한다.

- 참고할 서비스, 이미지, 문구 또는 링크:
  - 기존 Naru의 pane 기반 workspace 개념
  - Antigravity CLI
  - Generative UI 개념
  - SEED Design System을 메인 디자인 레퍼런스로 사용

- 원하는 분위기와 시각 스타일:
  - 전체적으로 Dark Theme를 기본으로 한다.
  - Pado라는 이름에 맞춰 밝고 선명한 파란색을 핵심 상징색으로 사용한다.
  - 메인 디자인 레퍼런스는 당근의 SEED Design System으로 한다.
  - SEED의 여백, radius, typography hierarchy, component density, bottom sheet/dialog 등 제품형 UI 감각을 참고하되 당근의 주황색 브랜드 컬러를 복제하지 않는다.
  - Pado 자체의 색상 체계는 dark neutral surface + bright blue accent를 중심으로 구성한다.
  - 개발자 도구이지만 전통적인 IDE나 터미널 프로그램처럼 보이지 않도록 한다.
  - TUI가 화면의 일부로 등장할 수는 있으나 전체 제품은 developer console보다 workspace/productivity application에 가까운 인상을 가져야 한다.
  - monospace font와 코드 스타일은 Terminal/File처럼 실제로 필요한 영역에서만 제한적으로 사용한다.
  - 처음에는 매우 비어 있고 단순하지만 작업이 진행되면서 필요한 UI가 자연스럽게 생성되는 느낌을 준다.
  - 코드보다 결과, 상태, 사용자 입력에 시각적 우선순위를 둔다.
  - desktop에서는 여러 pane이 하나의 workspace를 구성한다.
  - mobile에서는 desktop layout을 억지로 축소하지 않고 Focus Mode를 사용한다.
  - 모바일 사용자는 한 번에 하나의 pane에 집중하며 명시적인 pane switcher를 통해 다른 pane으로 이동한다.
  - 모바일 pane navigation의 구체적인 UI는 미정이며, Naru의 단순 tab 복제보다 Pado에 맞는 방식을 새로 설계한다.

### Pane Motion / Animation

Generative UI의 변화 자체가 데모의 핵심이므로 motion을 MVP 이후 polish 항목으로 미루지 않고 초기 layout architecture에서 고려한다.

- pane 추가 시 기존 pane이 갑자기 jump하지 않고 자연스럽게 자리를 내준다.
- pane 제거 시 남은 pane이 부드럽게 확장된다.
- agent/admin에 의한 resize는 즉각적인 snap보다 짧고 명확한 transition을 사용한다.
- focus 변화는 border/accent/size 변화 등으로 명확하게 표현한다.
- 지나치게 느린 theatrical animation은 피한다.
- 사용자가 직접 divider를 drag하는 동안에는 pointer movement를 즉시 따라가며, agent/admin이 programmatic resize를 수행할 때 animation을 적용한다.
- 가능하면 spring 또는 ease 기반 motion을 사용하되 구현 복잡성이 크게 증가하면 CSS transition 기반으로 단순화한다.
- Pado의 이름처럼 pane들이 서로 밀고 당기며 공간을 재구성하는 느낌을 시각적 identity의 일부로 사용한다.

## 7. 데이터와 연동

- 저장하거나 표시할 데이터:
  - 현재 workspace의 pane 구성
  - pane별 상태와 크기
  - 현재 focused pane
  - 모바일 Focus Mode에서 선택된 pane
  - Antigravity 대화 및 작업 상태
  - Antigravity CLI stream event
  - 실행 중 terminal command
  - 실시간 stdout/stderr
  - 현재 active turn
  - 현재 speaker
  - Raise Hand 활성 여부
  - participant nickname
  - user role (`spectator`, `speaker`, `admin`)
  - spectator 수
  - 사용자에게 공개할 문서 또는 파일 내용
  - 현재 demo project 상태
- 외부 서비스/API 연동:
  - Antigravity CLI
  - Cloudflare Tunnel
  - 필요 시 localhost에서 실행되는 demo web project
- 로그인 또는 권한 요구:
  - 최초 접속 시 nickname 입력
  - 일반 관람자는 별도 계정 없이 nickname만으로 접속 가능
  - 관리자는 entry 단계에서 추가 관리자 password/secret을 입력해 Admin Mode 활성화
  - 프롬프트 제출은 현재 speaker만 가능
- 개인정보·보안 고려사항:
  - Antigravity는 sandbox/container 내부에서만 작업한다.
  - Mac mini의 개인 파일이나 홈 디렉터리에 접근할 수 없어야 한다.
  - SSH key, 개인 프로젝트, host secret 등을 demo workspace에 mount하지 않는다.
  - 공개 사용자의 prompt가 임의 shell 명령으로 이어질 수 있으므로 host와의 격리를 필수로 한다.
  - `.env` 등의 secret 입력값은 일반 사용자에게 broadcast하지 않는다.
  - Terminal output에 secret이나 민감한 환경변수가 그대로 출력되지 않도록 주의한다.
  - 생성형 Input HTML은 Pado의 메인 DOM과 격리한다.
  - admin 권한은 반드시 backend에서 검증하고 클라이언트 UI만 숨기는 방식으로 구현하지 않는다.

## 8. 기술 및 실행 환경

- 선호 기술 또는 제약:
  - GDGoC KU BYPP(Build Your Personal Project) 해커톤에서 공개 시연할 MVP를 만드는 것이 목적이다.
  - 전체 핵심 개발 시간은 약 12시간이다.
  - 개발 시작 시각은 **19:00**, 다음 날 **07:00까지 사실상 Codex가 단독으로 구현을 진행**할 수 있어야 한다.
  - 이 시간 동안 사용자는 Naru를 통해 모바일에서 간단한 상태 확인·지시·조작 정도만 가능하다.
  - 사용자가 해커톤 장소에 도착한 이후에야 컴퓨터를 통한 본격적인 실사용 테스트와 직접 디버깅이 가능하다.
  - 따라서 **07:00 시점에는 핵심 제품 구현이 사실상 완료되어 있어야 한다.**
  - 이후 사용자 작업은 새로운 핵심 기능 구현보다 실사용 경험 테스트, 치명적 버그 수정, UX 조정, 배포 확인, 발표 준비에 집중한다.
  - 구현 속도를 위해 검증된 라이브러리를 적극 사용한다.
  - MVP desktop workspace는 **자유 배치 window UI가 아니라 split/resizable pane 구조**를 사용한다.
  - layout은 recursive split tree 또는 이에 준하는 단순한 canonical representation으로 관리한다.
  - window-style absolute x/y positioning, overlap, z-index stacking은 MVP에서 구현하지 않는다.
  - transient Input/Settings UI는 sheet/modal/overlay 형태를 사용할 수 있다.
  - Redis 등 별도 인프라는 사용하지 않고 단일 서버 메모리 상태를 우선한다.
  - Antigravity CLI의 작업 실행과 Pado UI 제어를 분리한다.
  - Antigravity CLI는 가능하면 headless streaming session으로 장시간 유지한다.
  - Antigravity CLI의 `stream-json` 이벤트를 backend가 지속적으로 읽고 필요한 상태와 command output을 WebSocket으로 전달한다.
  - 실시간 Terminal은 별도 mock이 아니라 실제 Antigravity CLI가 실행하는 command/tool output과 연결한다.
  - agent와 admin은 가능한 한 동일한 workspace manipulation API를 사용한다.
  - Raise Hand는 backend에서 atomic claim으로 처리해 동시에 여러 요청이 들어와도 정확히 한 명만 speaker가 되도록 한다.
- 대상 기기/플랫폼(웹, 모바일, 데스크톱 등):
  - 웹 애플리케이션
  - 본 시연 및 workspace 조작은 데스크톱 우선
  - 관객 참여용 Stage Mode는 모바일을 중요 지원 대상으로 취급
  - 모바일에서는 desktop split layout 대신 pane 단위 Focus Mode를 사용한다.
- 배포 또는 실행 환경:
  - Mac mini에서 Pado backend와 Antigravity CLI 실행
  - Antigravity 작업은 sandbox/container 내부에서 수행
  - Cloudflare Tunnel을 통해 public HTTPS URL 제공
  - 한 번에 Antigravity session 하나만 실행
- 성능, 접근성, 브라우저 등 추가 요구:
  - 여러 spectator가 동시에 접속해도 workspace state와 terminal stream을 broadcast할 수 있어야 한다.
  - Chrome/Safari 등 일반적인 모바일 브라우저에서도 Stage Mode 핵심 기능이 동작해야 한다.
  - pane animation이 전체 데모 흐름을 방해할 정도로 느려서는 안 된다.
  - 네트워크가 끊겼다가 다시 연결되면 현재 canonical workspace state를 다시 받을 수 있어야 한다.
  - 실시간 terminal output 때문에 재접속 사용자가 무한한 과거 로그를 모두 내려받지 않도록 최근 로그 buffer만 유지해도 된다.

## 9. 참고 자료

- 문서/링크:
  - Antigravity CLI 공식 문서
  - Antigravity CLI headless / stream-json / hooks / sandbox 관련 문서
  - Cloudflare Tunnel 공식 문서
  - SEED Design System 공식 문서 및 React/CSS 구현
  - React resizable/split panel 관련 라이브러리
- 기존 코드나 파일:
  - 이번 해커톤 조건상 기존 Naru 코드는 사용하지 않고 처음부터 구현
  - 기존 Naru는 제품 개념 및 UX 참고 용도로만 사용
- 비슷한 제품 또는 경쟁 서비스:
  - Naru
  - 기존 AI IDE/ADE 계열 제품
  - Generative UI 기반 agent interface 사례
  - Antigravity의 agent workspace 개념
  - SEED Design System의 제품 UI 구성 방식

## 10. 미정 사항과 결정

| 항목 | 현재 상태 또는 선택지 | 결정/메모 |
|---|---|---|
| 프로젝트 이름 | Pado | 결정 |
| 핵심 개념 | Generative UI 기반 ADE | 결정 |
| Agent | Antigravity CLI | 결정 |
| Host | Mac mini | 결정 |
| 외부 공개 | Cloudflare Tunnel | 결정 |
| 동시 사용 방식 | 하나의 shared workspace + 단일 speaker | 결정 |
| Active Antigravity session | 1개 | 결정 |
| Antigravity 내부 작업 노출 | 기본적으로 숨김 | 결정 |
| 일반 사용자 pane 조작 | shared layout 변경 불가 | 결정 |
| 관리자 pane 조작 | 자유롭게 생성·삭제·focus·resize 가능 | 결정 |
| Admin UI | 별도 dashboard가 아닌 동일 workspace의 Admin Mode | 결정 |
| Admin 인증 | nickname 입력 단계에서 optional admin password | 결정 |
| File pane 노출 기준 | 사용자가 직접 확인하거나 수정해야 할 때만 | 결정 |
| Terminal | 실제 command stdout/stderr 실시간 스트리밍 | MVP 필수 |
| Terminal pane 노출 기준 | 모든 내부 동작을 노출하지 않고 사용자가 볼 가치가 있는 command/process 중심 | 결정 |
| Docs 역할 | 계약, 명세, 계획, 결정사항 등의 사용자 확인 | 결정 |
| Input pane | 자유형 HTML 기반 | sandbox 격리를 전제로 결정 |
| 디자인 시스템 | SEED Design | 메인 디자인 레퍼런스 |
| Theme | Dark | 결정 |
| Accent color | Bright Blue | 결정 |
| UI 인상 | IDE/TUI보다 workspace/productivity app에 가까운 형태 | 결정 |
| Desktop layout | split/resizable pane | 결정 |
| 자유 배치 window UI | MVP 제외 | 후속 확장 가능 |
| Pane motion | programmatic create/remove/resize에 부드러운 animation | MVP 설계부터 고려 |
| 모바일 | pane Focus Mode + pane switcher | 핵심 지원 |
| Mobile pane switcher UI | tabs / carousel / bottom navigation / sheet 등 | 미정 |
| 발언권 구조 | speaker가 없을 때 Raise Hand 활성화 | 결정 |
| 발언권 선정 | Raise Hand 선착순 1명 | 결정 |
| Queue | 사용하지 않음 | 결정 |
| Speaker prompt timeout | 약 60초 | 우선안 |
| 관리자 발언권 제어 | 언제든 현재 speaker의 권한 회수 가능 | 결정 |
| Subagent 시각화 | 모든 핵심 기능 완료 후 반드시 구현 시도 | 성공 시 핵심 기능으로 승격, 난도가 지나치게 높을 때만 제외 |
| Browser 구현 방식 | iframe | 가능하면 구현 |
| Browser pane | optional | 구현 난도가 높거나 불안정하면 MVP에서 제외 가능 |
| Antigravity가 presentation tool을 호출하는 방식 | MCP / plugin / 별도 tool integration | 미정 |
| Antigravity event 수집 | headless `stream-json` 기반 | 우선 검토/구현 |
| pane layout library | react-resizable-panels 등 | 구현 시 최종 결정 |
| frontend framework | React/Vite 또는 Next.js | 미정 |
| demo용 기본 프로젝트 | 미정 | 짧은 시간 안에 agent-user 상호작용이 여러 번 발생하는 프로젝트가 적합 |
| prompt moderation | admin이 speaker 권한 회수 및 prompt reject 가능 | 결정 |
| 07:00 이후 개발 | 실사용 테스트 및 수정 중심 | 신규 핵심 기능 개발 지양 |

## 11. 추가 메모

- Pado는 **GDGoC KU BYPP(Build Your Personal Project)** 행사에서 시연하기 위한 해커톤 프로젝트다.
- 해커톤 규칙에 따라 기존 Naru 코드를 재사용하지 않고 프로젝트를 처음부터 구현한다.
- Pado는 기존 Naru의 후속 아이디어에서 출발하지만 별도의 신규 프로젝트로 구현한다.
- Naru가 pane 기반 ADE였다면 Pado는 pane의 구성 자체를 agent가 작업 맥락에 따라 변경한다는 점이 핵심이다.
- 중요한 제품 철학은 `tool call = UI 변화`가 아니라는 것이다.
- 에이전트가 파일을 읽고 수정하는 과정은 기본적으로 숨겨진다.
- Terminal은 실제 실행 과정을 관찰하는 것이 의미 있는 순간에 제공되는 interface이며, Antigravity CLI의 command execution output을 실시간으로 표시한다.
- File pane은 코드 수정 과정을 구경하기 위한 editor가 아니다. 사용자가 내용을 확인하거나 직접 수정해야 하는 순간에만 등장한다.
- Docs pane은 코드보다 상위 수준의 계약, 명세, 계획, 결정사항을 agent와 사용자가 공유하기 위한 interface다.
- Input pane은 정해진 몇 가지 input type에 묶이지 않고 agent가 상황에 맞는 HTML UI를 구성할 수 있게 한다. 다만 security를 위해 격리된 환경에서 실행한다.
- Generative UI는 화려한 화면 생성을 위한 기능이 아니라, 사용자의 attention을 현재 필요한 정보와 행동에 집중시키기 위한 기능이다.
- 일반 참가자는 동일한 shared workspace를 보고 있으므로 desktop pane layout을 직접 변경할 수 없다.
- 관리자는 데모의 안정성과 연출을 위해 agent와 별개로 pane을 직접 생성·삭제·resize·focus할 수 있어야 한다.
- 별도의 관리자 dashboard는 만들지 않는다. 관리자는 같은 workspace에 Admin Mode로 접속하며, 자주 쓰는 데모 제어 기능은 workspace 안에서 바로 접근하고 세부 옵션만 Settings로 분리한다.
- Pado에 처음 접속할 때 nickname을 받는다.
- 발언권은 queue 없이 운영한다. speaker가 없는 동안 `Raise Hand` 버튼을 활성화하고, backend가 가장 먼저 도착한 유효 요청 하나만 원자적으로 승인한다.
- 한 명이 발언권을 얻는 즉시 다른 사용자의 Raise Hand는 닫힌다.
- 관리자는 데모 흐름이나 부적절한 입력 등의 이유로 현재 speaker의 발언권을 언제든 회수할 수 있다.
- 발언권이 회수되거나 timeout되면 다시 Raise Hand를 열어 새로운 사용자가 선착순으로 획득할 수 있게 한다.
- Browser pane은 iframe을 통해 결과물을 workspace 내부에 보여주는 방향이 이상적이지만, cross-origin, proxy, runtime 안정성 문제로 구현 비용이 커지면 MVP에서 제외한다.
- Pado라는 이름에 맞춰 물결과 흐름을 연상시키는 밝은 파란색을 상징색으로 사용한다. 직접적인 파도 일러스트나 과도한 gradient보다 motion, focus state, accent, transition으로 정체성을 표현한다.
- 특히 pane이 새로 생성되거나 제거될 때 주변 pane이 자연스럽게 밀리고 확장되는 motion은 Pado의 제품 concept을 설명하는 중요한 데모 요소다.
- UI/UX의 시각적 완성도는 해커톤 평가와 데모 전달력에 중요하므로 motion architecture를 마지막 polish 단계가 아니라 초기 layout 설계부터 고려한다.
- SEED Design을 메인 디자인 레퍼런스로 삼되 단순 복제보다 Pado의 dark workspace 성격에 맞게 재해석한다.
- TUI/Terminal이 포함되어도 전체 화면이 해커 툴처럼 보이지 않게 한다. Pado는 개발 도구이기 전에 사용자가 agent와 함께 일하는 workspace다.
- desktop은 Generative Workspace 자체를 보여주는 본 시연 환경이다.
- mobile에서는 여러 pane을 작은 화면에 동시에 욱여넣지 않는다. 각 pane을 한 화면에 집중해서 보여주는 Focus Mode를 제공하고 pane switcher로 전환한다.
- 공개 데모에서는 여러 사용자에게 각각 agent 환경을 제공하지 않는다. 하나의 shared session을 모든 사용자가 관람하고 한 명씩 프롬프트를 제출한다.
- 공개 사용자 prompt로 demo가 망가질 수 있으므로 각 turn 전 checkpoint와 관리자용 Reset 기능을 우선 구현한다.
- 모든 핵심 MVP가 안정적으로 동작한 다음에는 subagent 시각화를 마지막 주요 기능으로 반드시 구현 시도한다.
- Subagent가 정상적으로 구현되면 병렬 agent 작업에 맞춰 workspace가 스스로 확장되는 장면이 Pado의 핵심 데모가 될 수 있으므로 즉시 주요 기능으로 취급한다.
- 다만 subagent 연결이 예상보다 훨씬 복잡해 기존 MVP 안정성을 위협할 경우에만 중단한다.
- 개발은 **19:00에 시작하며 익일 07:00까지 약 12시간 동안 대부분 Codex가 자율적으로 진행한다.**
- 이 시간 동안 사용자는 원격에 있으며 Naru를 통해 모바일로 간단한 지시나 확인 정도만 할 수 있다.
- 따라서 Codex는 중간 확인이나 세부 의사결정을 사용자에게 지속적으로 요구해서는 안 된다. 명백한 blocker가 아닌 경우 PROJECT_BRIEF의 우선순위에 따라 스스로 합리적인 결정을 내려 구현을 계속한다.
- **익일 07:00에는 공개 배포 가능한 핵심 MVP가 사실상 구현 완료되어 있어야 한다.**
- 사용자가 해커톤 장소에 도착한 뒤 컴퓨터를 사용할 수 있게 되면 새로운 핵심 기능을 처음부터 구현하는 것이 아니라, 실제 사용 경험 테스트, 모바일/데스크톱 UX 확인, 버그 수정, 데모 시나리오 조정, 발표 준비를 진행한다.
- 전체 범위에서 가장 중요한 것은 `Agent가 실제 작업을 수행하면서 사용자에게 필요한 pane이 나타나고, 바뀌고, 사라지는 경험`이 안정적으로 한 번 이상 완주되는 것이다.