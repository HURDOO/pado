import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from './server.mjs';
// A known, intentionally unimplemented feature for testing honest failed-check handoff.
test('question list has a keyboard-operable details button', () => {
  assert.match(render(), /<button/);
});
