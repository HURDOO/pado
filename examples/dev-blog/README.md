# 작은 기록

예시 글 3편으로 시작하는 간단한 개발자 블로그. 목록·상세·검색·태그 필터와 반응형 읽기 화면이 있다.

Pado AppRuntime에서 실행:

```text
node /opt/pado/present.mjs exec blog-check --quiet --cwd . npm run check
node /opt/pado/present.mjs serve dev-blog 3000 --cwd . npm run dev
```

설치할 의존성이 없다. 글은 content/posts.json에 메타데이터를 추가하고 같은 slug의 Markdown 파일로 작성한다. 제목, 본문, 인라인 코드·강조, 목록, 인용, 코드 블록을 지원한다. 원시 HTML, 외부 이미지, Markdown 링크는 지원하지 않는다. 실제 렌더링은 안전한 텍스트 중심 DOM이다.

API: GET /api/posts?q=검색어&tag=태그, GET /api/posts/:slug. 글 상세의 /posts/:slug로 바로 접속하거나 새로고침해도 열린다. 댓글·웹 편집·로그인은 없다.

해볼 요청:

- “블로그의 남은 작업과 아직 정하지 않은 정책을 보여줘.”
- “글 목록을 지금 행 형태와 카드형으로 비교해줘. 선택 전에는 적용하지 마.”
- “RSS를 다음 작업으로 지정해줘. 구현은 하지 마.”
- “목록 검색을 수정한 뒤 변경점과 실제 검증 결과를 보여줘.”
