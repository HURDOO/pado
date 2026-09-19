# 실제 앱 서버와 Browser pane

Browser는 `content`만 있으면 기존 단일 HTML 미리보기, `server: {port, path}`가 있으면 샌드박스의 **실제 HTTP 서버**다. React/Vite, Node API, 파일·SQLite 저장, 관객 사이의 공유 데이터와 WebSocket/HMR을 지원한다. Agent pane은 그대로 원본 Antigravity TUI다.

## 실행

에이전트는 `/workspace/my-app`에 프로젝트를 작성한 후 각 명령을 따로 실행한다.

```sh
node /opt/pado/present.mjs exec install --cwd my-app npm install
node /opt/pado/present.mjs exec checks --cwd my-app npm test
node /opt/pado/present.mjs serve my-app 5173 --cwd my-app npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

`exec`는 인증 없는 임시 앱 컨테이너에서 설치·테스트한다. `serve`는 장기 실행 컨테이너를 시작하고 HTTP 응답을 확인한 다음 Browser pane을 연다. `ID-logs` Terminal에 실제 로그가 나온다. ID는 48자까지이고 호스트 shell에서 명령을 실행하지 않는다. 최대 6개 pane 제한이 있으므로 불필요한 설치·테스트 로그 pane은 닫는다.

일반 `exec`/`run`은 [현재 에이전트의 명령 대기](WAITING_TERMINALS.md)가 실제로 확인될 때 Terminal을 연다. 내부 파일 읽기·수정만 `--quiet`로 숨기며, 설치·빌드·테스트에는 기본 실행을 사용한다. 사용자가 로그 자체를 요청했다면 `exec checks --show --cwd my-app npm test`로 즉시 표시한다. 결과와 종료 코드는 표시 여부와 관계없이 에이전트에게 반환된다. 서버 시작·재시작은 `serve`가 항상 실행 로그를 연다(기존 `--quiet` 인자도 서버 로그를 숨기지 않는다). 명령줄·작업 디렉터리·출력·준비 상태를 구분하고 Browser 준비 후에도 작은 로그 pane을 함께 유지한다. 사용자가 직접 닫거나 다음 turn에서 일반 pane 숨김 규칙이 적용되면 로그를 계속 저장하며 `pane.show`로 다시 볼 수 있다.

- 앱 포트는 `3000`, `3001`, `5173`, `8080`. 컨테이너 내부 `0.0.0.0`에 바인딩한다. Vite `allowedHosts: true`는 필요하지 않다.
- 앱 launch는 프로젝트마다 하나다. 같은 프로젝트에서 다시 `serve`하면 그 프로젝트의 이전 앱만 중지하고 교체한다. 하나의 프로젝트 스크립트에서 프런트엔드·백엔드를 함께 실행할 수 있다.
- 분리형 React/Node는 Vite `/api` proxy를 컨테이너 내부 `http://127.0.0.1:3001` 등으로 지정한다. 브라우저 코드는 상대 경로 `/api/...`를 쓴다. 관객의 localhost를 하드코딩하지 않는다.
- 다른 경로는 `pane.upsert`에 `kind: "browser"`, `content: ""`, `server: {"port":5173,"path":"/dashboard"}`로 연다. 임의 URL·호스트를 지정할 수 없다.
- `node /opt/pado/present.mjs stop-server my-app`으로 중지한다. 발언권 해제와 turn 완료는 앱을 중지하지 않는다. 관리자 중단·초기화 및 Pado 종료는 앱도 중지한다.
- `/workspace` 파일은 유지된다. 앱 데이터가 재시작 후 남으려면 그 아래에 저장해야 한다. **Pado stage 자체는 여전히 메모리 상태**이며 앱 데이터 저장과 별개다.

## 내부망과 격리

Pado `4173`과 분리된 origin의 preview gateway `4273–4276`을 쓴다. 시작 포트는 `PADO_PREVIEW_BASE_PORT`로 변경한다. 매핑은 앱 `3000 → 4273`, `3001 → 4274`, `5173 → 4275`, `8080 → 4276`. Pado와 같은 `PADO_BIND_HOST`에 바인딩하므로 WireGuard에서 같은 IP의 이 포트들에도 접근할 수 있어야 한다. 기존 Pado 주소로 입장하면 별도 로그인은 없다.

앱의 원래 포트는 임의의 **호스트 loopback 포트**에만 publish한다. 게이트웨이는 Docker가 확인한 매핑으로만 연결하고, 유효한 Pado 세션과 현재 공개된 Browser pane을 요구한다. Pado 세션 쿠키·Authorization을 앱에 전달하지 않는다. 앱 응답의 Pado 쿠키 변경·외부 redirect·CORS 허용·service worker 확장 헤더를 제거한다. 세션 만료·pane 닫기·앱 교체 시 기존 HTTP/WS 연결도 해제한다.

