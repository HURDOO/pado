# 개발자 블로그 작업 규칙

- PROJECT_BRIEF.md와 docs/TASKS.md를 읽고 사용자가 요청한 범위만 변경한다. Pado 본체나 다른 프로젝트를 수정하지 않는다.
- Node 24 + 표준 HTTP 서버 + HTML/CSS/브라우저 JS. 외부 설치 없이 npm run dev / npm run check를 사용한다. 실행은 credential-free AppRuntime 안에서만 한다.
- 실제 콘텐츠는 content/posts.json과 content/*.md다. 샘플 글의 예시 표시는 보존한다. 공개 API는 읽기 전용이며 사용자 확인 없이 인증·댓글·쓰기 API를 만들지 않는다.
- 게시물 slug를 경로로 직접 신뢰하지 않는다. Markdown은 DOM textContent 중심으로 렌더링하며 원시 HTML/스크립트를 실행하지 않는다.
- 작업 목록은 실제 docs/TASKS.md로 Tasks에 표시한다. 현재 확인과 미래 제안을 구분하고 [>] 다음 작업은 사용자가 정했을 때만 하나 지정한다.
- 화면 방향을 골라야 하면 시각적 비교 Input을 만들고 실제 선택을 기다린다. 의미 있는 구현 뒤에는 실제 명령의 runId와 미검증 범위를 Review에 연결한다. 작업 결과는 실행 중인 Browser로 확인한다.
- 내부 파일 읽기/수정만으로 pane을 만들지 않는다. 정책·계획 검토는 Docs, 실제 선택은 Input, 작업 현황은 Tasks 등 필요한 인터페이스만 사용한다.
- 글/태그 검색·상세·빈 결과·없는 글·데스크톱·모바일을 검증한다. 실기기와 공개 배포를 하지 않았다면 명시한다.
