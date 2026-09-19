# Mac mini · Cloudflare Tunnel 공개 배포

## 접속 경로

아래 공개 도메인은 예시이며 실제 배포 주소는 로컬 설정에서 확인한다.

`https://pado.example.com` → Cloudflare named Tunnel → `127.0.0.1:4173`.
Mac mini의 포트를 인터넷이나 LAN에 직접 공개하지 않는다. Naru의 서비스/인증서/토큰은 변경하지 않는다.
현재 프로젝트 데이터는 기존 `.pado`를 그대로 사용한다. 누구나 닉네임으로 입장하며 관리자 비밀번호는 기존 `.env` 설정을 사용한다.

실제 앱은 프로젝트 슬롯과 승인된 컨테이너 포트별로 별도 HTTPS origin을 쓴다.
`pado-app-{0..11}-{3000|3001|5173|8080}.example.com` → 로컬 gateway `4273..4320`.
Cloudflare의 첫 단계 하위 도메인 TLS 범위를 사용한다. 앱 Docker 포트는 임의의 **loopback** 포트에만 매핑된다.
이름을 등록했다고 앱이 공개되는 것은 아니다. 로그인한 Pado 세션, 공개된 Browser pane, 실행 중인 승인 포트가 모두 필요하다.

## 공개 모드 경계

- `PADO_PUBLIC_MODE=1`: CLI/앱/수동 Shell의 네트워크 정책 설치가 끝나기 전에는 사용자 코드를 실행하지 않는다. 별도 고정 helper에만 일시적으로 NET_ADMIN을 주고, 실제 컨테이너는 non-root·cap-drop·read-only rootfs·PID/CPU/메모리 제한을 유지한다.
- host/LAN/link-local/metadata/CGNAT와 IPv6 신규 outbound 연결을 차단한다. 지정 DNS와 공인 HTTP/HTTPS만 허용한다. 인터넷 통신 자체를 막는 설계는 아니다.
- 인증된 CLI는 읽기 전용 PreToolUse 정책에 따라 고정 `present.mjs` helper만 실행한다. 파일 읽기/수정/명령은 helper를 통해 **인증 정보 없는 앱 컨테이너**로 보낸다. 직접 파일 도구, 임의 셸, `--file`은 공개 모드에서 차단한다. Subagent는 기본 차단이지만 해커톤 데모에서는 아래 opt-in으로 허용한다. 로컬 모드는 기존 동작을 유지한다.
- **`PADO_PUBLIC_SUBAGENTS=1`**: 사용자 요청으로 해커톤 데모에서 실제 자식 위임·관리·메시지 도구를 허용한다. Subagent pane의 호출·재사용·종료 감지를 연결하며 자식 작업에도 같은 helper 사용 지침을 전달한다. 하위 CLI의 정책 상속을 일반적인 보안 보장으로 주장하지 않으며, 신뢰한 데모 참가자용 선택이다. Docker/네트워크 격리와 부모 CLI의 파일·명령 제한은 유지한다. 일반 공개 기본값으로 돌아가려면 `0`으로 바꾸고 정상 재시작한다.
- **`PADO_DEMO_SHORT_ADMIN_PASSWORD=1`**: 사용자가 기존 짧은 관리자 비밀번호를 이번 데모에서 유지하도록 승인했다. 이 설정은 16자 최소 길이 검사만 예외로 두며 관리자 인증·세션·요청 제한은 유지한다. 기본 실행에서는 계속 16자 이상을 요구한다.
- 기본 공개 입력은 prompt-only다. 사용자의 6시간 동아리 해커톤 결정에 따라 현재 배포는 **`PADO_PARTICIPANT_TUI=1`**로 원본 CLI 조작을 허용한다. 발언자·현재 작업 요청자·관리자만 참여 프로젝트에 입력할 수 있고 관객·비참여 프로젝트는 계속 읽기 전용이다. 프롬프트 form 대신 원본 TUI와 모바일 보조 키를 사용한다. 이 설정은 Docker/내부망 차단을 해제하지 않는다. 일반 공개로 돌아갈 때는 해당 값을 `0`으로 바꾸고 서버를 정상 재시작한다.
- 직접 CLI 조작은 신뢰한 참가자용이다. 컨테이너 안에도 전용 AI 로그인 상태가 있으므로 파일 첨부·설정·권한 메뉴를 자유롭게 조작하는 사용자에게 인증정보 비밀성을 보장하지 않는다. 공유 TUI에서 로그인/인증정보를 표시하지 말아야 한다. 현재 URL에는 동아리 구성원 인증이 없으며 누구나 닉네임으로 들어올 수 있다. **6시간 후 자동 차단은 설정되어 있지 않다.** 종료 시 아래 maintenance 명령으로 외부 접속을 닫는다.
- Pado 쿠키는 `__Host-pado_session`, 앱 입장 쿠키는 `__Host-pado_preview`로, Secure/HttpOnly/host-only이다. 앱 입장권은 단일 사용·30초 만료이며 URL fragment에서만 전달하고 즉시 지운다. 앱 요청에는 Pado/Cloudflare 인증 헤더나 쿠키를 전달하지 않는다.
- 비참여 프로젝트는 앱 HTTP mutation/WS까지 서버가 거부한다. generated HTML은 기존 opaque-origin sandbox를 유지한다.
- 개별 파일은 256 MiB 제한. 2초 주기 저장 공간 검사에서 workspace 2 GiB 초과/호스트 여유 10 GiB 미만/검사 실패 시 프로젝트 실행을 중지하고 서버 재시작 전까지 변경 요청을 막는다. **이 watchdog은 파일시스템의 하드 quota가 아니다.** 강한 다중 사용자 서비스에는 별도 quota/VM이 필요하다.
- 프로젝트 secrets는 기존 모델 그대로다. 명시적으로 주입한 secret은 해당 앱 코드가 읽거나 인터넷으로 보낼 수 있다. 익명 공개 프로젝트에 민감한 키를 주입하지 않는다.
- 익명 사용에 따른 AI 크레딧 소모, 악성 앱의 공인 인터넷 통신, 장기 디스크 보관까지 완전히 방지하지 않는다. 개인 데모용 공개 운영이며 적대적 다중 테넌트 플랫폼을 보장하지 않는다. provider 한도와 호스트 사용량을 운영자가 관리한다.

