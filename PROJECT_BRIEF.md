# PROJECT_BRIEF: <Pado>

> 새 프로젝트의 목적과 첫 번째 완성 범위를 정리하는 문서입니다. 아직 정하지 못한 항목은 `미정`으로 두고, 아는 내용부터 작성하세요.

## 1. 프로젝트 한 줄 소개

Pado는 바이브코딩 사용자를 위해, 에이전트가 현재 작업에 필요한 인터페이스만 동적으로 생성·배치하는 Generative UI 기반 ADE(Agent Development Environment)다.

## 2. 배경과 문제

- 현재 겪는 문제:
  - 기존 AI 코딩 도구는 에이전트가 대부분의 구현을 수행해도 파일 트리, 코드 에디터, 터미널 등 전통적인 IDE 구조를 유지한다.
  - 현재 ADE 역시 대체로 정적인 레이아웃을 사용한다.
  - 실제 바이브코딩에서는 사용자가 코드 수정 과정을 계속 볼 필요는 없지만, 환경변수 입력, 계약 변경 확인, 실행 결과 검토 등 특정 순간에는 적절한 인터페이스가 필요하다.
- 이 문제가 중요한 이유:
  - 바이브코딩에서 사용자의 역할은 직접 코드를 작성하는 것보다 요구사항 전달, 판단, 정보 제공, 결과 검토에 가까워지고 있다.
  - 따라서 ADE의 인터페이스 역시 코드 중심의 고정 UI보다 현재 작업과 사용자 개입에 맞춰 변화할 필요가 있다.
- 지금 사용하는 대안과 그 한계:
  - 기존 IDE/ADE에서는 사용자가 미리 정해진 Editor, Terminal, Chat, Preview 등의 화면을 직접 관리한다.
  - 에이전트가 지금 무엇을 하고 있고 사용자가 무엇을 해야 하는지에 따라 workspace 자체가 유동적으로 바뀌지는 않는다.

## 3. 대상 사용자

- 주요 사용자:
  - Antigravity CLI, Codex 등 코딩 에이전트에게 구현 대부분을 맡기는 바이브코딩 사용자
- 사용자의 상황과 숙련도:
  - 코드 수정 과정 자체보다 진행 상황, 필요한 의사결정, 입력 요청, 결과 확인에 관심이 있다.
  - 데스크톱뿐 아니라 모바일에서도 원격으로 작업을 확인할 수 있다.
- 가장 중요한 사용자 요구:
  - 지금 자신이 알아야 하거나 개입해야 하는 정보만 명확하게 보고 싶다.
  - 작업마다 workspace를 직접 구성하거나 관리하고 싶지 않다.

## 4. 목표와 성공 기준

### 목표

- 에이전트의 내부 작업과 사용자에게 보여주는 인터페이스를 분리한다.
- 에이전트가 현재 상황에 필요한 pane을 직접 생성·삭제·focus·resize하는 Generative Workspace를 구현한다.
- 관리자는 데모 진행을 위해 workspace와 발언권을 직접 제어할 수 있다.
- 여러 해커톤 참가자가 하나의 shared workspace를 실시간으로 관람하고 직접 프롬프트를 제출할 수 있게 한다.
- 데스크톱 시연과 모바일 관객 참여를 모두 지원한다.

### 성공 기준

- [ ] Antigravity CLI가 실제 프로젝트 작업을 수행한다.
- [ ] 파일을 읽거나 수정했다는 이유만으로 File pane이 나타나지 않는다.
- [ ] 필요한 순간에 Terminal, File, Docs, Input 등의 pane이 동적으로 등장하고 변화한다.
- [ ] 실제 Terminal 실행 내용과 stdout/stderr를 실시간으로 볼 수 있다.
- [ ] pane 생성·제거·resize가 Pado의 핵심 경험으로 느껴질 만큼 자연스럽게 표현된다.
- [ ] 여러 사용자가 동일한 workspace를 실시간으로 본다.
- [ ] 모바일에서도 현재 pane을 확인하고 전환하며 데모에 참여할 수 있다.
- [ ] 한 명씩 발언권을 얻어 실제 프롬프트를 제출할 수 있다.
- [ ] 외부 네트워크에서 공개 URL로 접속할 수 있다.

### 이번 범위에서 하지 않을 일

- 완전한 IDE 또는 VS Code 대체
- 코드 에디터 중심 인터페이스
- 사용자마다 별도의 개발 workspace 제공
- 여러 Antigravity session 동시 운영
- 장기 사용자 데이터 저장
- 범용 클라우드 개발환경 구축
- Naru 기능 전체 재구현

## 5. 첫 번째 사용 가능 버전(MVP)

### 핵심 기능

