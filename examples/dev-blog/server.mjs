import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const assets = {
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};
export function createBlogServer(directory = root) {
  return createServer(async (req, res) => {
    const send = (status, content, type = 'application/json') => {
      res.writeHead(status, {
        'Content-Type': `${type}; charset=utf-8`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
      });
      res.end(
        req.method === 'HEAD'
          ? undefined
          : typeof content === 'string'
            ? content
            : JSON.stringify(content),
      );
    };
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      res.setHeader('Allow', 'GET, HEAD');
      return send(405, { error: '읽기 전용 블로그입니다.' });
    }
    try {
      const url = new URL(req.url || '/', 'http://blog.local');
      if (url.pathname === '/api/posts' || url.pathname.startsWith('/api/posts/')) {
        const posts = JSON.parse(await readFile(resolve(directory, 'content/posts.json'), 'utf8'));
        if (!Array.isArray(posts) || posts.some((post) => !/^[a-z0-9-]{1,80}$/.test(post.slug)))
          throw new Error('Invalid post index');
        if (url.pathname !== '/api/posts') {
          const slug = url.pathname.slice('/api/posts/'.length);
          const post = posts.find((post) => post.slug === slug);
          if (!post) return send(404, { error: '글을 찾을 수 없습니다.' });
          const markdown = await readFile(resolve(directory, 'content', `${slug}.md`), 'utf8');
          return send(200, { ...post, markdown });
        }
        const query = (url.searchParams.get('q') || '').trim().slice(0, 200).toLocaleLowerCase();
        const tag = url.searchParams.get('tag') || '';
        return send(200, {
          posts: posts
            .filter(
              (post) =>
                (!tag || post.tags.includes(tag)) &&
                (!query ||
                  `${post.title} ${post.excerpt} ${post.tags.join(' ')}`
                    .toLocaleLowerCase()
                    .includes(query)),
            )
            .sort((a, b) => b.date.localeCompare(a.date)),
          tags: [...new Set(posts.flatMap((post) => post.tags))],
          total: posts.length,
        });
      }
      const asset = assets[url.pathname];
      if (asset)
        return send(200, await readFile(resolve(directory, 'public', asset[0]), 'utf8'), asset[1]);
      if (url.pathname === '/' || /^\/posts\/[a-z0-9-]{1,80}$/.test(url.pathname))
        return send(
          200,
          await readFile(resolve(directory, 'public/index.html'), 'utf8'),
          'text/html',
        );
      return send(404, { error: '페이지를 찾을 수 없습니다.' });
    } catch {
      return send(500, { error: '글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createBlogServer().listen(Number(process.env.PORT || 3000), '0.0.0.0', () =>
    console.log('Developer blog listening on sandbox port ' + (process.env.PORT || 3000)),
  );
}