## 운영

Cloudflare API 토큰은 사용자가 제공한 `CLOUDFLARE_API_TOKEN.secret`(600)을 사용한다. `*.secret`/`.pado`는 Git에서 제외하고 Docker context는 허용 목록으로 제한한다. API 토큰은 설정 도구만 사용한다. Tunnel 서비스는 별도 `.pado/tunnel/connector.secret`만 읽는다.

```sh
# 안전한 상태 조회 (토큰/원시 응답은 출력하지 않음)
node scripts/cloudflare.mjs inspect
node scripts/macos-service.mjs status

# 즉시 외부 접속 중지: DNS와 프로젝트 데이터를 삭제하지 않음
node scripts/cloudflare.mjs maintenance

# 아래 검증 후에만 외부 연결 재개: 공개 모드 production health 필수
node scripts/cloudflare.mjs activate
```

두 user LaunchAgent `kr.hurdoo.pado.server`, `kr.hurdoo.pado.tunnel`은 현재 사용자 로그인 시 실행하고 종료되면 재시작한다. 설정은 `~/Library/LaunchAgents`, 로그와 비밀값 없는 공개 env override는 `.pado/deploy`에 있다. 공개 override는 기존 `.env`를 읽은 **뒤에** 적용된다. Docker 이미지 ID는 prepare 시 고정한다.

Mac mini가 켜져 있고 사용자 로그인·OrbStack/Docker·네트워크가 살아 있어야 한다. 시스템 부팅 전/사용자 로그아웃 중 가용성은 보장하지 않는다. 수동 `pnpm start`는 기존 로컬 `.env` 설정이므로 공개 서비스 관리와 혼용하지 않는다.

```sh
# 정상 서비스 재시작: 현재 세션은 다시 입장해야 한다.
launchctl kill SIGTERM gui/$(id -u)/kr.hurdoo.pado.server
launchctl kill SIGTERM gui/$(id -u)/kr.hurdoo.pado.tunnel
```

실행 중인 작업을 마친 후 먼저 maintenance로 전환하고 서버에 SIGTERM을 보내 프로젝트 저장/컨테이너 정상 종료를 기다린 뒤 KeepAlive로 서비스가 재시작되는지 확인한다. 자동 재시작 이후 `/api/health`뿐 아니라 각 TUI와 앱 상태도 확인한다. `kickstart -k`로 강제 종료하면 이전 컨테이너가 남을 수 있으므로 정상 재시작에는 사용하지 않는다.

코드 롤백/격리 설정 변경 시 먼저 maintenance. 과거 비격리 설정으로 돌아간 상태에서 Tunnel을 다시 열지 않는다. 파일을 삭제하지 않으므로 프로젝트 데이터 롤백은 별도 백업 복원이 필요하다.

## 변경 후 검증

```sh
docker build -f agent/Dockerfile -t pado-agent:public-candidate .
pnpm check
pnpm test:e2e
pnpm test:public-network
pnpm test:public-agent
pnpm test:public-subagent
pnpm test:public-browser
```