1. `Agent`, `Terminal`, `File`, `Docs`, `Input` 등 작업에 따라 변하는 Generative Workspace
2. Antigravity의 내부 작업과 Pado가 사용자에게 보여주는 presentation을 분리하는 구조
3. 실제 command 실행 상태를 실시간으로 보여주는 Terminal
4. 여러 관객이 하나의 workspace를 공유하는 Stage Mode
5. 모바일에서 pane 하나에 집중하고 다른 pane으로 전환할 수 있는 Focus Mode
6. workspace와 데모 진행을 직접 제어할 수 있는 Admin Mode
7. 핵심 기능 완료 후 subagent의 작업을 workspace에 표현하는 기능 구현 시도

### 대표 사용 흐름

1. 사용자가 nickname을 입력하고 Pado에 접속한다.
2. 현재 작업 중인 shared workspace를 관람한다.
3. 발언권이 비어 있으면 `Raise Hand`를 할 수 있다.
4. 가장 먼저 Raise Hand한 한 명이 발언권을 얻는다.
5. 발언자는 제한된 시간 안에 프롬프트를 작성한다.
6. Antigravity가 실제 프로젝트 작업을 수행한다.
7. 작업 중 사용자가 볼 필요가 있는 정보나 필요한 상호작용이 생기면 적절한 pane이 나타난다.
8. 필요가 끝난 pane은 축소되거나 사라진다.
9. 작업이 끝나면 다시 Raise Hand가 가능해진다.
10. 관리자는 필요할 경우 언제든 현재 발언권을 회수하고 데모 흐름을 직접 제어할 수 있다.

### 완료 조건

- [ ] 위 흐름을 실제 public demo에서 처음부터 끝까지 수행할 수 있다.
- [ ] 하나의 작업 안에서 여러 종류의 pane이 실제 맥락에 따라 변화한다.
- [ ] desktop과 mobile이 동시에 같은 session을 관람할 수 있다.
- [ ] 관리자가 demo workspace를 안정적으로 제어하고 초기화할 수 있다.
- [ ] 핵심 기능 안정화 후 subagent 시각화를 실제로 구현 시도한다.

## 6. 화면과 콘텐츠

- 필요한 화면 또는 주요 영역:
  - Entry / Nickname
  - Shared Workspace
  - Agent pane
  - Terminal pane
  - File pane
  - Docs pane
  - Input pane
  - Raise Hand / Speaker UI
  - Mobile Focus Mode
  - Admin controls
  - Settings
  - Browser pane은 여유가 있을 경우 추가

- 각 영역의 역할:
  - Agent: 현재 작업 상태와 에이전트의 사용자 대상 메시지
  - Terminal: 사용자에게 보여줄 가치가 있는 실제 실행 과정
  - File: 사용자가 직접 내용을 확인하거나 수정해야 하는 경우
  - Docs: 계약, 명세, 계획, 결정사항 등의 확인
  - Input: agent가 사용자에게 값을 받거나 선택을 요청하는 경우
  - Admin: pane 조작, 발언권 회수, turn 제어, reset 등 데모 운영
  - Browser: 구현할 경우 결과 웹페이지를 workspace 안에서 확인

### Input pane

- 정해진 몇 가지 form component에 한정하지 않고, agent가 상황에 맞는 입력 UI를 자유롭게 구성할 수 있는 방향을 지향한다.
- HTML 기반의 자유로운 UI를 사용할 수 있다.
- 생성형 UI이므로 보안상 다른 Pado UI와 적절히 격리되어야 한다.

### 디자인

- 전체 Dark Theme
- 밝고 선명한 Blue를 Pado의 상징색으로 사용
- SEED Design System을 메인 디자인 레퍼런스로 사용
- 개발자 도구이지만 전통적인 IDE/TUI보다 정돈된 workspace/productivity application에 가까운 인상
- monospace와 코드 스타일은 필요한 영역에만 제한적으로 사용
- 직접적인 파도 그래픽보다 pane의 움직임과 transition으로 Pado의 정체성을 표현
- pane이 생성되고 사라지며 서로 공간을 나누는 과정의 부드러운 animation을 초기 설계부터 중요하게 고려
- desktop에서는 여러 pane이 하나의 workspace를 구성
- mobile에서는 한 번에 pane 하나를 집중해서 보여주고, 활성 pane 사이를 쉽게 전환할 수 있게 한다.
- 모바일 pane 전환 UI의 구체적인 방식은 미정

## 7. 데이터와 연동

- 저장하거나 표시할 데이터:
  - workspace와 pane 상태
  - Antigravity 작업 상태
  - command 및 실시간 stdout/stderr
  - 참가자 nickname과 역할
  - 현재 speaker
  - spectator 상태
  - File / Docs / Input 등 공개된 pane 콘텐츠
  - demo project 상태
- 외부 서비스/API 연동:
  - Antigravity CLI
  - Cloudflare Tunnel
  - 필요 시 demo project
- 로그인 또는 권한 요구:
  - 일반 사용자는 nickname만 입력
  - 관리자는 추가 관리자 인증
  - prompt 제출은 현재 발언권을 가진 사용자만 가능
- 개인정보·보안 고려사항:
  - 공개 사용자의 prompt가 실제 agent 작업으로 이어지므로 host와 demo 환경을 안전하게 분리해야 한다.
  - 개인 파일, 인증 정보, secret이 spectator에게 노출되지 않아야 한다.
  - 관리자 권한과 생성형 Input UI도 적절한 보안 경계를 가져야 한다.

