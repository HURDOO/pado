# 프로젝트 실행 환경 입력

API 키나 비밀번호가 필요한 순간 에이전트가 **시크릿 Input**을 열고 기다린다. 사용자는 Pado가 제공하는 password 입력창에 값을 넣는다. 저장 후 에이전트에는 변수 이름과 설정 여부만 돌아오며, 지정한 앱·테스트를 실행할 때만 환경변수로 주입한다.

## 사용

Pado에서 “날씨 API를 연결해줘. 필요한 API 키는 시크릿 Input으로 받아줘”처럼 요청한다. 이미 등록한 변수는 이름 목록으로 확인해서 재사용한다. 사용자 입력 전 값을 추정하거나 빈 키로 구현 완료를 주장하지 않는다.

```sh
node /opt/pado/present.mjs secrets
```

새 값이 필요하면 다음 presentation을 공개하고 `wait weather-key-1`로 기다린다.

```json
{"type":"pane.upsert","pane":{"id":"weather-key-1","kind":"input","title":"날씨 API 연결","secret":{"name":"WEATHER_API_KEY","description":"날씨 조회 기능을 실행하는 데 필요합니다."}}}
```

반환값은 `{"name":"WEATHER_API_KEY","configured":"true"}`다. 원문은 일반 Input 답변 경로로 보내지 않는다.

```sh
node /opt/pado/present.mjs exec weather-check --quiet --secrets WEATHER_API_KEY node weather-check.mjs
node /opt/pado/present.mjs serve weather-app 3000 --cwd my-app --secrets WEATHER_API_KEY npm run start
```

서버 코드는 `process.env.WEATHER_API_KEY`처럼 참조한다. 여러 변수는 `--secrets FIRST_API_KEY,SECOND_API_KEY`로 지정한다. 옵션을 생략하면 프로젝트 시크릿을 주입하지 않는다. 설치·프런트엔드 빌드에는 시크릿을 넘기지 않는다. 값을 바꾼 뒤 실행 중인 앱은 다시 `serve`해야 반영된다. 프로젝트 복귀 시 저장된 실행 명령의 변수 이름을 이용해 최신 값을 다시 주입한다.

## 저장과 공개 범위

- 원문은 `.pado/projects/<project-id>/secrets.json`에 평문 JSON으로 저장한다(파일 권한 0600). 프로젝트별 workspace 밖이므로 에이전트의 파일 읽기 대상이 아니다. stage 초기화나 프로젝트 전환으로 삭제하지 않는다.
- 요청자 또는 관리자만 현재 입력 요청에 답할 수 있다. 관객에게는 변수 이름·사용 목적·설정 상태만 보인다. 입력값은 브라우저 저장소나 SSE/stage 저장 파일에 기록하지 않는다.
- Docker 명령 인자에는 이름만 넣는다. Pado가 Docker 프로세스 환경에 값을 전달하고, 지정한 앱 컨테이너가 이를 받는다. Antigravity 컨테이너에는 주입하지 않는다. Docker를 제어하는 호스트 관리자는 컨테이너 환경을 확인할 수 있다.
- 변수는 대문자 영문으로 시작하고 대문자·숫자·밑줄, 최대 80자다. 런타임 제어 변수와 공개 접두사(`PATH`, `NODE_OPTIONS`, `PADO_*`, `VITE_*`, `NEXT_PUBLIC_*` 등)는 거부한다.
- 실행 출력의 주입된 값과 정확히 일치하는 문자열은 청크 경계를 포함해 `[REDACTED]`로 가린다. 인코딩·변형·앱 응답·임의 파일로 유출하는 코드를 막는 보안 경계는 아니다.

## 데모의 한계

암호화 저장소나 API 중계 서비스를 구현하지 않는다. 앱 코드가 환경변수를 읽을 수 있으므로 악의적인 에이전트를 방어한다고 주장하지 않는다. 에이전트에게 값을 확인·출력·복사하지 말고 서버 코드에서 참조하라는 지침을 제공한다. 기존 HTTP 로컬/LAN/WireGuard 시연에서는 제한된 시연용 키를 사용한다. 공개 네트워크 운영은 별도 HTTPS·인증·권한·보관 정책 검토 대상이다.
