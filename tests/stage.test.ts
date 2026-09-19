import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StageStore } from '../server/stage.ts';
import { presentationSchema, speakerLeaseMs, type Session } from '../shared/protocol.ts';

const alice: Session = { id: 'alice', nickname: 'Alice', admin: false };
const bob: Session = { id: 'bob', nickname: 'Bob', admin: false };
const admin: Session = { id: 'admin', nickname: 'Admin', admin: true };
test('project handoff stays busy during an admin submission before native hooks arrive', () => {
  let now = 100;
  const store = new StageStore('antigravity', () => now);
  assert.equal(store.interactionBusy, false);
  store.holdTuiSubmission(admin);
  assert.equal(store.interactionBusy, true);
  now += 5001;
  store.tick();
  assert.equal(store.interactionBusy, false);
  store.raise(alice);
  assert.equal(store.interactionBusy, true);
  const turn = store.beginTui(alice);
  assert.equal(store.interactionBusy, true);
  store.finish(turn);
  assert.equal(store.interactionBusy, false);
});
test('TUI input belongs to the speaker, then the turn owner; spectators stay read-only', () => {
  const store = new StageStore('antigravity');
  assert.throws(() => store.assertTuiControl(alice));
  store.assertTuiControl(admin);
  store.raise(alice);
  store.assertTuiControl(alice);
  store.assertTuiResize(alice);
  assert.throws(() => store.assertTuiResize(admin), /발언자 화면/);
  assert.throws(() => store.assertTuiControl(bob));
  const id = store.beginTui(alice);
  assert.equal(store.state.turn?.prompt, '');
  assert.equal(store.state.speaker, null);
  store.assertTuiControl(alice);
  assert.throws(() => store.raise(bob));
  assert.equal(
    store.state.messages.some((message) => message.author === 'user'),
    false,
  );
  store.finish(id);
  assert.throws(() => store.assertTuiControl(alice));
  store.raise(bob);
  store.assertTuiControl(bob);
});
test('native submission has bounded hook grace, and revoke/reset cancel that grace', () => {
  let now = 0;
  const store = new StageStore('antigravity', () => now);
  store.raise(alice);
  now = speakerLeaseMs - 1;
  store.holdTuiSubmission(alice);
  now = speakerLeaseMs + 1;
  store.tick();
  assert.equal(store.state.speaker?.participantId, alice.id);
  now = speakerLeaseMs + 5001;
  store.tick();
  assert.equal(store.state.speaker, null);
  store.raise(alice);
  store.holdTuiSubmission(alice);
  store.release(admin);
  assert.throws(() => store.beginTui(alice));
  store.reset();
  assert.throws(() => store.assertTuiControl(alice));
});
test('first hand wins, with no queue; lease expires after 30 seconds', () => {
  let now = 1000;
  const store = new StageStore('rehearsal', () => now);
  store.raise(alice);
  assert.equal(store.state.speaker?.expiresAt, now + 30_000);
  assert.throws(() => store.raise(bob), /발언/);
  assert.equal(store.state.speaker?.participantId, 'alice');
  now += 30_000;
  store.raise(bob);
  assert.equal(store.state.speaker?.participantId, 'bob');
  assert.throws(() => store.begin(alice, 'hello'), /발언권/);
});
test('only speaker can submit; active turn prevents competing submissions', () => {
  const store = new StageStore();
  store.raise(alice);
  assert.throws(() => store.begin(bob, 'unauthorized'), /발언권/);
  assert.throws(() => store.begin(alice, '  '), /프롬프트/);
  store.begin(alice, 'Make something');
  assert.equal(store.state.speaker, null);
  assert.throws(() => store.raise(bob));
  assert.throws(() => store.begin(alice, 'duplicate'));
  assert.equal(store.state.messages.filter((m) => m.author === 'user').length, 1);
});
test('administrator can revoke but spectators cannot', () => {
  const store = new StageStore();
  store.raise(alice);
  assert.throws(() => store.release(bob));
  store.release(admin);
  store.raise(bob);
  assert.equal(store.state.speaker?.participantId, 'bob');
});
test('reset invalidates old runner events and completion', () => {
  const store = new StageStore();
  store.raise(alice);
  const id = store.begin(alice, 'first');
  store.reset();
  store.raise(bob);
  const nextId = store.begin(bob, 'next');
  store.present({ type: 'agent.message', text: 'stale event' }, id);
  store.finish(id);
  assert.equal(store.state.turn?.id, nextId);
  assert.equal(
    store.state.messages.some((m) => m.text === 'stale event'),
    false,
  );
});
test('only explicit presentation creates panes; bounded output, focus fallback and private input ownership', () => {
  const store = new StageStore();
  store.raise(alice);
  store.begin(alice, 'run');
  assert.equal(store.state.panes.length, 0);
  store.present(
    presentationSchema.parse({
      type: 'pane.upsert',
      pane: { id: 'input', kind: 'input', title: 'Choose' },
    }),
  );
  assert.equal(store.canAnswer(alice, 'input'), true);
  assert.equal(store.canAnswer(admin, 'input'), true);
  assert.equal(store.canAnswer(bob, 'input'), false);
  const runId = randomUUID();
  store.terminal({
    type: 'terminal.open',
    id: 'term',
    runId,
    title: 'Check',
    subtitle: '',
    size: 1,
  });
  for (let i = 0; i < 10; i++)
    store.terminal({
      type: 'terminal.append',
      id: 'term',
      runId,
      stream: 'stdout',
      text: 'a'.repeat(10_000),
    });
  assert.equal(store.state.panes.find((pane) => pane.id === 'term')!.content.length, 60_000);
  store.present({ type: 'pane.close', id: 'term' });
  assert.equal(store.state.focusId, 'input');
  assert.throws(() => presentationSchema.parse({ type: 'pane.resize', id: 'input', size: -1 }));
  assert.throws(() => presentationSchema.parse({ type: 'pane.close', id: '../../secrets' }));
});

