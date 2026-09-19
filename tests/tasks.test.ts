import test from 'node:test';
import assert from 'node:assert/strict';
import { taskMarker, taskSummary } from '../shared/tasks.ts';
import { presentationSchema } from '../shared/protocol.ts';
import { StageStore } from '../server/stage.ts';

test('task statuses are explicit; pending order never implies next', () => {
  const summary = taskSummary(
    '# Work\r\n- [x] shipped\r\n- [-] building\r\n- [ ] first\r\n- [~] paused\r\n1. [X] verified',
  );
  assert.deepEqual(summary, {
    counts: { active: 1, next: 0, pending: 1, paused: 1, done: 2 },
    total: 5,
  });
  assert.deepEqual(taskMarker('[>] **Explicit choice**'), {
    state: 'next',
    text: '**Explicit choice**',
  });
  assert.equal(taskMarker('[?] Unknown'), undefined);
  assert.equal(taskMarker('[x]'), undefined);
});
test('task examples in fenced code and status legends do not count as real work', () => {
  const text = [
    '[x] means complete',
    '```md',
    '- [x] example',
    '```',
    '~~~~',
    '- [>] example',
    '~~~',
    '- [x] still code',
    '~~~~',
    '+ [ ] actual',
    '- [>] next',
    '- [>] conflicting next',
  ].join('\n');
  assert.deepEqual(taskSummary(text), {
    counts: { active: 0, next: 2, pending: 1, paused: 0, done: 0 },
    total: 3,
  });
  assert.equal(taskSummary('').total, 0);
});
test('tasks are explicit shared presentation, read-only and updated under the same ID', () => {
  const store = new StageStore();
  assert.equal(store.state.panes.length, 0);
  const taskEvent = (content: string) =>
    presentationSchema.parse({
      type: 'pane.upsert',
      pane: { id: 'work', kind: 'tasks', title: '할 일', content, subtitle: 'demo/docs/TASKS.md' },
    });
  store.present(taskEvent('- [ ] First'));
  store.present(taskEvent('- [>] First'));
  assert.equal(store.state.panes.length, 1);
  assert.equal(store.state.panes[0].content, '- [>] First');
  assert.equal(store.canAnswer({ id: 'admin', nickname: 'admin', admin: true }, 'work'), false);
  assert.equal(
    presentationSchema.safeParse({
      type: 'pane.upsert',
      pane: { id: 'bad', kind: 'tasks', title: 'Bad', server: { port: 3000, path: '/' } },
    }).success,
    false,
  );
});
