import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from './server.mjs';
test('selected layout renders real questions and status', () => {
  const page = render();
  assert.match(page, /data-layout="(?:cards|list)"/);
  assert.match(page, /노트북 연결이 안 돼요/);
  assert.match(page, /접수됨/);
});
