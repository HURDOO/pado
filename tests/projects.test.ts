import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Projects } from '../server/projects.ts';
import { StageStore } from '../server/stage.ts';
import { presentationSchema } from '../shared/protocol.ts';
import { TuiSession } from '../server/tui-session.ts';

test('native fork/resume selection is saved at shutdown but an explicit reset never revives old cache', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'pado-native-selection-'));
  let selected: string | undefined = 'original';
  const tui = new TuiSession(
    new StageStore('antigravity'),
    async () => ({
      write: () => {},
      resize: async () => {},
      stop: async () => {},
      pause: () => {},
      resume: () => {},
    }),
    {
      root,
      workspace: resolve(root, 'workspace'),
      conversation: 'original',
      onConversation: async (id) => {
        selected = id;
      },
    },
  );
  try {
    await tui.ensure();
    await writeFile(
      resolve(root, 'cli/cache/last_conversations.json'),
      JSON.stringify({ '/workspace': 'forked' }),
    );
    await tui.stop();
    assert.equal(selected, 'forked');
    await tui.ensure();
    await tui.forgetConversation();
    await tui.stop();
    assert.equal(selected, undefined);
  } finally {
    await tui.retire();
  }
});

test('projects adopt legacy files in place and persist isolated stage, conversation and runtime metadata', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'pado-projects-'));
  await mkdir(resolve(root, 'workspace'));
  await writeFile(resolve(root, 'workspace', 'keep.txt'), 'original');
  const registry = await new Projects(root).init();
  const other = await registry.create('새 실험');
  assert.equal(registry.paths('default').workspace, resolve(root, 'workspace'));
  assert.equal(
    registry.paths(other.id).workspace,
    resolve(root, 'projects', other.id, 'workspace'),
  );
  const a = new StageStore();
  a.present(
    presentationSchema.parse({
      type: 'pane.upsert',
      pane: { id: 'tasks', kind: 'tasks', title: 'A', content: '- [x] A' },
    }),
  );
  a.present({ type: 'pane.close', id: 'tasks' });
  await registry.save('default', a.checkpoint());
  await registry.saveConversation('default', 'conversation-a');
  await registry.saveConversation(other.id, 'conversation-b');
  await registry.activate(other.id);
  const restarted = await new Projects(root).init();
  assert.equal(restarted.active.id, other.id);
  assert.equal(await restarted.conversation('default'), 'conversation-a');
  assert.equal(await restarted.conversation(other.id), 'conversation-b');
  assert.equal((await restarted.load(other.id)).savedPanes.length, 0);
  const stage = new StageStore();
  stage.restore(await restarted.load('default'));
  stage.present({ type: 'pane.show', id: 'tasks', size: 3 });
  assert.equal(stage.state.panes[0].content, '- [x] A');
  assert.equal(stage.state.panes[0].size, 3);
  assert.equal(await readFile(resolve(root, 'workspace', 'keep.txt'), 'utf8'), 'original');
  await restarted.saveConversation(other.id);
  assert.equal(await restarted.conversation(other.id), undefined);
  assert.equal(await restarted.conversation('default'), 'conversation-a');
  assert.throws(() => restarted.paths('../../outside'));
  assert.throws(() => restarted.saveConversation(other.id, '../invalid'));
  await assert.rejects(restarted.create(' 새 실험 '));
});

test('renaming a project preserves its identity, path, slot and selected stage', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'pado-project-rename-'));
  const registry = await new Projects(root).init();
  const other = await registry.create('아이디어 보드');
  const paths = registry.paths('default');
  const renamed = await registry.rename('default', ' 해커톤 데스크 ');
  assert.deepEqual(renamed, { id: 'default', name: '해커톤 데스크', slot: 0 });
  assert.deepEqual(registry.paths('default'), paths);
  assert.equal(registry.active.id, 'default');
  await assert.rejects(registry.rename('default', other.name));
  await assert.rejects(registry.rename('default', 'bad\nname'));
  await assert.rejects(registry.rename('missing', 'name'));
  const restored = await new Projects(root).init();
  assert.equal(restored.active.name, '해커톤 데스크');
  assert.equal(restored.list().length, 2);
});

test('foreground updates reuse artifacts, hide at native turn start, exclude Inputs and do not reopen on background output', () => {
  const stage = new StageStore('antigravity');
  const admin = { id: 'admin', nickname: 'Admin', admin: true };
  for (const [id, kind] of [
    ['tasks', 'tasks'],
    ['result', 'browser'],
    ['decision', 'input'],
  ])
    stage.present(
      presentationSchema.parse({
        type: 'pane.upsert',
        pane: { id, kind, title: id, content: id, size: 1 },
      }),
    );
  stage.present({ type: 'pane.focus', id: 'tasks' });
  assert.equal(stage.state.panes[0].id, 'tasks');
  assert.equal(stage.state.panes[0].size, 2);
  const runId = randomUUID();
  stage.terminal({
    type: 'terminal.open',
    id: 'logs',
    runId,
    title: 'Logs',
    subtitle: '',
    size: 1,
  });
  const turn = stage.beginTui(admin);
  assert.equal(stage.state.panes.length, 0);
  assert.equal(stage.state.focusId, 'agent');
  assert.throws(() => stage.present({ type: 'pane.show', id: 'decision' }));
  stage.terminal({
    type: 'terminal.append',
    id: 'logs',
    runId,
    stream: 'stdout',
    text: 'background',
  });
  assert.equal(stage.state.panes.length, 0);
  stage.present({ type: 'pane.show', id: 'tasks', size: 3 });
  stage.present({ type: 'pane.show', id: 'result', size: 3 });
  stage.present({ type: 'pane.resize', id: 'tasks', size: 1 });
  stage.finish(turn);
  assert.equal(stage.state.focusId, 'result');
  assert.deepEqual(
    stage.state.panes.map((pane) => pane.id),
    ['result', 'tasks'],
  );
  stage.reset();
  assert.throws(() => stage.present({ type: 'pane.show', id: 'result' }));
});
