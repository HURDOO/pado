import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the selected reply limit preserves the existing public visibility contract', () => {
  const settings = JSON.parse(readFileSync(new URL('./settings.json', import.meta.url), 'utf8'));
  assert.deepEqual(settings, { maxReplies: 3, visibility: 'public' });
});
