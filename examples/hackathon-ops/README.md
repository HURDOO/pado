# 해커톤 데스크

팀 등록과 질문 접수를 함께 쓰는 **교체 가능한 임시 시연 앱**. Pado의 확정 제품 기능이나 최종 시연 주제가 아니다.

## 현재 흐름

팀 등록 → 등록한 팀 선택 → 분야별 질문 접수 → 다른 브라우저에서 조회. SQLite에 저장하며 목록은 3초마다 갱신한다. 로그인·팀 소유권·운영자 답변·비공개 질문은 아직 없다. 모든 입력은 공동 열람하므로 가명과 가상 내용만 사용한다.

## 실행과 검증

Node 24 앱 컨테이너에서 실행한다. Pado의 기존 앱 실행 환경과 동일하게 npm을 사용하며 호스트에서 의존성이나 앱을 실행하지 않는다.

```sh
node /opt/pado/present.mjs exec desk-install --quiet --cwd hackathon-ops npm ci --no-audit --no-fund
node /opt/pado/present.mjs exec desk-check --quiet --cwd hackathon-ops npm run check
node /opt/pado/present.mjs serve hackathon-ops 3000 --quiet --cwd hackathon-ops npm run dev
```

초기 데이터는 비어 있다. 원하면 `exec desk-seed --quiet --cwd hackathon-ops npm run seed:demo`로 **가상 예시** 팀 3개와 질문 3개를 한 번만 추가할 수 있다. 이미 등록된 사용자 데이터는 수정하지 않는다. DB는 `data/desk.sqlite`; 앱 재시작으로 지워지지 않는다. 시연 교체 시 자동 삭제하지 않는다.

원본은 `examples/hackathon-ops`, 실제 수정할 작업본은 `/workspace/hackathon-ops`다. 원본을 작업본에 다시 덮어쓰지 않는다. Browser는 Pado의 별도 gateway를 통하고 외부 서비스에 연결하지 않는다.

2026-09-19: 컨테이너 타입 검사·API 테스트 4개·빌드와 실제 Chromium desktop/mobile 흐름을 검증했다. 공유 조회, 중복 오류, 네트워크 복구, 재시작 저장 유지와 소스/DB 비노출을 확인했다. 실제 Android 검증은 아직 하지 않았다.

## 다음 대화의 출발점

- “hackathon-ops의 TASKS를 보고 지금 되는 것과 남은 일을 정리해줘.”
- “질문을 전체 공개할지 팀별로 보여줄지 장단점을 보고 정하고 싶어. 아직 구현하지 마.”
- “운영자가 질문에 답하고 참가자가 답변을 확인하는 흐름을 만들자. 권한은 먼저 정하자.”

문서가 있다는 이유로 Docs/File pane을 열지 않는다. 사용자가 계획 검토·정책 선택·실행 결과 확인을 요청할 때 필요한 인터페이스를 선택한다.

[작업 목록](docs/TASKS.md) · [결정 기록](docs/DECISIONS.md) · [브리프](PROJECT_BRIEF.md)