## 8. 기술 및 실행 환경

- 선호 기술 또는 제약:
  - GDGoC KU BYPP(Build Your Personal Project) 해커톤용 프로젝트
  - 프로젝트는 기존 Naru 코드를 재사용하지 않고 처음부터 구현한다.
  - desktop workspace는 자유 배치 window 방식보다 split/resizable pane 방식을 기본 방향으로 한다.
  - Antigravity CLI의 실제 작업과 Pado presentation layer를 연결한다.
  - Terminal은 실제 Antigravity 실행 결과를 실시간으로 보여준다.
  - 구현 방법과 구체적인 기술 선택은 이후 계획 단계에서 결정한다.
- 대상 기기/플랫폼:
  - Web
  - 본 시연은 desktop 중심
  - 관객 참여는 mobile도 주요 대상으로 고려
- 배포 또는 실행 환경:
  - Mac mini
  - 안전하게 격리된 Antigravity 작업 환경
  - Cloudflare Tunnel을 통한 public access
  - Active Antigravity session 1개
- 성능, 접근성, 브라우저 등 추가 요구:
  - 여러 관객이 동시에 접속해도 shared workspace 관람이 가능해야 한다.
  - 일반적인 desktop/mobile 브라우저에서 데모가 가능해야 한다.

## 9. 참고 자료

- 문서/링크:
  - Antigravity CLI 관련 문서
  - Cloudflare Tunnel
  - SEED Design System
  - Generative UI / dynamic workspace 참고 사례
- 기존 코드나 파일:
  - Naru는 제품 철학과 UX 참고 용도로만 사용
  - 기존 코드는 사용하지 않는다.
- 비슷한 제품 또는 경쟁 서비스:
  - Naru
  - 기존 AI IDE/ADE
  - Generative UI 기반 agent interface

## 10. 미정 사항과 결정

| 항목 | 현재 상태 또는 선택지 | 결정/메모 |
|---|---|---|
| 프로젝트 이름 | Pado | 결정 |
| 핵심 개념 | Generative UI 기반 ADE | 결정 |
| Agent | Antigravity CLI | 결정 |
| Host | Mac mini | 결정 |
| 외부 공개 | Cloudflare Tunnel | 결정 |
| Desktop layout | split/resizable pane | 결정 |
| 일반 사용자 pane 조작 | 불가 | 결정 |
| 관리자 pane 조작 | 가능 | 결정 |
| Admin UI | 같은 workspace의 Admin Mode | 결정 |
| Terminal | 실제 stdout/stderr 실시간 표시 | 필수 |
| Input | 자유로운 생성형 UI | 결정 |
| Theme | Dark + Bright Blue | 결정 |
| 디자인 레퍼런스 | SEED Design | 결정 |
| 모바일 | pane Focus Mode | 결정 |
| 모바일 pane 전환 UI | 미정 | 계획 단계에서 결정 |
| 발언권 | Raise Hand 선착순 1명 | 결정 |
| Queue | 사용하지 않음 | 결정 |
| 관리자 발언권 제어 | 언제든 회수 가능 | 결정 |
| 발언 시간 | 30초 | 결정 |
| Subagent | 핵심 기능 후 구현 시도 | 가능하면 핵심 데모로 사용 |
| Browser | iframe | optional |
| Presentation 연동 방식 | 미정 | 계획 단계에서 결정 |
| Frontend / pane library | 미정 | 계획 단계에서 결정 |
| Demo project | 미정 | 계획 단계에서 결정 |

## 11. 추가 메모

- 개발은 **19:00에 시작하며 익일 07:00까지 약 12시간 동안 대부분 Codex가 자율적으로 진행한다.**
- 이 시간 동안 사용자는 원격에 있으며 Naru를 통해 모바일로 간단한 확인과 지시만 가능하다.
- **07:00에는 핵심 MVP가 사실상 완성되어 있어야 하며**, 사용자가 현장에 도착한 이후에는 주로 실사용 테스트, 버그 수정, UX 조정, 데모 및 발표 준비를 진행한다.
- Subagent는 기본 기능을 모두 완성한 뒤 마지막 주요 기능으로 구현을 시도한다. 구현 가능하다면 Pado의 핵심 데모 요소로 활용하고, 난도가 기존 MVP의 안정성을 위협할 정도일 경우에만 제외한다.
- Browser pane은 있으면 좋지만 구현 문제로 핵심 기능을 방해한다면 제외한다.
- 구현 세부사항은 이 문서에서 과도하게 고정하지 않는다. 이후 Astra가 이 브리프를 바탕으로 구현 계획과 우선순위를 구체화한다.
- [Pado PROJECT_BRIEF_OLD.md] 는 이전 버전의 PROJECT_BRIEF로, 세부 사항이 너무 상세하게 규정되어 있어 OLD 파일이 되었다. 필요 시 참고하면 된다.
