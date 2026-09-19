import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WaitingTerminal } from '../server/waiting-terminal.ts';
import { StageStore } from '../server/stage.ts';
import { runtimeRequestSchema } from '../shared/protocol.ts';
import type { TerminalEvent } from '../server/terminal-events.ts';

function fixture() {
  const waitFor = { conversationId: 'root', turnToken: randomUUID(), step: 4 };
  const request = runtimeRequestSchema.parse({
    requestId: randomUUID(),
    id: 'check',
    action: 'exec',
    command: ['npm', 'test'],
    display: 'waiting',
    waitFor,
  });
  const store = new StageStore();
  const emitted: TerminalEvent[] = [];
  const gate = new WaitingTerminal(request, (event) => {
    store.terminal(event);
    emitted.push(event);
  });
  const event = (value: Record<string, unknown>) =>
    gate.event({ id: 'check-logs', runId: request.requestId, ...value } as TerminalEvent);
  const snapshot = { ...waitFor, at: Date.now(), steps: [4] };
  event({
    type: 'terminal.open',
    title: '앱 환경 명령',
    subtitle: 'npm test',
    size: 1,
    command: ['npm', 'test'],
    startedAt: 1234,
  });
  return { request, store, emitted, gate, event, snapshot };
}
test('actual waiting reveals buffered stdout/stderr once without changing focus, and preserves real start/exit', () => {
  const f = fixture();
  f.event({ type: 'terminal.append', stream: 'stdout', text: 'BEFORE_WAIT\n' });
  f.event({ type: 'terminal.append', stream: 'stderr', text: 'WARNING\n' });
  assert.equal(f.store.state.panes.length, 0);
  f.gate.update({ ...f.snapshot, steps: [] }, true);
  assert.equal(f.store.state.panes.length, 0);
  f.gate.update(f.snapshot, true);
  assert.equal(f.store.state.panes.length, 1);
  assert.equal(f.store.state.focusId, 'agent');
  assert.equal(f.store.state.panes[0].terminal?.startedAt, 1234);
  assert.equal(f.store.state.panes[0].content, 'BEFORE_WAIT\n[stderr] WARNING\n');
  f.gate.update(f.snapshot, true);
  assert.equal(f.emitted.filter((e) => e.type === 'terminal.open').length, 1);
  f.store.present({ type: 'pane.close', id: 'check-logs' });
  f.event({ type: 'terminal.append', stream: 'stdout', text: 'AFTER_CLOSE' });
  f.gate.update(f.snapshot, true);
  f.event({ type: 'terminal.exit', code: 7 });
  assert.equal(f.store.state.panes.length, 0);
  f.store.present({ type: 'pane.show', id: 'check-logs' });
  assert.equal(f.store.state.panes[0].terminal?.code, 7);
  assert.match(f.store.state.panes[0].content, /AFTER_CLOSE/);
});
test('background/model activity, Input waits, stale/wrong-root/wrong-turn/wrong-command snapshots cannot open logs', () => {
  const f = fixture();
  for (const snapshot of [
    undefined,
    { ...f.snapshot, steps: [] },
    { ...f.snapshot, at: Date.now() - 2000 },
    { ...f.snapshot, at: Date.now() + 1000 },
    { ...f.snapshot, turnToken: randomUUID() },
    { ...f.snapshot, conversationId: 'child' },
    { ...f.snapshot, steps: [8] },
  ])
    f.gate.update(snapshot, true);
  f.gate.update(f.snapshot, false);
  assert.equal(f.store.state.panes.length, 0);
  f.event({ type: 'terminal.exit', code: 0 });
  f.gate.update(f.snapshot, true);
  assert.equal(f.store.state.panes.length, 0, 'late evidence cannot resurrect a completed command');
});
test('buffer is bounded and a full/protected layout never crashes or stops a command', () => {
  const f = fixture();
  for (let i = 0; i < 200; i++)
    f.event({
      type: 'terminal.append',
      stream: i % 2 ? 'stderr' : 'stdout',
      text: 'x'.repeat(1000),
    });
  f.gate.update(f.snapshot, true);
  assert.ok(f.store.state.panes[0].content.length <= 60000);
  assert.ok(f.emitted.length <= 130);
  const blocked = new WaitingTerminal(f.request, () => {
    throw new Error('Full layout');
  });
  blocked.event({
    type: 'terminal.open',
    id: 'logs',
    runId: f.request.requestId,
    title: 'test',
    subtitle: '',
    size: 1,
  });
  assert.doesNotThrow(() => blocked.update(f.snapshot, true));
  blocked.finish();
  assert.doesNotThrow(() => blocked.update(f.snapshot, true));
});
