import test from 'node:test';
import assert from 'node:assert/strict';
import { withTerminalModifiers } from '../web/src/terminal-keys.ts';

test('virtual Ctrl and Alt encode single terminal chords', () => {
  const ctrl = { ctrl: true, alt: false };
  const alt = { ctrl: false, alt: true };
  const both = { ctrl: true, alt: true };
  assert.equal(withTerminalModifiers('c', ctrl), '\x03');
  assert.equal(withTerminalModifiers('L', ctrl), '\x0c');
  assert.equal(withTerminalModifiers(' ', ctrl), '\x00');
  assert.equal(withTerminalModifiers('[', ctrl), '\x1b');
  assert.equal(withTerminalModifiers('j', alt), '\x1bj');
  assert.equal(withTerminalModifiers('c', both), '\x1b\x03');
  assert.equal(withTerminalModifiers('\r', alt), '\x1b\r');
  assert.equal(withTerminalModifiers('\t', both), '\t');
  assert.equal(withTerminalModifiers('\x7f', ctrl), '\x08');
  assert.equal(withTerminalModifiers('\x1b[A', ctrl), '\x1b[1;5A');
  assert.equal(withTerminalModifiers('\x1bOD', alt), '\x1b[1;3D');
  assert.equal(withTerminalModifiers('\x1b[C', both), '\x1b[1;7C');
  assert.equal(withTerminalModifiers('\x1b[1;2D', ctrl), '\x1b[1;6D');
});

test('virtual modifiers leave composition, paste and unrelated terminal sequences intact', () => {
  for (const data of ['한', '한글 입력', 'hello', '👋', '\x1b[200~pasted\x1b[201~', '\x1b[6n'])
    assert.equal(withTerminalModifiers(data, { ctrl: true, alt: true }), data);
  assert.equal(withTerminalModifiers('c', { ctrl: false, alt: false }), 'c');
});
