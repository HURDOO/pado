import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApi } from './api.mjs';

test('real Node API validates questions and keeps one vote per browser', async () => {
  const api = createApi(':memory:');
  const server = createServer(api.handle);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body = {}, cookie) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/questions', { text: ' ' })).status, 400);
    const created = await post('/api/questions', { text: 'React와 Node는 어떻게 연결되나요?', author: '참가자' });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const cookie = created.headers.getSetCookie()[0].split(';')[0];
    await post(`/api/questions/${id}/vote`, {}, cookie);
    await post(`/api/questions/${id}/vote`, {}, cookie);
    const { questions } = await (await fetch(base + '/api/questions', { headers: { Cookie: cookie } })).json();
    assert.equal(questions[0].votes, 1);
    assert.equal(questions[0].voted, 1);
    await post(`/api/questions/${id}/resolve`);
    assert.equal((await (await fetch(base + '/api/questions')).json()).questions[0].done, 1);
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); api.close(); }
});
