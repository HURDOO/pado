import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { paneSchema, presentationSchema } from '../shared/protocol.ts';
import { StageStore } from '../server/stage.ts';
import { ShellSessions } from '../server/shell-sessions.ts';
import type { launchShellTerminal } from '../server/docker-terminal.ts';

const owner = { id: 'owner', nickname: 'Owner', admin: false };
const other = { id: 'other', nickname: 'Other', admin: false };
const admin = { id: 'admin', nickname: 'Admin', admin: true };
function fixture() {
  const store = new StageStore('antigravity');
  const id = `user-${randomUUID()}`;
  store.addManualPane(
    paneSchema.parse({
      id,
      kind: 'terminal',
      title: '터미널',
      manual: true,
      shell: true,
      terminal: { runId: randomUUID(), startedAt: Date.now() },
    }),
  );
  const writes: string[] = [];
  let stops = 0;
  let launches = 0;
  let options!: Parameters<typeof launchShellTerminal>[0];
  let gate = Promise.resolve();
  const shells = new ShellSessions(
    store,
    resolve('.pado/unit-shell', randomUUID()),
    async (value) => {
      launches++;
      options = value;
      await gate;
      return {
        write: (data) => {
          writes.push(data);
        },
        resize: async () => {},
        pause: () => {},
        resume: () => {},
        stop: async () => {
          stops++;
          options.onExit(0);
        },
      };
    },
  );
  return {
    store,
    id,
    shells,
    writes,
    stops: () => stops,
    launches: () => launches,
    output: (data: string) => options.onData(data),
    exit: (code = 0) => options.onExit(code),
    block: () => {
      let release!: () => void;
      gate = new Promise((done) => {
        release = done;
      });
      return release;
    },
  };
}

test('manual shell input requires the current server lease and current terminal epoch', async () => {
  const f = fixture();
  await assert.rejects(f.shells.start(other, f.id), /발언자/);
  assert.equal(f.launches(), 0);
  f.store.raise(owner);
  await f.shells.start(owner, f.id);
  try {
    const { epoch } = f.shells.snapshot(f.id);
    assert.equal(f.shells.snapshot(f.id).status, 'ready');
    assert.throws(() => f.shells.input(other, f.id, 'evil\r', epoch), /발언자/);
    f.shells.input(owner, f.id, 'pwd\r', epoch);
    f.shells.input(owner, f.id, '\x03', epoch);
    assert.deepEqual(f.writes, ['pwd\r', '\x03']);
    assert.throws(() => f.shells.input(owner, f.id, 'old\r', randomUUID()), /다시 연결/);
    f.store.release(owner);
    assert.throws(() => f.shells.input(owner, f.id, 'late\r', epoch), /발언자/);
    await assert.rejects(f.shells.resize(owner, f.id, 40, 20, epoch), /발언자/);
    f.shells.input(admin, f.id, 'admin\r', epoch);
    f.exit(7);
    assert.equal(f.store.state.panes.find((pane) => pane.id === f.id)?.terminal?.code, 7);
    assert.equal(f.shells.snapshot(f.id).status, 'error');
    await f.shells.start(admin, f.id);
    assert.notEqual(f.shells.snapshot(f.id).epoch, epoch);
    assert.throws(() => f.shells.input(admin, f.id, 'stale\r', epoch), /다시 연결/);
  } finally {
    await f.shells.stop();
  }
});

test('manual panes survive new turns; restoring a saved shell never silently executes it', async () => {
  const f = fixture();
  f.store.present({
    type: 'pane.upsert',
    pane: {
      id: 'docs',
      kind: 'docs',
      title: '계획',
      content: '계획',
      size: 1,
      status: 'done',
      subtitle: '',
    },
  });
  f.store.showManualPane('docs');
  f.store.present({
    type: 'pane.upsert',
    pane: {
      id: 'docs',
      kind: 'docs',
      title: '계획',
      content: '갱신한 계획',
      size: 1,
      status: 'done',
      subtitle: '',
    },
  });
  assert.equal(f.store.state.panes.find((pane) => pane.id === 'docs')?.manual, true);
  f.store.raise(owner);
  f.store.beginTui(owner);
  assert.deepEqual(new Set(f.store.state.panes.map((pane) => pane.id)), new Set([f.id, 'docs']));
  const restored = new StageStore('antigravity');
  restored.restore(f.store.checkpoint());
  assert.equal(restored.state.panes.find((pane) => pane.id === f.id)?.terminal?.code, null);
  assert.equal(f.shells.snapshot(f.id).status, 'stopped');
  assert.equal(f.launches(), 0);
  assert.equal(
    presentationSchema.safeParse({
      type: 'pane.upsert',
      pane: { id: f.id, kind: 'docs', title: 'forged' },
    }).success,
    false,
  );
  assert.equal(
    presentationSchema.safeParse({
      type: 'pane.upsert',
      pane: { id: 'other', kind: 'docs', title: 'forged', manual: true },
    }).success,
    false,
  );
  assert.throws(
    () =>
      f.store.terminal({
        type: 'terminal.open',
        id: f.id,
        runId: randomUUID(),
        title: 'forged',
        size: 1,
        subtitle: '',
      }),
    /직접 연/,
  );
  assert.throws(() => f.store.showManualPane('missing'), /없습니다/);
});

test('closing during startup waits for Docker ownership and stops the shell exactly once', async () => {
  const f = fixture();
  const release = f.block();
  const starting = f.shells.start(admin, f.id);
  const closing = f.shells.close(f.id);
  release();
  await Promise.all([starting, closing]);
  assert.equal(f.launches(), 1);
  assert.equal(f.stops(), 1);
  assert.equal(f.shells.snapshot(f.id).status, 'stopped');
});

test('a lease expiring during startup stops the process and rejects further input', async () => {
  const f = fixture();
  const release = f.block();
  f.store.raise(owner);
  const starting = f.shells.start(owner, f.id);
  f.store.release(owner);
  release();
  await assert.rejects(starting, /시작하지 못했습니다/);
  assert.equal(f.stops(), 1);
  assert.notEqual(f.shells.snapshot(f.id).status, 'ready');
});

test('pane closure stops hidden shells and preserves terminal completion metadata', async () => {
  const f = fixture();
  await f.shells.start(admin, f.id);
  f.store.present({ type: 'pane.close', id: f.id });
  f.shells.reconcile();
  await f.shells.close(f.id);
  assert.equal(f.stops(), 1);
  assert.throws(() => f.shells.snapshot(f.id), /닫혔습니다/);
  f.store.showManualPane(f.id);
  assert.notEqual(f.store.state.panes[0].terminal?.finishedAt, undefined);
  assert.equal(f.shells.snapshot(f.id).status, 'stopped');
});
