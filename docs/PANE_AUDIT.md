# Pane 적절성 반복 검증 — 2026-09-19

사용자 요청: 서버 연결 완료 후 오전 01:30 KST까지 PROJECT_BRIEF 제품 철학을 반복 검증한다. Luna가 구현 지침을 보지 않고 상황별 자연스러운 프롬프트와 예상 pane을 제안하고, 실제 Antigravity 원본 TUI에서 결과를 관찰한다. 프롬프트에 원하는 pane 종류를 직접 주입하지 않는다.

기준은 내부 작업 노출이 아니라 **사용자가 판단·입력·검토해야 하는 시점에 필요한 화면만 나타나고, 역할이 끝난 임시 화면은 정리되는가**다. 특정 pane 수·비율을 기계적으로 맞추지 않는다. 예를 들어 대안 설명과 선택이 한 Input에 충분하면 별도 Docs는 불필요하다.

## 환경과 근거

- 실제 시연 stage와 분리: `127.0.0.1:14740`, preview `14840–14843`, `.pado/pane-audit-20260919/workspace`.
- `scripts/pane-audit.mjs`는 원본 TUI 키 입력, native turn lifecycle, SSE pane 이력, desktop 1440×950/mobile 390×844 화면·면적·focus, 최종 실제 TUI를 기록한다.
- 결과는 `.pado/pane-audit-20260919/reports/`에 보존한다. 생성 코드·설치·검사는 Docker 안에서만 실행한다. 운영 stage에 예제를 게시하지 않는다.
- 단위·브라우저 테스트와 모델 행동 평가를 구분한다. 모델 행동은 비결정적이므로 한 번의 통과가 모든 프롬프트의 보장은 아니다.

## 첫 기준선

| Luna 상황 | 실제 관찰 | 판정 |
| --- | --- | --- |
| S1 평균·최댓값만 짧게 답변 | 계산은 맞지만 Docs와 계산용 Terminal 생성, 최종 focus가 Terminal | 과잉 pane, 잘못된 최종 attention |
| S2 두 문구 대안 중 사용자가 고르기 전 대기 | 긴 Docs만 생성하고 TUI에서 선택을 요청한 뒤 turn 종료. Input 없음 | 필요한 Input 누락, 선택 대기 흐름 부재 |
| S3 작은 내부 수정 + 빠른 타입 검사 | File 자동 공개는 없고 실제 타입/동작 검사는 수행. Terminal 2개와 결과 Docs를 size 2로 유지 | 검증은 실제, 결과 화면은 과잉·미정리 |

원인 후보: 기존 지침의 일률적인 “계획 공개·실제 명령 검증”과 모든 helper 실행의 Terminal 생성, 대화 질문과 실제 Input 대기의 선택 기준 부재. 수정은 기능별 스크립트에 pane을 하드코딩하는 방식이 아니라 공통 presentation 정책과 명시적 quiet 실행으로 한다.

진행 중: 결과 확인·후속 정리, 원문 검토, 실제 실패 근거, 비밀값 없는 설정 안내, 기존 메모 유지와 추가 선택을 독립 시나리오로 검증하고 재실행 결과를 아래에 기록한다.

## 반복 검증 중 확인한 변화

| 상황 | 수정 후 관찰 | 근거 디렉터리 (reports 아래) |
| --- | --- | --- |
| S1 짧은 계산 | 추가 pane 없이 정확한 답, Agent focus. Luna 독립 판정 통과 | `1789746544826-luna-s1-baseline` |
| S2 선택 대기 | 실제 Input → 클릭 → 정리. 모바일 2열 카드가 좁아 부분 통과; 반응형 지침 보완 | `1789746639378-luna-s2-baseline` |
| S3 작은 내부 수정 | 실제 typecheck/test, 추가 pane 없음. Luna 통과 | `1789746941354-luna-s3-after-policy` |
| B1 원문 대조 | 원문 File과 분석은 정확하나 동일 File 2개. ID 재사용·helper 응답 보완 후 재검증 대상 | `1789747272207-luna-b1-original-review` |
| B2 실패 진단 | 실제 stderr/exit 2지만 동일 명령을 재실행해 Terminal 2개. 고정 오류 스크립트를 조건 검사로 오인한 설명도 발견 | `1789747170867-luna-b2-real-failure` |
| B3 안전 설정 안내 | pane 선택은 맞지만 비밀 키에 공개 접두사를 제안해 내용 안전성 실패. 실제 키 노출은 없었음 | `1789747381460-luna-b3-safe-instructions` |
| B4 메모 보존 + 선택 | 첫 공유 메모는 TUI에만 표시. 후속에서 Docs 생성·유지, Input focus·선택·정리 성공. 모바일 한 열 선택지 확인 | `1789747491645-luna-b4-retain-and-choose` |

S4 첫 실행은 선택한 앱/브라우저 바이너리를 탐색하다 `/opt/pado` 파일 접근 승인에 멈췄고 180초 내 완료하지 못했다(`1789746098818-luna-s4-baseline`). 권한을 넓히거나 자동 승인하지 않았다. 이후 공통 지침은 준비된 결과부터 보여주고 도구 구현을 불필요하게 탐색하지 않도록 보완했다.

