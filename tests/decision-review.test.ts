import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { paneSchema, presentationSchema } from '../shared/protocol.ts';
import { StageStore } from '../server/stage.ts';

const alice = { id: 'alice', nickname: 'Alice', admin: false };
const decision = {
  question: '어떤 배치가 좋을까요?',
  options: [
    {
      id: 'cards',
      title: '카드형',
      summary: '본문을 읽기 편함',
      tradeoff: '표시 개수가 적음',
      preview: '<article>질문</article>',
    },
    {
      id: 'list',
      title: '목록형',
      summary: '빠른 훑어보기',
      tradeoff: '본문 공간이 적음',
      preview: '<div>질문 1</div><div>질문 2</div>',
    },
  ],
};
function input() {
  return presentationSchema.parse({
    type: 'pane.upsert',
    pane: { id: 'choice', kind: 'input', title: '비교 선택', decision },
  });
}
function review(runId?: string, status = 'passed', evidence = 'node --test: 1 test passed') {
  return presentationSchema.parse({
    type: 'pane.upsert',
    pane: {
      id: 'review',
      kind: 'review',
      title: '검토',
      review: {
        summary: '선택한 배치를 적용했습니다.',
        changes: [],
        checks: [{ id: 'test', label: '단위 검증', status, evidence, ...(runId ? { runId } : {}) }],
        limitations: [],
      },
    },
  });
}
test('comparison schema isolates HTML, bounds choices and rejects mixed/forged metadata', () => {
  const event = input();
  assert.equal(event.type, 'pane.upsert');
  if (event.type !== 'pane.upsert') return;
  assert.equal(event.pane.content, '');
  for (const patch of [
    { kind: 'docs' },
    { content: '<form>ambiguous</form>' },
    { decision: { ...decision, options: [decision.options[0]] } },
    { decision: { ...decision, options: [decision.options[0], decision.options[0]] } },
    { answer: { optionId: 'cards', note: 'forged' } },
  ])
    assert.equal(
      presentationSchema.safeParse({ ...event, pane: { ...event.pane, ...patch } }).success,
      false,
    );
});
test('structured Input waits, validates exact choice and note, and does not archive an outstanding decision', () => {
  const store = new StageStore();
  store.raise(alice);
  const turn = store.begin(alice, 'compare');
  store.present(input(), turn);
  assert.equal(store.state.phase, 'waiting');
  assert.equal(store.state.focusId, 'choice');
  assert.deepEqual(store.validateAnswer('choice', { optionId: 'cards' }), {
    optionId: 'cards',
    note: '',
  });
  assert.throws(() => store.validateAnswer('choice', { optionId: 'injected' }));
  assert.throws(() => store.validateAnswer('choice', { optionId: 'cards', command: 'inject' }));
  assert.throws(() =>
    store.validateAnswer('choice', { optionId: 'cards', note: 'a'.repeat(1001) }),
  );
  assert.equal(store.canAnswer({ ...alice, id: 'viewer' }, 'choice'), false);
  store.state.panes[0].status = 'done';
  store.running(turn);
  assert.equal(store.state.phase, 'running');
  assert.throws(() => store.validateAnswer('choice', { optionId: 'cards' }));
  assert.equal(store.checkpoint().panes.length, 0);
  assert.equal(store.checkpoint().savedPanes.length, 0);
});
test('Review binds to actual same-turn exit codes, downgrades unknown results and preserves original report on restore', () => {
  const store = new StageStore('rehearsal', () => 1234);
  store.raise(alice);
  const first = store.begin(alice, 'test');
  const run = randomUUID();
  store.recordReviewRun(first, run, 1);
  store.present(review(run), first);
  const check = store.state.panes[0].review!.checks[0];
  assert.equal(check.status, 'failed', 'agent cannot upgrade a failed process to passed');
  assert.deepEqual(check.run, { id: run, code: 1, at: 1234 });
  assert.equal(store.state.panes[0].status, 'error');
  assert.equal(
    presentationSchema.safeParse({ type: 'pane.upsert', pane: store.state.panes[0] }).success,
    false,
    'agent cannot supply verified-run metadata',
  );
  store.finish(first);
  store.raise(alice);
  const second = store.begin(alice, 'next');
  store.present({ type: 'pane.show', id: 'review' });
  assert.equal(
    store.state.panes[0].review!.checks[0].run!.at,
    1234,
    'saved report keeps its original provenance',
  );
  store.recordReviewRun(first, randomUUID(), 0);
  store.present(review(run), second);
  assert.equal(
    store.state.panes[0].review!.checks[0].status,
    'unverified',
    'old turn cannot prove a new check',
  );
  assert.equal(store.state.panes[0].review!.checks[0].run, undefined);
  const current = randomUUID();
  store.recordReviewRun(second, current, 0);
  store.present(review(current, 'failed'), second);
  assert.equal(store.state.panes[0].review!.checks[0].status, 'passed');
  store.recordReviewRun(second, current, null);
  store.present(review(current), second);
  assert.equal(store.state.panes[0].review!.checks[0].status, 'unverified');
});
test('manual evidence is distinct, empty evidence is unverified, and reproduction is sandbox-only', () => {
  const store = new StageStore();
  store.present(review());
  assert.equal(store.state.panes[0].review!.checks[0].status, 'passed');
  assert.equal(store.state.panes[0].review!.checks[0].run, undefined);
  store.present(review(undefined, 'passed', ''));
  assert.equal(store.state.panes[0].review!.checks[0].status, 'unverified');
  const pane = store.state.panes[0];
  for (const reproduction of [
    { port: 22, path: '/' },
    { port: 3000, path: '//example.com' },
    { port: 3000, path: 'https://example.com' },
  ])
    assert.equal(
      paneSchema.safeParse({
        ...pane,
        review: { ...pane.review, checks: [{ ...pane.review!.checks[0], reproduction }] },
      }).success,
      false,
    );
  assert.equal(paneSchema.safeParse({ ...pane, kind: 'docs' }).success, false);
  store.present(
    presentationSchema.parse({
      type: 'pane.upsert',
      pane: {
        ...pane,
        review: {
          ...pane.review,
          checks: [{ ...pane.review!.checks[0], reproduction: { port: 3000, path: '/questions' } }],
        },
      },
    }),
  );
  assert.equal(store.publishesPreview(3000), true);
  assert.equal(store.publishesPreview(5173), false);
  store.present({ type: 'pane.close', id: pane.id });
  assert.equal(
    store.publishesPreview(3000),
    false,
    'saved reviews do not publish hidden app ports',
  );
});
