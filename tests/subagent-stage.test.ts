import test from 'node:test';
import assert from 'node:assert/strict';
import { StageStore } from '../server/stage.ts';
import { presentationSchema } from '../shared/protocol.ts';

const alice = { id: 'alice', nickname: 'Alice', admin: false };
test('worker output is turn-fenced, bounded, read-only and cannot create or reopen panes', () => {
  const f = fixture();
  const id = `native-${'a'.repeat(40)}`;
  f.store.subagentOutput(f.turn, id, 'early output');
  assert.equal(f.store.state.panes.length, 0);
  f.update('working', id);
  const pane = f.store.state.panes[0];
  assert.equal(pane.subagent?.output, 'early output');
  f.store.subagentOutput(f.turn, id, 'actual output');
  f.store.subagentOutput(f.turn, id, 'too long'.repeat(3000));
  f.store.subagentOutput(f.turn, id, '\x1b]52;c;unsafe\x07');
  f.store.subagentOutput('wrong-turn', id, 'stale');
  assert.equal(pane.subagent?.output, 'actual output');
  f.update('idle', id);
  const closeAt = pane.subagent?.closeAt;
  f.store.finish(f.turn);
  f.store.subagentOutput(f.turn, id, 'final response');
  assert.equal(pane.subagent?.output, 'final response');
  assert.equal(pane.subagent?.closeAt, closeAt);
  f.time(4000);
  f.store.subagentOutput(f.turn, id, 'late output');
  assert.equal(f.store.state.panes.length, 0);
  f.store.reset();
});
test('the server publishes automatic removal without a client or periodic tick', async (t) => {
  const store = new StageStore('antigravity');
  t.after(() => store.reset());
  store.raise(alice);
  const turn = store.beginTui(alice);
  store.subagent(turn, { id: 'worker', name: 'Subagent 1', state: 'working' });
  store.subagent(turn, { id: 'worker', name: 'Subagent 1', state: 'idle' });
  const deadline = store.state.panes[0].subagent!.closeAt!;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Server did not close the completed pane')),
      5000,
    );
    const unsubscribe = store.subscribe(() => {
      if (store.state.panes.length) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
  assert.ok(Date.now() >= deadline);
  assert.equal(store.state.focusId, 'agent');
});

function fixture() {
  let now = 1000;
  const store = new StageStore('antigravity', () => now);
  store.raise(alice);
  const turn = store.beginTui(alice);
  const update = (state: 'starting' | 'working' | 'idle' | 'ended' | 'error', id = 'worker') =>
    store.subagent(turn, { id, name: 'Subagent 1', state });
  return {
    store,
    turn,
    update,
    time: (value: number) => {
      now = value;
      store.tick();
    },
  };
}

test('concurrent subagents close individually exactly 3 seconds after completion', () => {
  const f = fixture();
  f.update('starting');
  f.update('working', 'second');
  const firstId = f.store.state.panes[0].id;
  f.time(1500);
  f.update('working');
  assert.equal(f.store.state.panes[0].subagent?.startedAt, 1000);
  f.update('idle');
  const pane = f.store.state.panes[0];
  assert.equal(pane.status, 'done');
  assert.deepEqual(pane.subagent, {
    state: 'idle',
    startedAt: 1000,
    finishedAt: 1500,
    closeAt: 4500,
  });
  f.time(2000);
  f.update('ended'); // A later root cleanup must not restart the countdown.
  assert.equal(pane.subagent?.closeAt, 4500);
  f.time(4499);
  assert.equal(f.store.state.panes.length, 2);
  f.time(4500);
  assert.equal(
    f.store.state.panes.some((p) => p.id === firstId),
    false,
  );
  assert.equal(f.store.state.panes[0].subagent?.state, 'working');
  f.update('ended');
  assert.equal(f.store.state.panes.length, 1, 'duplicate completion must not recreate a pane');
  f.store.reset();
});

test('resuming during or after the countdown cancels the old deadline and reopens the same worker', () => {
  const f = fixture();
  f.update('working');
  const paneId = f.store.state.panes[0].id;
  f.update('idle');
  f.time(2000);
  f.update('working');
  assert.equal(f.store.state.panes[0].id, paneId);
  assert.deepEqual(f.store.state.panes[0].subagent, { state: 'working', startedAt: 2000 });
  f.time(4000);
  assert.equal(f.store.state.panes.length, 1);
  f.update('idle');
  f.time(7000);
  assert.equal(f.store.state.panes.length, 0);
  f.update('working');
  assert.equal(f.store.state.panes[0].id, paneId);
  assert.equal(f.store.state.panes[0].subagent?.startedAt, 7000);
  f.store.reset();
});

test('finish and stop settle remaining workers; stale events/reset cannot affect a new turn', () => {
  const f = fixture();
  f.update('working');
  f.update('working', 'other');
  f.time(1200);
  f.update('idle');
  f.time(2000);
  f.store.finish(f.turn, 'Stopped');
  assert.equal(f.store.state.panes[0].subagent?.closeAt, 4200);
  assert.equal(f.store.state.panes[1].subagent?.state, 'error');
  assert.equal(f.store.state.panes[1].subagent?.closeAt, 5000);
  f.store.raise(alice);
  const nextTurn = f.store.beginTui(alice);
  f.store.subagent(nextTurn, { id: 'worker', name: 'Subagent 1', state: 'working' });
  const nextId = f.store.state.panes.at(-1)!.id;
  f.time(5000);
  f.update('error');
  assert.deepEqual(
    f.store.state.panes.map((p) => p.id),
    [nextId],
  );
  assert.equal(f.store.state.panes[0].status, 'active');
  f.store.reset();
  f.time(9000);
  f.store.subagent(nextTurn, { id: 'worker', name: 'Subagent 1', state: 'working' });
  assert.equal(f.store.state.panes.length, 0);
});

test('dismissal is respected, focus falls back, and active Input keeps attention', () => {
  const f = fixture();
  f.store.present(
    presentationSchema.parse({
      type: 'pane.upsert',
      pane: { id: 'choice', kind: 'input', title: 'Choose' },
    }),
    f.turn,
  );
  f.update('working');
  assert.equal(f.store.state.focusId, 'choice');
  const pane = f.store.state.panes[1];
  f.store.present({ type: 'pane.focus', id: pane.id });
  f.store.present({ type: 'pane.close', id: pane.id });
  assert.equal(f.store.state.focusId, 'choice');
  f.update('working');
  f.update('idle');
  assert.equal(f.store.state.panes.length, 1);
  f.update('working');
  assert.equal(f.store.state.panes.length, 2);
  f.store.reset();
});

test('worker metadata is validated, lifecycle cannot be forged by presentation, and capacity is separate', () => {
  const f = fixture();
  f.store.subagent(f.turn, { id: '../secret', name: 'Bad', state: 'working' });
  f.store.subagent(f.turn, { id: 'valid', name: '/private/secret', state: 'working' });
  assert.equal(f.store.state.panes.length, 0);
  for (let index = 0; index < 6; index++)
    f.store.present(
      presentationSchema.parse({
        type: 'pane.upsert',
        pane: { id: `doc-${index}`, kind: 'docs', title: 'Public' },
      }),
      f.turn,
    );
  for (let index = 0; index < 10; index++) f.update('working', `worker-${index}`);
  assert.equal(f.store.state.panes.filter((pane) => pane.kind === 'subagent').length, 8);
  assert.equal(f.store.state.panes.filter((pane) => pane.kind === 'docs').length, 6);
  assert.throws(() =>
    f.store.present(
      presentationSchema.parse({
        type: 'pane.upsert',
        pane: { id: 'extra', kind: 'docs', title: 'Extra' },
      }),
    ),
  );
  const pane = f.store.state.panes.find((pane) => pane.kind === 'subagent')!;
  assert.equal(presentationSchema.safeParse({ type: 'pane.upsert', pane }).success, false);
  assert.equal(
    presentationSchema.safeParse({
      type: 'pane.upsert',
      pane: { id: pane.id, kind: 'docs', title: 'Overwrite' },
    }).success,
    false,
  );
  f.store.reset();
});
