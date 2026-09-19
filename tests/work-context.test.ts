import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { presentationSchema } from '../shared/protocol.ts';
import { StageStore } from '../server/stage.ts';

const alice = { id: 'alice', nickname: 'Alice', admin: false };
const criteria =
  '## 사용자 요청\n\n- 답변 기능을 추가합니다.\n\n## 에이전트의 가정\n\n- 답변은 하나로 해석했습니다. 사용자 미확인.';
function context(content = criteria, id = 'basis') {
  return presentationSchema.parse({
    type: 'pane.upsert',
    pane: { id, kind: 'context', title: '작업 기준', content },
  });
}
function review(id = 'basis', runId?: string) {
  return presentationSchema.parse({
    type: 'pane.upsert',
    pane: {
      id,
      kind: 'review',
      title: '작업 검토',
      review: {
        summary: '답변 기능을 추가했습니다.',
        changes: [],
        checks: runId ? [{ id: 'test', label: 'API 검사', status: 'passed', runId }] : [],
        limitations: ['실제 기기는 미검증입니다.'],
      },
    },
  });
}
function begin(store: StageStore) {
  store.raise(alice);
  return store.begin(alice, '답변 기능을 추가해줘');
}

test('Context is explicit, nonempty and host-bound; authors cannot forge provenance', () => {
  const store = new StageStore();
  assert.throws(() => store.present(context()), /진행 중/);
  const turn = begin(store);
  assert.equal(store.state.panes.length, 0, 'the host does not invent assumptions from a prompt');
  store.present(context(), turn);
  const pane = store.state.panes[0];
  assert.equal(pane.workContext?.turnId, turn);
  assert.equal(pane.workContext?.content, criteria);
  assert.equal(pane.workContext?.state, 'working');
  assert.equal(presentationSchema.safeParse({ type: 'pane.upsert', pane }).success, false);
  assert.throws(() => context('  '));
  assert.throws(() => store.present(context(criteria, 'second'), turn), /같은 ID/);
  assert.throws(
    () =>
      store.present(
        presentationSchema.parse({
          type: 'pane.upsert',
          pane: { id: 'basis', kind: 'docs', title: 'overwrite' },
        }),
        turn,
      ),
    /Context 또는 Review/,
  );
});

test('Context updates preserve mobile focus, pane order and user-selected size', () => {
  let clock = 1000;
  const store = new StageStore('rehearsal', () => clock);
  const turn = begin(store);
  const originalFocus = store.state.focusVersion;
  store.present(context(), turn);
  assert.equal(store.state.focusId, 'agent');
  assert.equal(store.state.focusVersion, originalFocus);
  store.present({ type: 'pane.resize', id: 'basis', size: 2.5 }, turn);
  store.present(
    presentationSchema.parse({
      type: 'pane.upsert',
      pane: { id: 'choice', kind: 'input', title: '선택', content: '<form />' },
    }),
    turn,
  );
  const version = store.state.focusVersion;
  const order = store.state.panes.map((pane) => pane.id);
  clock = 2000;
  store.present(
    context(criteria + '\n- 수정: 답변을 여러 개 허용합니다. 출처: 사용자 후속 요청.'),
    turn,
  );
  assert.equal(store.state.phase, 'waiting');
  assert.equal(store.state.focusId, 'choice');
  assert.equal(store.state.focusVersion, version);
  assert.deepEqual(
    store.state.panes.map((pane) => pane.id),
    order,
  );
  const pane = store.state.panes.find((pane) => pane.id === 'basis')!;
  assert.equal(pane.size, 2.5);
  assert.equal(pane.workContext?.updatedAt, 2000);
  clock = 3000;
  store.present(context(pane.content), turn);
  assert.equal(store.state.panes.find((pane) => pane.id === 'basis')!.workContext?.updatedAt, 2000);
});

test('Review takes over Context and preserves assumptions without converting them into verified claims', () => {
  const store = new StageStore();
  const turn = begin(store);
  store.present(context(), turn);
  const runId = randomUUID();
  store.recordReviewRun(turn, runId, 1);
  store.present(review('basis', runId), turn);
  assert.equal(store.state.panes.length, 1);
  const pane = store.state.panes[0];
  assert.equal(pane.kind, 'review');
  assert.equal(pane.content, '');
  assert.equal(pane.workContext?.content, criteria);
  assert.equal(pane.review?.checks[0].status, 'failed');
  assert.equal(pane.status, 'error');
  assert.throws(() => store.present(context('silent rewrite'), turn), /Review 이후/);
  assert.throws(() => store.present(review('duplicate'), turn), /기존 ID/);
  store.finish(turn);
  assert.equal(pane.workContext?.state, 'finished');
  assert.equal(pane.status, 'error', 'turn completion does not erase a failed check');
  const restored = new StageStore();
  restored.restore(store.checkpoint());
  assert.deepEqual(restored.state.panes[0], pane);
});