public-agent 검사는 실제 전용 CLI 로그인을 사용하며 소량의 모델 사용량이 발생한다. 무해한 직접 명령이 deny되고 고정 helper만 allow되어 앱 컨테이너에 파일이 생성되는지 확인한다. public-browser는 데스크톱/모바일 원본 CLI 입력·슬래시 메뉴·보조 키, 발언권 없는 입력 거부, 별도 HTTPS origin의 fragment 입장권/쿠키/부모 DOM 차단을 검증한다. 테스트의 HTTPS transport는 로컬로 매핑하므로 **실제 외부 TLS·SSE·preview 경로는 별도로 확인**한다.

최초 설정 순서: `cloudflare prepare`(503 유지) → `prepare-previews` → 모든 검사 → `macos-service prepare` → 기존 서버 정상 종료 → `macos-service install` → loopback readiness → `cloudflare activate` → 실제 HTTPS 확인. 기존 서비스 정의를 자동 덮어쓰지 않는다. `.pado` 테스트 산출물과 `/private/tmp` 파일은 자동 삭제하지 않는다.

## 2026-09-19 배포 확인

실제 공개 활성화 완료. `pnpm check` 127개, 기존 E2E 34개, 공개 브라우저 2개, 실제 network/CLI smoke 통과. 기존 3개 프로젝트 보존. 서비스 2개 running, 4173은 loopback에만 LISTEN. 실제 Cloudflare HTTPS(TLS 검증 활성화)에서 닉네임 입장/Secure 쿠키/SSE/참가자 직접 TUI 거부/3개 TUI ready/기존 앱 인증 미리보기 200 확인. 실제 desktop 1440·mobile 390에서도 입장 및 별도 origin iframe을 확인했다. 증거는 `.pado/deploy/verification`에 보관한다.

```sh
node scripts/public-check.mjs --local
node scripts/public-check.mjs
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright node scripts/public-browser-check.mjs
```

마지막 스크립트는 현재 데모의 슬롯 2 앱을 읽기 전용으로 열며, 프로젝트 구성이 바뀌면 검증 대상도 조정해야 한다. 검사 과정에서 공개 검증용 관객 세션을 만들지만 AI 요청이나 프로젝트 변경은 하지 않는다.

### 해커톤 직접 CLI 입력으로 변경

후속 사용자 요청으로 현재 배포는 `PADO_PARTICIPANT_TUI=1`이다. 128개 단위/타입/린트/빌드, 기존 E2E 34개, 실제 공개 브라우저 2개와 network smoke를 통과했다. 진행 중 작업은 사용자가 중단을 승인한 뒤 정상 재시작했다. 프로젝트 파일·컨테이너 이미지·Tunnel/DNS/네트워크 정책은 바꾸지 않았다.

실제 외부 HTTPS에서도 `participantTui: true`, SSE·3개 TUI ready·기존 앱 인증 200을 확인했다. 1440px와 390px 브라우저에서 정상 발언권으로 직접 입력 echo를 확인하고, 발언권 반환이 서버에서 완료된 뒤 입력이 403으로 거부되는 것을 검증했다. 증거: `.pado/deploy/verification/native-1440.png`, `native-390.png`.

`public-browser-check.mjs --native-input`은 검증 관객이 정상 발언권을 얻어 실행하지 않을 짧은 문자열을 입력하고 지운 뒤 발언권을 돌려준다. AI 요청이나 설정 변경은 하지 않고, 다른 참가자가 작업 중이면 검증이 실패한다. 직접 입력 opt-in이 실제 외부 UI/서버에 적용됐는지 확인할 때만 사용한다.

### 해커톤 Subagent 허용 적용

사용자 요청으로 `PADO_PUBLIC_SUBAGENTS=1`을 적용했다. 실제 자식 위임·메시지·앱 파일 생성·pane 출력·완료 후 닫힘 smoke, 단위 136개, E2E 37개, 공개 브라우저 2개 및 네트워크/기존 공개 CLI smoke가 통과했다. 모든 프로젝트가 idle일 때 정상 재시작했으며 프로젝트 파일과 대화는 보존했다.

재시작 때 기존 `.env`의 짧은 관리자 비밀번호가 길이 검사에 걸렸고, 사용자가 이번 데모에서는 그대로 허용하도록 승인했다. `PADO_DEMO_SHORT_ADMIN_PASSWORD=1`로 최소 길이 검사만 예외 처리했다. 기존 비밀번호 로그인 성공·틀린 비밀번호 거부·예외 설정 없는 기본 실행의 짧은 비밀번호 거부를 확인했다.

실제 배포의 상주 TUI 3개에서 Subagent 호출 허용과 직접 파일 도구 거부를 확인했다. 외부 HTTPS·SSE·기존 앱 인증 미리보기 및 1440/390 브라우저 검증이 통과했고 Tunnel은 다시 live다. 증거: `.pado/deploy/verification/subagent-change.md`.