test('turn start hides artifacts without losing content; show restores and promotes them', () => {
  const store = new StageStore();
  store.raise(alice);
  const first = store.begin(alice, 'first');
  store.present(
    presentationSchema.parse({
      type: 'pane.upsert',
      pane: { id: 'result', kind: 'file', title: 'Result', content: 'keep me', status: 'done' },
    }),
    first,
  );
  store.finish(first);
  store.raise(bob);
  const second = store.begin(bob, 'continue');
  assert.equal(store.state.panes.length, 0);
  assert.equal(store.state.focusId, 'agent');
  assert.equal(store.knownPanes()[0].visible, false);
  store.present({ type: 'pane.show', id: 'result' }, second);
  assert.equal(store.state.panes[0]?.content, 'keep me');
  assert.equal(store.state.panes[0]?.size, 2);
  const runId = randomUUID();
  store.terminal(
    { type: 'terminal.open', id: 'check', runId, title: 'Check', subtitle: '', size: 1 },
    second,
  );
  store.finish(second, 'stopped');
  assert.equal(
    store.state.panes.find((pane) => pane.id === 'check')?.status,
    'active',
    'turn completion is not process completion',
  );
  store.terminal({ type: 'terminal.exit', id: 'check', runId, code: null });
  assert.equal(store.state.panes.find((pane) => pane.id === 'check')?.status, 'error');
  const version = store.state.focusVersion;
  store.present({ type: 'pane.close', id: 'check' });
  assert.equal(store.state.focusId, 'result');
  assert.ok(store.state.focusVersion > version);
});

test('waiting phase follows all pending inputs, including closing the last request', () => {
  const store = new StageStore();
  store.raise(alice);
  const turn = store.begin(alice, 'choose');
  for (const id of ['one', 'two'])
    store.present(
      presentationSchema.parse({ type: 'pane.upsert', pane: { id, kind: 'input', title: id } }),
      turn,
    );
  assert.equal(store.state.phase, 'waiting');
  store.state.panes.find((pane) => pane.id === 'one')!.status = 'done';
  store.running(turn);
  assert.equal(store.state.phase, 'waiting');
  store.present({ type: 'pane.close', id: 'two' }, turn);
  assert.equal(store.state.phase, 'running');
  assert.equal(store.canAnswer(alice, 'one'), false);
});