test('a differently named Review replaces its Context even at the pane limit', () => {
  const store = new StageStore();
  const turn = begin(store);
  store.present(context(), turn);
  for (let i = 0; i < 5; i++)
    store.present(
      presentationSchema.parse({
        type: 'pane.upsert',
        pane: { id: `doc-${i}`, kind: 'docs', title: `Doc ${i}` },
      }),
      turn,
    );
  store.present(review('handoff'), turn);
  assert.equal(store.state.panes.length, 6);
  assert.equal(store.state.focusId, 'handoff');
  assert.equal(store.state.panes[0].workContext?.content, criteria);
  assert.equal(
    store.knownPanes().some((pane) => pane.id === 'basis'),
    false,
  );
  assert.equal(store.state.panes[0].review?.checks.length, 0);
});

test('a hidden Context still hands its last criteria to Review', () => {
  const store = new StageStore();
  const turn = begin(store);
  store.present(context(), turn);
  store.present({ type: 'pane.close', id: 'basis' }, turn);
  store.present(review('handoff'), turn);
  assert.equal(store.state.panes[0].workContext?.content, criteria);
  store.present({ type: 'pane.close', id: 'handoff' }, turn);
  store.finish(turn, '중단');
  store.present({ type: 'pane.show', id: 'handoff' });
  assert.equal(store.state.panes[0].workContext?.state, 'interrupted');
});

test('active criteria survive saved-artifact eviction and cannot be overwritten by a process', () => {
  const store = new StageStore();
  const turn = begin(store);
  store.present(context(), turn);
  store.present({ type: 'pane.close', id: 'basis' }, turn);
  for (let i = 0; i < 25; i++) {
    store.present(
      presentationSchema.parse({
        type: 'pane.upsert',
        pane: { id: `report-${i}`, kind: 'docs', title: `Report ${i}` },
      }),
      turn,
    );
    store.present({ type: 'pane.close', id: `report-${i}` }, turn);
  }
  assert.equal(store.checkpoint().savedPanes.length, 24);
  assert.throws(
    () =>
      store.terminal(
        {
          type: 'terminal.open',
          id: 'basis',
          runId: randomUUID(),
          title: '충돌',
          subtitle: '',
          size: 1,
        },
        turn,
      ),
    /실행 로그/,
  );
  store.present(review(), turn);
  assert.equal(store.state.panes[0].workContext?.content, criteria);
});

test('finish without a Review and interrupted/restored turns keep honest lifecycle state', () => {
  for (const error of [undefined, '중단']) {
    const store = new StageStore();
    const turn = begin(store);
    store.present(context(), turn);
    store.present({ type: 'pane.close', id: 'basis' }, turn);
    store.finish(turn, error);
    store.present({ type: 'pane.show', id: 'basis' });
    assert.equal(store.state.panes[0].kind, 'context');
    assert.equal(store.state.panes[0].review, undefined);
    assert.equal(store.state.panes[0].workContext?.state, error ? 'interrupted' : 'finished');
  }
  const store = new StageStore();
  const turn = begin(store);
  store.present(context(), turn);
  const restored = new StageStore();
  restored.restore(store.checkpoint());
  assert.equal(restored.state.panes[0].workContext?.state, 'interrupted');
  assert.equal(restored.state.panes[0].status, 'error');
});

test('new turns and project restores do not inherit old criteria or accept stale publication', () => {
  const store = new StageStore();
  const first = begin(store);
  store.present(context(), first);
  store.finish(first);
  const second = begin(store);
  store.present({ type: 'pane.show', id: 'basis' });
  store.present(review('new-review'), second);
  assert.equal(store.state.panes.find((pane) => pane.id === 'new-review')?.workContext, undefined);
  store.present(context('stale'), first);
  assert.equal(store.state.panes.find((pane) => pane.id === 'basis')?.content, criteria);
  store.finish(second);
  const restored = new StageStore();
  restored.restore(store.checkpoint());
  const third = begin(restored);
  restored.present(review('another-review'), third);
  assert.equal(restored.state.panes[0].workContext, undefined);
  restored.reset();
  const fourth = begin(restored);
  restored.present(context('## 사용자 요청\n\n- 파란색으로 변경합니다.'), fourth);
  assert.equal(
    restored.state.panes.find((pane) => pane.id === 'basis')?.workContext?.turnId,
    fourth,
  );
});
