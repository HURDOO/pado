import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalScreen } from '../server/terminal-screen.ts';
import type { TuiFrame } from '../shared/protocol.ts';

test('native cursor updates, alternate screen and reconnect snapshots preserve the terminal', async () => {
  const frames: TuiFrame[] = [];
  const screen = new TerminalScreen(60, 15, (frame) => frames.push(frame));
  const reconnect = new TerminalScreen(60, 15);
  try {
    await screen.write('normal buffer\r\n');
    await screen.write('\x1b[?1049h\x1b[2J\x1b[H원본 TUI\r\nworking');
    await screen.write('\x1b[2;1H\x1b[2Kdone ✓');
    assert.match(screen.snapshot().text!, /원본 TUI\ndone ✓/);
    assert.doesNotMatch(screen.snapshot().text!, /normal buffer|working/);
    await reconnect.write(screen.snapshot().data);
    assert.equal(reconnect.snapshot().text, screen.snapshot().text);
    assert.deepEqual(
      frames.map((frame) => frame.seq),
      [1, 2, 3],
    );
    await screen.resize(40, 12);
    assert.equal(frames.at(-1)?.kind, 'reset');
    assert.equal(frames.at(-1)?.cols, 40);
    await screen.write('\x1b[?1049l');
    assert.match(screen.snapshot().text!, /normal buffer/);
  } finally {
    screen.dispose();
    reconnect.dispose();
  }
});

test('protocol replies are produced centrally; OSC clipboard and links do not survive snapshots', async () => {
  const replies: string[] = [];
  const screen = new TerminalScreen(
    40,
    12,
    () => {},
    (data) => replies.push(data),
  );
  try {
    await screen.write(
      '\x1b[6n\x1b]52;c;c2VjcmV0\x07\x1b]8;;https://example.com\x07label\x1b]8;;\x07',
    );
    assert.ok(replies.some((value) => value.endsWith('R')));
    assert.doesNotMatch(screen.snapshot().data, /c2VjcmV0|https:\/\//);
    assert.match(screen.snapshot().text!, /label/);
  } finally {
    screen.dispose();
  }
});
