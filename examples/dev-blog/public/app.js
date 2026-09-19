const main = document.querySelector('#main');
let requestNumber = 0;
let listController;
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function routeLink(href, text, className) {
  const link = el('a', text, className);
  link.href = href;
  link.dataset.nav = '';
  return link;
}
function inline(text) {
  const fragment = document.createDocumentFragment();
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
    fragment.append(
      part.startsWith('`') && part.endsWith('`')
        ? el('code', part.slice(1, -1))
        : part.startsWith('**') && part.endsWith('**')
          ? el('strong', part.slice(2, -2))
          : document.createTextNode(part),
    );
  }
  return fragment;
}
function renderMarkdown(source) {
  const article = el('div', undefined, 'prose');
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let list;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      const block = el('div', undefined, 'code-block');
      block.append(el('small', language || 'CODE'));
      const pre = el('pre');
      pre.append(el('code', code.join('\n')));
      block.append(pre);
      article.append(block);
      list = undefined;
      continue;
    }
    if (!line.trim()) {
      list = undefined;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const node = el(`h${Math.min(3, heading[1].length + 1)}`);
      node.append(inline(heading[2]));
      article.append(node);
      list = undefined;
    } else if (line.startsWith('- ')) {
      if (!list) {
        list = el('ul');
        article.append(list);
      }
      const item = el('li');
      item.append(inline(line.slice(2)));
      list.append(item);
    } else {
      const node = el(line.startsWith('> ') ? 'blockquote' : 'p');
      node.append(inline(line.startsWith('> ') ? line.slice(2) : line));
      article.append(node);
      list = undefined;
    }
  }
  return article;
}
function metadata(post) {
  const line = el('div', undefined, 'post-meta');
  const date = el('time', post.date.replaceAll('-', '.'));
  date.dateTime = post.date;
  line.append(date, el('span', '·'), el('span', post.tags.join(' / ')));
  return line;
}
async function fetchJson(path, signal) {
  const response = await fetch(path, { signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '불러오지 못했습니다.');
  return result;
}
async function indexPage(token) {
  document.title = '작은 기록 · 개발자 블로그';
  const hero = el('section', undefined, 'hero');
  hero.append(el('p', 'NOTES ON BUILDING THINGS', 'eyebrow'));
  const heading = el('h1');
  heading.append('작게 만들고,', el('br'), el('em', '오래 남기는 기록.'));
  hero.append(
    heading,
    el('p', '코드 뒤에 남은 생각, 시행착오, 그리고 다음에 기억할 것들.', 'intro'),
  );
  const bar = el('div', undefined, 'archive-heading');
  bar.append(el('h2', '모든 기록'), el('span', '개발 노트 · 예시 콘텐츠', 'sample-label'));
  const controls = el('div', undefined, 'filters');
  const searchLabel = el('label', '기록 검색', 'search-label');
  const search = el('input');
  search.type = 'search';
  search.maxLength = 200;
  search.placeholder = '제목, 요약, 태그로 찾아보기';
  searchLabel.append(search);
  const tags = el('div', undefined, 'tags');
  tags.setAttribute('aria-label', '태그 필터');
  controls.append(searchLabel, tags);
  const status = el('p', '불러오는 중…', 'results-status');
  status.setAttribute('role', 'status');
  const posts = el('div', undefined, 'post-list');
  main.replaceChildren(hero, bar, controls, status, posts);
  const params = new URLSearchParams(location.search);
  search.value = params.get('q') || '';
  let selectedTag = params.get('tag') || '';
  let loadedTags = false;
  async function load() {
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    const query = new URLSearchParams();
    if (search.value.trim()) query.set('q', search.value.trim());
    if (selectedTag) query.set('tag', selectedTag);
    history.replaceState(null, '', '/' + (query.size ? '?' + query : ''));
    status.textContent = '불러오는 중…';
    try {
      const data = await fetchJson('/api/posts?' + query, controller.signal);
      if (token !== requestNumber || controller.signal.aborted) return;
      if (!loadedTags) {
        loadedTags = true;
        for (const tag of ['', ...data.tags]) {
          const button = el('button', tag || '전체');
          button.type = 'button';
          button.dataset.tag = tag;
          button.addEventListener('click', () => {
            selectedTag = tag;
            void load();
          });
          tags.append(button);
        }
      }
      for (const button of tags.children)
        button.setAttribute('aria-pressed', String(button.dataset.tag === selectedTag));
      status.textContent = `${data.posts.length}개의 기록${data.posts.length === data.total ? '' : ` · 전체 ${data.total}개`}`;
      posts.replaceChildren();
      if (!data.posts.length) {
        const empty = el('div', undefined, 'empty');
        empty.append(
          el('h3', '아직 일치하는 기록이 없어요'),
          el('p', '다른 검색어나 태그로 찾아보세요.'),
        );
        const clear = el('button', '필터 초기화');
        clear.addEventListener('click', () => {
          search.value = '';
          selectedTag = '';
          void load();
        });
        empty.append(clear);
        posts.append(empty);
      }
      data.posts.forEach((post, index) => {
        const row = el('article', undefined, 'post-card');
        row.append(el('span', String(index + 1).padStart(2, '0'), 'post-number'));
        const body = el('div', undefined, 'post-card-body');
        body.append(metadata(post));
        const title = el('h3');
        title.append(routeLink('/posts/' + post.slug, post.title));
        body.append(title, el('p', post.excerpt));
        row.append(body, routeLink('/posts/' + post.slug, '읽기 ↗', 'read-link'));
        posts.append(row);
      });
    } catch (error) {
      if (controller.signal.aborted || token !== requestNumber) return;
      status.textContent = error.message;
      posts.replaceChildren();
    }
  }
  search.addEventListener('input', () => void load());
  await load();
}
async function render() {
  const token = ++requestNumber;
  listController?.abort();
  main.replaceChildren(el('p', '기록을 불러오고 있어요…', 'loading'));
  if (location.pathname === '/') return indexPage(token);
  const slug = location.pathname.match(/^\/posts\/([a-z0-9-]{1,80})$/)?.[1];
  try {
    if (!slug) throw new Error('페이지를 찾을 수 없습니다.');
    const post = await fetchJson('/api/posts/' + slug);
    if (token !== requestNumber) return;
    document.title = `${post.title} · 작은 기록`;
    const article = el('article', undefined, 'article');
    article.append(
      routeLink('/', '← 모든 기록', 'back-link'),
      metadata(post),
      el('h1', post.title),
      el('p', post.excerpt, 'article-intro'),
      renderMarkdown(post.markdown),
    );
    const end = el('div', undefined, 'article-end');
    end.append(el('p', '오늘의 기록은 여기까지.'), routeLink('/', '다른 기록 읽기 →'));
    article.append(end);
    main.replaceChildren(article);
  } catch (error) {
    if (token !== requestNumber) return;
    const missing = el('section', undefined, 'empty');
    missing.append(
      el('h1', '기록을 찾을 수 없어요'),
      el('p', error.message),
      routeLink('/', '모든 기록으로 돌아가기'),
    );
    main.replaceChildren(missing);
  }
}
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-nav]');
  if (
    !link ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
    return;
  event.preventDefault();
  history.pushState(null, '', link.getAttribute('href'));
  void render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});
window.addEventListener('popstate', () => void render());
void render();