앱 컨테이너에는 작업 폴더만 마운트하고 인증 volume, private bridge, 호스트 home, Docker socket을 연결하지 않는다. iframe은 **Pado와 다른 origin**에서 `allow-scripts allow-forms allow-same-origin`과 CSP를 사용한다. 기존 srcdoc/Input에는 `allow-same-origin`을 추가하지 않는다.

지원 범위는 **신뢰된 HTTP LAN/WireGuard**다. 외부 API/CDN/iframe/worker·service worker는 브라우저 CSP가 차단하므로 앱이 상대 경로 API와 로컬 의존성을 제공해야 한다. 서버 코드의 외부 API 연동은 [시크릿 Input](SECRETS.md)으로 받은 값을 `--secrets NAME`으로 명시한 실행에만 환경변수로 주입할 수 있다. 기본 앱 실행에는 시크릿이 없다. HTTPS·공개 도메인 배포는 범위 밖이다. Docker 기본 egress는 host/LAN을 완전히 차단하지 않으므로 악의적인 공개 프롬프트용 서비스가 아니다.

## 임시 시연 베이스: 해커톤 데스크

사용자 승인으로 `examples/hackathon-ops`를 준비했다. 최종 시연 주제는 아니며 나중에 교체할 수 있다. Pado 본체와 별도 폴더·DB를 사용하고 기존 작업을 덮어쓰지 않는다. 실제 에이전트 작업본은 `/workspace/hackathon-ops`다.

팀 등록 → 팀별 질문 접수 → 다른 브라우저에서 공동 조회하는 React/TypeScript/Node/SQLite 앱이다. README·TASKS·DECISIONS에 현재 구현과 미정 정책(공개 범위, 운영자 답변 권한, 우선순위)을 기록한다. Docs/Input/File을 무조건 여는 데모 대본이나 도메인별 pane 규칙은 추가하지 않는다. 사용자가 계획 검토·정책 결정 등을 요청할 때 적절한 pane을 선택한다.

실행 명령과 자연어 후속 요청은 [앱 README](../examples/hackathon-ops/README.md)에 있다. `PLAYWRIGHT_BROWSERS_PATH=.cache/playwright pnpm exec tsx scripts/hackathon-smoke.mjs`는 별도 임시 workspace의 인증 없는 AppRuntime에서 설치·API 테스트·빌드·실제 desktop/mobile 입력·공유 조회·재시작 저장 유지를 확인한다. 결과는 `.pado/desk-review/<실행 ID>`에 보존한다. 실제 stage를 초기화하지 않는다.

## 검증용 예제

프로젝트별 앱 실행·gateway 포트·쿠키 분리는 [workspace 안내](WORKSPACES.md)를 따른다. 새 turn에서 Browser를 접거나 다른 프로젝트를 열람해도 앱은 계속 실행한다. 서버 재시작 때 저장된 앱 명령을 복원한다. 관리자 지정 참여 프로젝트 외에는 gateway가 변경 HTTP 요청과 WebSocket을 차단하며 일반 조회만 허용한다. GET에 부작용이 있는 잘못된 API나 앱의 배경 작업까지 멈추는 기능은 아니다.

`examples/live-qa`는 React + Vite + Node + SQLite로 만든 **연결 검증용** 모임 질문 보드다. 시연 프로젝트를 확정한 것이 아니다. 질문 등록·브라우저별 중복 공감 방지·해결 표시·다른 관객과 동기화하고 `data/questions.sqlite`에 저장한다. 모두가 함께 관리하며 별도 진행자 권한 시스템은 없다.

예제를 새 workspace 하위 폴더 `live-qa`에 복사하고 에이전트에게 다음을 실행하게 한다. 의존성과 앱 코드는 호스트가 아니라 앱 컨테이너에서 실행한다.

```sh
node /opt/pado/present.mjs exec qa-install --cwd live-qa npm install --no-audit --no-fund
node /opt/pado/present.mjs exec qa-tests --cwd live-qa npm test
node /opt/pado/present.mjs serve qa-app 3000 --cwd live-qa npm run dev
```

`pnpm test:apps`는 AI 없이 실제 Docker의 인증 부재·HTTP 연결·종료·시작 중 취소를 검증한다. `pnpm test:agent`의 `preview.spec.ts`는 실제 원본 TUI가 예제를 설치·테스트·실행하고 desktop/mobile 공유 API, HMR, origin 격리, 재시작 후 데이터 유지, 관리자 중단을 확인한다. 테스트 workspace/DB는 `.pado/live`에 보존하며 실제 시연 stage와 분리한다.

설계 참고: [Vite 서버/HMR](https://vite.dev/config/server-options), [Docker 포트 publish](https://docs.docker.com/engine/network/port-publishing/), [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).
