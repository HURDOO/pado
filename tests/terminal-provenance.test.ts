import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StageStore } from '../server/stage.ts';
import { paneSchema, presentationSchema } from '../shared/protocol.ts';

test('presentation rejects fabricated logs, exit codes and copied process metadata', () => {
  const store = new StageStore();
  for (const event of [
    {
      type: 'pane.upsert',
      pane: {
        id: 'fake',
        kind: 'terminal',
        title: 'Passed',
        content: 'all tests passed',
        status: 'done',
      },
    },
    { type: 'terminal.append', id: 'fake', stream: 'stdout', text: 'all tests passed' },
    { type: 'terminal.exit', id: 'fake', code: 0 },
    { type: 'terminal.ready', id: 'fake', runId: randomUUID() },
    {
      type: 'terminal.open',
      id: 'fake',
      runId: randomUUID(),
      title: 'Fake',
      subtitle: '',
      size: 1,
    },
    {
      type: 'pane.upsert',
      pane: {
        id: 'fake',
        kind: 'docs',
        title: 'Fake',
        terminal: { runId: randomUUID(), startedAt: Date.now() },
      },
    },
  ]) {
    assert.equal(presentationSchema.safeParse(event).success, false);
    assert.throws(() => store.present(event as never));
  }
  assert.equal(store.state.panes.length, 0);
});

test('only the matching process changes a log; hidden output and real exit survive restoration', () => {
  const store = new StageStore();
  const runId = randomUUID();
  const open = {
    type: 'terminal.open' as const,
    id: 'checks',
    runId,
    title: 'Checks',
    subtitle: 'node --test',
    size: 1,
  };
  store.terminal(open);
  assert.equal(store.state.panes[0].content, '');
  for (const kind of ['terminal', 'docs'])
    assert.throws(() =>
      store.present(
        presentationSchema.parse({
          type: 'pane.upsert',
          pane: { id: 'checks', kind, title: 'Fake', content: 'passed' },
        }),
      ),
    );
  store.present({ type: 'pane.close', id: 'checks' });
  store.terminal({
    type: 'terminal.append',
    id: 'checks',
    runId,
    stream: 'stdout',
    text: 'actual output\n',
  });
  store.terminal({
    type: 'terminal.append',
    id: 'checks',
    runId: randomUUID(),
    stream: 'stdout',
    text: 'wrong run',
  });
  assert.equal(store.state.panes.length, 0);
  assert.equal(store.state.focusId, 'agent');
  store.terminal({ type: 'terminal.exit', id: 'checks', runId, code: 2 });
  store.terminal({ type: 'terminal.exit', id: 'checks', runId, code: 0 });
  store.terminal({
    type: 'terminal.append',
    id: 'checks',
    runId,
    stream: 'stdout',
    text: 'after exit',
  });
  store.present({ type: 'pane.show', id: 'checks' });
  assert.equal(store.state.panes[0].content, 'actual output\n');
  assert.equal(store.state.panes[0].terminal?.code, 2);
  assert.equal(store.state.panes[0].status, 'error');
  const restored = new StageStore();
  restored.restore(store.checkpoint());
  assert.deepEqual(restored.state.panes[0], store.state.panes[0]);
  const nextRun = randomUUID();
  restored.terminal({ ...open, runId: nextRun });
  restored.terminal({ type: 'terminal.exit', id: 'checks', runId, code: 0 });
  assert.equal(restored.state.panes[0].status, 'active');
  assert.equal(restored.state.panes[0].content, '');
  restored.interruptTerminals();
  assert.equal(restored.state.panes[0].terminal?.code, null);
  assert.equal(restored.state.panes[0].status, 'error');
});

test('legacy authored logs cannot be restored and interrupted sessions cannot claim live output', () => {
  const store = new StageStore();
  const legacy = paneSchema.parse({
    id: 'legacy',
    kind: 'terminal',
    title: 'Fake',
    content: 'passed',
    status: 'done',
  });
  const docs = paneSchema.parse({ id: 'docs', kind: 'docs', title: 'Keep', content: 'notes' });
  const saved = store.checkpoint();
  store.restore({ ...saved, panes: [legacy, docs], savedPanes: [legacy, docs], focusId: 'legacy' });
  assert.deepEqual(
    store.knownPanes().map((pane) => pane.id),
    ['docs'],
  );
  assert.equal(store.state.focusId, 'agent');
  assert.throws(() => store.present({ type: 'pane.show', id: 'legacy' }));
  store.terminal({
    type: 'terminal.open',
    id: 'running',
    runId: randomUUID(),
    title: 'Running',
    subtitle: '',
    size: 1,
  });
  store.present({ type: 'pane.close', id: 'running' });
  const restored = new StageStore();
  restored.restore(store.checkpoint());
  restored.present({ type: 'pane.show', id: 'running' });
  assert.equal(restored.state.panes[0].status, 'error');
  assert.equal(restored.state.panes[0].terminal?.code, null);
});