B1의 `1789746997809-luna-b1-original-review`는 권한 대기 중 다음 테스트 reset이 겹쳐 `finished:true`가 찍힌 **무효 실행**이다. 통과 수에 포함하지 않는다. 정상 재실행의 중복 File 결과는 위에 별도로 기록했다. 모델 재실행 결과를 숨기거나 마지막 결과만 전체 보장으로 해석하지 않는다.

## 공통 수정

- 단순 답변·내부 수정은 TUI, 필요한 판단/입력/검토/실사용 결과만 명시적으로 공개하는 정책. 공유용 메모와 일반 짧은 답변을 구별한다.
- `exec --quiet`: 실제 검사는 실행하고 결과를 에이전트에 돌려주되 Terminal을 생성하지 않는다. 공개 실패 Terminal은 실제 종료 코드도 표시한다.
- 동일 결과의 ID 재사용, 임시 로그·답변한 Input 정리, 사용자 보존 요청 존중. helper는 queue에 쓴 사실을 응답하며, 적용 확인이라고 과장하지 않는다.
- 결과/Input focus 때 콘텐츠 영역 확대, 바깥으로 밀린 pane을 해당 영역 안에서 스크롤, 배경 Terminal 출력이 전체 workspace 위치를 바꾸지 않도록 수정. 모바일 활성 탭도 가시 범위에 들어온다.
- Input 기본 border-box와 작은 화면 padding, 생성 지침의 한 열·짧은 선택지·명시적 label. fixed 2열을 모바일에 강요하지 않는다.
- 안전 안내는 자리표시자와 개인 서버 환경만 설명한다. 비밀 키를 공유 workspace나 client 환경 변수로 유도하지 않는다. 공개 접두사에 대한 기준은 [Vite 공식 설명](https://vite.dev/guide/env-and-mode#env-variables), [Next.js 공식 설명](https://nextjs.org/docs/app/guides/environment-variables)을 확인했다.

정확한 내용·시점·중복·가독성을 함께 평가한다. 올바른 pane 종류만 나왔다고 전체 성공으로 간주하지 않는다.

## 최신 재실행 근거

| 상황 | 관찰 | 근거 디렉터리 |
| --- | --- | --- |
| S2 같은 선택 요청 | 한 열의 짧은 옵션, 실제 Input 대기/클릭/정리, Agent 복귀 | `1789747915012-luna-s2-baseline` |
| S4 결과 확인과 종료 | Browser 하나가 desktop에서 Agent보다 크게 표시(759px 대 427px), mobile 전체 Focus. 검증 harness가 실제 버튼 3회 클릭해 0→3 확인. 후속에서 pane 닫힘 | `1789747658337-luna-s4-after-policy` |
| B1 원문 검토 | 원문과 동일한 File 하나만 생성, size 2/focus, 파일 수정 없음 | `1789747878113-luna-b1-original-review` |
| B2 실패 진단 | 실제 stderr + exit 2 Terminal 하나, size 1. 조건 검사 없는 고정 재현 스크립트라는 원인을 정확히 설명 | `1789748187504-luna-b2-real-failure` |
| B3 안전 안내 | pane 없음. 개인 서버 환경·자리표시자만 안내하고 공개 접두사를 비밀 키에 사용하지 말라고 명시 | `1789747818256-luna-b3-safe-instructions` |
| B4 공유 메모 + 선택 최종 재실행 | 첫 요청부터 Docs 생성. 후속 Input 대기/실제 선택/정리, 원래 메모 내용은 그대로 보존. pane 흐름은 적절하나 "짧은 메모"보다 장황하고 원인 가설이 확대된 부분은 남음 | `1789748245791-luna-b4-retain-and-choose` |
| C1 새 단순 수량 질문 | 23개, 추가 pane 없음 | `1789747982239-luna-c1-short-answer` |
| C2 서로 다른 문서 유지·하나 갱신 | Docs 2개, 기존 장소 메모 ID 갱신 및 focus·확대, 설문 메모 내용 유지·축소. 중복 없음 | `1789747991783-luna-c2-two-results-update` |

B2 중간 실행 `1789747843247-luna-b2-real-failure`는 오류 원인 설명은 바로잡았으나 quiet 실행으로 요청된 Terminal 증거를 생략했다. “적게 띄우기”를 무조건 우선하면 반대로 누락되므로, 사용자가 실제 출력·종료 결과를 검토하겠다고 명시한 경우에는 공개 exec를 우선하도록 보완한 뒤 위 최신 실행을 얻었다.

S4의 0→3 브라우저 검증은 **Pado 안의 에이전트가 아니라 외부 검증 harness**가 수행했다. 에이전트는 자체 브라우저 자동화 환경이 없음을 고지하고 결과를 먼저 제공했다. 정적 HTML 카운터는 각 관객의 로컬 상태이며 공유 backend 앱으로 포장하지 않았다. 별도 React/Node/SQLite 통합 테스트에서 실제 HTTP/WS·공유 데이터·HMR을 검증했다.

Input 관객 화면의 전체 iframe `inert`/겹침 안내를 제거하고, 읽기 전용 bridge·비활성 컨트롤·하단 안내로 바꿨다. 관객은 긴 옵션을 스크롤할 수 있고 실제 제출은 계속 부모 수신 검증과 서버 권한 검증으로 차단된다. DOM 차단만을 보안 경계로 삼지 않는다.

남은 한계: 모델의 pane 판단과 생성 HTML은 비결정적이며 이 평가가 임의 프롬프트 전부의 품질을 보장하지 않는다. 관객 mobile의 원본 TUI는 desktop 발언자의 열 수를 공유하므로 긴 내용이 작게 보일 수 있다. 물리 Android/WireGuard 터치 키보드는 직접 검증하지 않았고 mobile Chromium으로 평가했다. 공개 배포용 네트워크 격리는 이번 목표에 포함하지 않았다.

C2의 첫 성공은 **pane 유지·갱신 성공**이다. 내용에는 좌석 수만으로 장소 A의 이동약자 동선이 유리하다고 단정한 근거 없는 확대가 있었다. B4의 장황한 메모와 함께 내용 품질은 부분 통과로 기록하고, 확인된 사실·계산·가설 구분 및 좁은 수정 요청의 범위를 지키는 정책으로 마지막 재실행한다.

마지막 C2 재실행 `1789748604160-luna-c2-two-results-update`는 기존 ID 두 개와 설문 내용의 문자열 동일성을 유지했고 B를 410,000원/좌석당 25,625원으로 갱신했다. 장소 접근성을 임의로 단정한 내용은 없어졌고, 설문은 실제 장소 점검이 필요하다고 구분했다. 다만 생성 문서의 간결성은 계속 평가할 항목이다. Luna 독립 검토도 pane 흐름은 통과, B4 메모 길이는 부분 통과로 판정했다.

Luna가 발견한 Docs의 Markdown 표가 pipe 텍스트로만 보이던 문제는 안전한 텍스트 기반 table 렌더링과 좁은 화면의 내부 가로 스크롤로 수정했다. 셀 안의 HTML도 React 텍스트로 처리하며 실행·이미지 로딩을 허용하지 않는다. 기존 Markdown 보안/desktop/mobile 테스트에 표 검증을 추가했다.

## 회귀 검증

- `pnpm check`: 타입·린트·39 단위·production build 통과. 약 598 kB 클라이언트 번들 경고는 남아 있으며 오류는 아니다.
- `pnpm test:e2e`: 12개 연속 통과. focus pane 가시성/배경 출력, 모바일 활성 탭, 관객 Input의 실제 wheel 스크롤·컨트롤 비활성·서버 제출 403 포함.
- `pnpm test:agent`: 실제 React/Node/SQLite·원본 TUI·생성 Input 세 시나리오 연속 통과. Input 관객 수정 후에도 다시 실행했다.
- `pnpm test:apps`: 실제 Docker 2개 통과. quiet 결과, 공개 stderr/exit 2, 네 포트 연결·종료·시작 중 취소.
- `pnpm test:runner`: 실제 bridge의 rich HTML·Input reply/error·UTF-8 출력·경로 경계 통과.
- `pnpm test:load`: production assets/비공개 파일/Origin 경계와 18 SSE 관객, 40 burst, 동일 최종 상태 통과.
- 테스트 자체의 추가 로그인으로 생긴 rate-limit 순서 간섭은 로그인 helper의 Retry-After를 유지하며 순서를 조정했다. viewport 전환 중 두 번의 좌표 측정 경합은 단일 DOM snapshot 재시도로, 스크롤의 몇 픽셀 변동은 사용자에게 중요한 focus pane 가시성 검증으로 바로잡았다. 운영 rate limit을 완화하지 않았다.

## 01:30 인계

최종 내부망 `http://<LAN_IP>:4173`에 반영했다(실제 내부 IP는 생략). 이전 `다음 아이디어` pane 1개와 작업 폴더는 유지했고 검증 예제는 게시하지 않았다. 최종 이미지 ID는 `sha256:9b5fbd9c074e20c99acb043b5360e9f806227b4120fe6974f789e59b3434970d`다. 마지막 production smoke에서 원본 TUI 연결, 모바일 한글 입력·발언권 해제 후 초안 제거, 기존 pane 보존, JavaScript 오류 0, 가로 넘침 없음, 커스텀 채팅 0을 확인했다. 재시작으로 브라우저는 다시 입장해야 할 수 있다.

평가 목표는 10종 상황의 실제 반복 관찰·수정·재검증과 한계 기록이며, “모든 생성 UI가 항상 적절하다”는 보장은 아니다. 최종 코드의 39 단위·12 브라우저 테스트는 통과했고 실제 AI 통합 3개도 관객 Input 변경 후 통과했다. 최후의 표 렌더링은 별도 desktop/mobile 시각 확인과 Markdown 보안 테스트로 검증했다.
