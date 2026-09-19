import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createBlogServer } from './server.mjs';

test('blog lists real posts, filters, serves details and rejects writes/unknown files', async () => {
  const server = createBlogServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const list = await (await fetch(origin + '/api/posts')).json();
    assert.equal(list.posts.length, 3);
    assert.equal(list.total, 3);
    assert.ok(list.tags.includes('Testing'));
    const query = await (await fetch(origin + '/api/posts?q=' + encodeURIComponent('실패'))).json();
    assert.deepEqual(
      query.posts.map((post) => post.slug),
      ['failure-to-test'],
    );
    const tagged = await (await fetch(origin + '/api/posts?tag=Frontend')).json();
    assert.deepEqual(
      tagged.posts.map((post) => post.slug),
      ['less-ui-more-focus'],
    );
    const empty = await (await fetch(origin + '/api/posts?q=no-such-article')).json();
    assert.equal(empty.posts.length, 0);
    const post = await (await fetch(origin + '/api/posts/small-api-boundaries')).json();
    assert.match(post.markdown, /예시 콘텐츠/);
    assert.match(post.markdown, /```js/);
    assert.equal((await fetch(origin + '/api/posts/missing')).status, 404);
    assert.equal((await fetch(origin + '/api/posts/%2e%2e%2fpackage.json')).status, 404);
    assert.equal((await fetch(origin + '/package.json')).status, 404);
    assert.equal((await fetch(origin + '/server.mjs')).status, 404);
    assert.equal((await fetch(origin + '/api/posts', { method: 'POST', body: '{}' })).status, 405);
    const page = await fetch(origin + '/posts/failure-to-test');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /작은 기록/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await fetch(origin + '/app.js')).status, 200);
    assert.equal((await fetch(origin + '/style.css', { method: 'HEAD' })).status, 200);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
