import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { StageStore } from '../server/stage.ts';
import { TuiSession } from '../server/tui-session.ts';
import type { launchDockerTerminal } from '../server/docker-terminal.ts';

const alice = { id: 'alice', nickname: 'Alice', admin: false };
const bob = { id: 'bob', nickname: 'Bob', admin: false };
const admin = { id: 'admin', nickname: 'Admin', admin: true };
test('public participants cannot drive CLI menus, inject terminal escapes, or submit twice before lifecycle confirmation', async () => {
  const previous = process.env.PADO_PUBLIC_MODE;
  const previousTui = process.env.PADO_PARTICIPANT_TUI;
  process.env.PADO_PUBLIC_MODE = '1';
  delete process.env.PADO_PARTICIPANT_TUI;
  const f = await fixture();
  try {
    f.store.raise(alice);
    await assert.rejects(f.tui.input(alice, '/config\r'), /프롬프트 입력창/);
    for (const prompt of ['hello\x1b[201~', '@/auth/token', 'please read @/auth/token'])
      await assert.rejects(f.tui.submitPublicPrompt(alice, prompt), /일반 텍스트/);
    await f.tui.submitPublicPrompt(alice, '/config should be treated as text');
    await assert.rejects(f.tui.submitPublicPrompt(alice, 'second'), /현재 작업/);
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    await assert.rejects(f.tui.input(alice, 'yes\r'), /프롬프트 입력창/);
    await f.hook('stop', 'parent', true);
    await until(() => !f.store.state.turn);
    f.store.raise(alice);
    await f.tui.submitPublicPrompt(alice, 'next request');
  } finally {
    await f.tui.stop();
    if (previous === undefined) delete process.env.PADO_PUBLIC_MODE;
    else process.env.PADO_PUBLIC_MODE = previous;
    if (previousTui === undefined) delete process.env.PADO_PARTICIPANT_TUI;
    else process.env.PADO_PARTICIPANT_TUI = previousTui;
  }
});
test('trusted public TUI accepts native keys only from the speaker, turn owner or administrator', async () => {
  const previous = process.env.PADO_PUBLIC_MODE;
  const previousTui = process.env.PADO_PARTICIPANT_TUI;
  process.env.PADO_PUBLIC_MODE = '1';
  process.env.PADO_PARTICIPANT_TUI = '1';
  const f = await fixture();
  try {
    await assert.rejects(f.tui.input(alice, 'no lease'));
    f.store.raise(alice);
    await assert.rejects(f.tui.input(bob, 'other participant'));
    for (const keys of ['/help', '\x1b[A', '\x15', '\r']) {
      await f.tui.input(alice, keys);
      assert.equal(f.input.at(-1), keys);
    }
    await assert.rejects(f.tui.submitPublicPrompt(alice, 'use the form'), /TUI에 직접/);
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    await f.tui.input(alice, '\x1b');
    await assert.rejects(f.tui.input(bob, 'yes\r'));
    await f.tui.input(admin, '\x03');
    await f.hook('stop', 'parent', true);
    await until(() => !f.store.state.turn);
    await assert.rejects(f.tui.input(alice, 'expired owner'));
    f.store.raise(bob);
    await f.tui.input(bob, 'next participant');
    await assert.rejects(f.tui.input(alice, 'previous participant'));
  } finally {
    await f.tui.stop();
    if (previous === undefined) delete process.env.PADO_PUBLIC_MODE;
    else process.env.PADO_PUBLIC_MODE = previous;
    if (previousTui === undefined) delete process.env.PADO_PARTICIPANT_TUI;
    else process.env.PADO_PARTICIPANT_TUI = previousTui;
  }
});
test('resident app warmup does not create or refocus panes, while explicit resume may show logs', async () => {
  const store = new StageStore('antigravity');
  const requestId = randomUUID();
  const tui = new TuiSession(store, undefined, {
    app: {
      requestId,
      action: 'serve',
      id: 'app',
      port: 3000,
      cwd: '.',
      display: 'none',
      command: ['node', 'server.mjs'],
    },
  });
  tui.runtime.execute = async (request, _workspace, emit) => {
    emit({
      type: 'terminal.open',
      id: 'app-logs',
      runId: request.requestId,
      title: '앱 서버 로그',
      subtitle: '',
      command: ['node', 'server.mjs'],
      cwd: '.',
      port: 3000,
      size: 1,
    });
    return { ok: true, output: '' };
  };
  await tui.resumeApp(false, true);
  assert.equal(store.state.panes.length, 0);
  assert.equal(store.state.focusId, 'agent');
  await tui.resumeApp(true);
  assert.equal(store.state.panes[0].id, 'app-logs');
  assert.equal(store.state.focusId, 'app-logs');
});
test('child transcript output reaches its single pane, including final output during the close grace period', async () => {
  const f = await fixture();
  try {
    f.store.raise(alice);
    await f.tui.input(alice, 'delegate\r');
    await f.hook('start', 'parent', false);
    await f.hook('start', 'child', false);
    await until(() => f.store.state.panes.length === 1);
    const context = JSON.parse(await readFile(resolve(f.bridge(), 'subagent-view.json'), 'utf8'));
    const id = f.store.state.activity!.subagents[0].id;
    const output = async (text: string, extra = {}) => {
      await writeFile(
        resolve(f.bridge(), 'subagent-output.json'),
        JSON.stringify([
          {
            ...context,
            at: Date.now(),
            id,
            output: text,
            ...extra,
          },
        ]),
      );
    };
    await output('REAL_CHILD_RESPONSE');
    await until(() => f.store.state.panes[0].subagent?.output === 'REAL_CHILD_RESPONSE');
    await output('WRONG_PARENT', { conversationId: 'other-parent' });
    await output('OLD_TURN', { turnToken: randomUUID() });
    await output('\x1b]52;c;unsafe\x07');
    await f.hook('stop', 'child', true);
    await f.hook('stop', 'parent', true);
    await until(() => !f.store.state.turn);
    const deadline = f.store.state.panes[0].subagent?.closeAt;
    assert.equal(f.store.state.panes[0].subagent?.output, 'REAL_CHILD_RESPONSE');
    await output('FINAL_RESPONSE');
    await until(() => f.store.state.panes[0].subagent?.output === 'FINAL_RESPONSE');
    assert.equal(f.store.state.panes.length, 1);
    assert.equal(f.store.state.panes[0].subagent?.closeAt, deadline);
  } finally {
    await f.tui.stop();
  }
});
test('retired project TUI rejects reconnects and cannot relaunch after shutdown', async () => {
  const f = await fixture();
  await f.tui.ensure();
  await f.tui.retire();
  await assert.rejects(f.tui.ensure(), /전환 중/);
  await assert.rejects(f.tui.input(admin, 'late input'), /전환 중/);
  assert.equal(f.launches(), 1);
  assert.equal(f.stops(), 1);
});
async function until(predicate: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail('Timed out');
}
async function fixture(now = Date.now) {
  process.env.PADO_DATA_DIR = resolve('.pado/unit-tui', randomUUID());
  await mkdir(process.env.PADO_DATA_DIR, { recursive: true });
  const store = new StageStore('antigravity', now);
  let bridge = '';
  let launches = 0;
  let stops = 0;
  const input: string[] = [];
  const launch: typeof launchDockerTerminal = async (options) => {
    launches++;
    bridge = options.bridge;
    return {
      write: (value) => {
        input.push(value);
      },
      resize: async () => {},
      stop: async () => {
        stops++;
      },
      pause: () => {},
      resume: () => {},
    };
  };
  const tui = new TuiSession(store, launch);
  const hook = async (
    event: string,
    conversationId: string,
    fullyIdle: boolean,
    extra: Record<string, unknown> = {},
  ) => {
    const stage = JSON.parse(await readFile(resolve(bridge, 'stage.json'), 'utf8'));
    await appendFile(
      resolve(bridge, 'lifecycle.ndjson'),
      JSON.stringify({
        event,
        conversationId,
        fullyIdle,
        error: false,
        turnToken: stage.turnToken,
        at: Date.now(),
        ...extra,
      }) + '\n',
    );
  };
  const observe = async (
    childConversationId: string,
    state: string,
    extra: Record<string, unknown> = {},
  ) => {
    const { turnToken } = JSON.parse(await readFile(resolve(bridge, 'stage.json'), 'utf8'));
    const id = `native-${createHash('sha256')
      .update(turnToken + childConversationId)
      .digest('hex')
      .slice(0, 40)}`;
    await appendFile(
      resolve(bridge, 'subagents.ndjson'),
      JSON.stringify({
        turnToken,
        conversationId: 'parent',
        childConversationId,
        at: Date.now(),
        agent: { id, name: 'Subagent 9', state },
        ...extra,
      }) + '\n',
    );
  };
  return {
    store,
    tui,
    input,
    hook,
    observe,
    bridge: () => bridge,
    launches: () => launches,
    stops: () => stops,
  };
}

test('native wait snapshots gate only matching unfinished runtime output and never an Input wait', async () => {
  const f = await fixture();
  let finish!: () => void;
  let started = false;
  const completion = new Promise<void>((done) => {
    finish = done;
  });
  try {
    f.tui.runtime.execute = async (request, _workspace, emit) => {
      const base = { id: request.id + '-logs', runId: request.requestId };
      emit({ ...base, type: 'terminal.open', title: '실제 대기', subtitle: '', size: 1 });
      emit({ ...base, type: 'terminal.append', stream: 'stdout', text: 'ACTUAL_OUTPUT' });
      started = true;
      await completion;
      emit({ ...base, type: 'terminal.exit', code: 0 });
      return { ok: true, code: 0, output: 'ACTUAL_OUTPUT' };
    };
    f.store.raise(alice);
    await f.tui.input(alice, 'test\r');
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    const { turnToken } = JSON.parse(await readFile(resolve(f.bridge(), 'stage.json'), 'utf8'));
    const requestId = randomUUID();
    await appendFile(
      resolve(f.bridge(), 'runtime.ndjson'),
      JSON.stringify({
        requestId,
        action: 'exec',
        id: 'wait-check',
        display: 'waiting',
        command: ['node', '--test'],
        waitFor: { conversationId: 'parent', turnToken, step: 4 },
      }) + '\n',
    );
    await until(() => started);
    const snapshot = async (steps: number[], conversationId = 'parent', token = turnToken) => {
      await writeFile(
        resolve(f.bridge(), 'command-wait.json'),
        JSON.stringify([{ conversationId, turnToken: token, at: Date.now(), steps }]),
      );
      await delay(120);
    };
    await snapshot([4], 'child');
    await snapshot([4], 'parent', randomUUID());
    await snapshot([]);
    assert.equal(f.store.state.panes.length, 0);
    f.store.present({
      type: 'pane.upsert',
      pane: {
        id: 'choice',
        kind: 'input',
        title: '사용자 선택',
        content: '<button>선택</button>',
        subtitle: '',
        size: 1,
        status: 'active',
      },
    });
    await snapshot([4]);
    assert.equal(f.store.state.panes.length, 1);
    f.store.present({ type: 'pane.close', id: 'choice' });
    await snapshot([4]);
    await until(() => f.store.state.panes.some((p) => p.id === 'wait-check-logs'));
    assert.equal(f.store.state.focusId, 'agent');
    assert.equal(f.store.state.panes[0].content, 'ACTUAL_OUTPUT');
    finish();
    await until(() => f.store.state.panes[0]?.terminal?.code === 0);
  } finally {
    finish();
    await f.tui.stop();
  }
});

test('quiet runtime results expose a real run ID and attach server-owned review evidence without opening logs', async () => {
  const f = await fixture();
  try {
    f.tui.runtime.execute = async () => ({ ok: false, code: 2, output: 'actual command result' });
    f.store.raise(alice);
    await f.tui.input(alice, 'test\r');
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    const requestId = randomUUID();
    await appendFile(
      resolve(f.bridge(), 'runtime.ndjson'),
      JSON.stringify({
        requestId,
        action: 'exec',
        id: 'check',
        display: 'none',
        command: ['node', '--test'],
      }) + '\n',
    );
    let result: Record<string, unknown> | undefined;
    for (let i = 0; i < 100; i++) {
      result = await readFile(resolve(f.bridge(), `${requestId}.runtime.json`), 'utf8').then(
        JSON.parse,
        () => undefined,
      );
      if (result) break;
      await delay(20);
    }
    assert.equal(result?.runId, requestId);
    assert.equal(f.store.state.panes.length, 0);
    await appendFile(
      resolve(f.bridge(), 'events.ndjson'),
      JSON.stringify({
        type: 'pane.upsert',
        pane: {
          id: 'review',
          kind: 'review',
          title: 'Actual checks',
          review: {
            summary: 'Checked implementation',
            changes: [],
            checks: [
              {
                id: 'test',
                label: 'Test',
                status: 'passed',
                runId: requestId,
                evidence: 'A fabricated passed status must be overridden.',
              },
            ],
            limitations: [],
          },
        },
      }) + '\n',
    );
    await until(() => f.store.state.panes.length === 1);
    const check = f.store.state.panes[0].review!.checks[0];
    assert.equal(check.status, 'failed');
    assert.equal(check.run?.code, 2);
  } finally {
    await f.tui.stop();
  }
});

test('one persistent native process follows real lifecycle hooks and drains presentation before idle', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.tui.ensure(), f.tui.ensure()]);
    assert.equal(f.launches(), 1);
    await assert.rejects(f.tui.input(bob, 'no'));
    f.store.raise(alice);
    f.tui.tick();
    await f.tui.input(alice, 'first\r');
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    assert.equal(f.store.state.turn?.participantId, alice.id);
    await f.hook('start', 'child', false);
    await f.hook('stop', 'child', true);
    await delay(150);
    assert.ok(f.store.state.turn, 'a child completion cannot release the parent turn');
    await appendFile(
      resolve(f.bridge(), 'events.ndjson'),
      JSON.stringify({
        type: 'pane.upsert',
        pane: {
          id: 'proof',
          kind: 'docs',
          title: 'Proof',
          content: 'PUBLIC_RESULT',
          status: 'done',
        },
      }) + '\n',
    );
    await f.hook('stop', 'parent', true);
    await until(() => !f.store.state.turn);
    assert.equal(f.store.state.panes.find((pane) => pane.id === 'proof')?.content, 'PUBLIC_RESULT');
    f.store.raise(bob);
    f.tui.tick();
    await f.tui.input(bob, 'second\r');
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    assert.equal(f.launches(), 1);
    await f.tui.submit('answer', { color: 'blue' });
    await assert.rejects(f.tui.submit('answer', { color: 'red' }));
    assert.deepEqual(
      JSON.parse(await readFile(resolve(f.bridge(), 'answer.answer.json'), 'utf8')),
      { color: 'blue' },
    );
  } finally {
    await f.tui.stop();
  }
  assert.equal(f.stops(), 1);
  await assert.rejects(f.tui.resize(admin, 80, 24));
  assert.equal(f.launches(), 1, 'a resize must never restart an explicitly stopped terminal');
});

test('native child hooks open one public pane and close it exactly three seconds after idle', async () => {
  let now = 1000;
  const f = await fixture(() => now);
  try {
    f.store.raise(alice);
    await f.tui.input(alice, 'delegate\r');
    await f.hook('start', 'private-parent', false);
    await f.hook('start', 'private-child', false);
    await until(() => f.store.state.panes.some((pane) => pane.kind === 'subagent'));
    const first = f.store.state.panes.find((pane) => pane.kind === 'subagent')!;
    assert.equal(first.title, 'Subagent 1');
    assert.equal(first.subagent?.state, 'working');
    assert.doesNotMatch(JSON.stringify(f.store.state), /private-parent|private-child/);
    now += 100;
    await f.hook('start', 'private-child', false);
    await f.hook('stop', 'private-child', false, { executionNum: 1 });
    await f.hook('stop', 'private-parent', false, { executionNum: 1 });
    await delay(150);
    assert.equal(f.store.state.panes.length, 1);
    assert.equal(f.store.state.panes[0].subagent?.startedAt, first.subagent?.startedAt);
    assert.equal(f.store.state.panes[0].subagent?.state, 'working');
    assert.ok(f.store.state.turn);
    await f.hook('stop', 'private-child', true, { executionNum: 1 });
    await until(() => f.store.state.panes[0]?.subagent?.state === 'idle');
    assert.equal(f.store.state.panes[0].subagent?.closeAt, now + 3000);
    now += 2999;
    f.store.tick();
    assert.equal(f.store.state.panes.length, 1);
    now++;
    f.store.tick();
    assert.equal(f.store.state.panes.length, 0);
    assert.ok(f.store.state.turn, 'child idle never releases its parent');
  } finally {
    await f.tui.stop();
  }
});

test('resumed workers cancel closure and duplicate or delayed stops cannot finish their new work', async () => {
  const f = await fixture();
  try {
    f.store.raise(alice);
    await f.tui.input(alice, 'delegate\r');
    await f.hook('start', 'parent', false);
    await f.hook('start', 'child', false);
    await until(() => f.store.state.panes.length === 1);
    const id = f.store.state.panes[0].id;
    const oldAt = Date.now();
    await f.hook('stop', 'child', true, { executionNum: 1, at: oldAt });
    await f.hook('start', 'child', false, { at: oldAt + 1 });
    await delay(150);
    assert.equal(f.store.state.panes[0].id, id);
    assert.equal(f.store.state.panes[0].subagent?.state, 'working');
    assert.equal(f.store.state.panes[0].subagent?.closeAt, undefined);
    await f.hook('stop', 'child', true, { executionNum: 1 });
    await f.hook('stop', 'child', true, { executionNum: 0, at: oldAt });
    await delay(150);
    assert.equal(f.store.state.panes[0].subagent?.state, 'working');
    await f.hook('stop', 'child', true, { executionNum: 2, error: true });
    await until(() => f.store.state.panes[0]?.subagent?.state === 'error');
    assert.ok(f.store.state.panes[0].subagent?.closeAt);
    assert.ok(f.store.state.turn);
  } finally {
    await f.tui.stop();
  }
});

test('previous-turn hooks and unknown stops cannot create workers or end a new turn', async () => {
  const f = await fixture();
  try {
    f.store.raise(alice);
    await f.tui.input(alice, 'first\r');
    const previous = JSON.parse(await readFile(resolve(f.bridge(), 'stage.json'), 'utf8'));
    await f.hook('start', 'parent', false);
    await f.hook('start', 'old-child', false);
    await until(() => !!f.store.state.turn);
    await f.hook('stop', 'parent', true, { executionNum: 1 });
    await until(() => !f.store.state.turn);
    f.store.raise(bob);
    await f.tui.input(bob, 'second\r');
    await f.hook('start', 'old-child', false);
    await delay(150);
    assert.equal(Boolean(f.store.state.turn), false, 'a known child cannot become the root');
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    const id = f.store.state.turn!.id;
    await f.hook('start', 'late-child', false, { turnToken: previous.turnToken });
    await f.hook('stop', 'parent', true, { turnToken: previous.turnToken, executionNum: 1 });
    await f.hook('stop', 'unknown', true, { executionNum: 1 });
    await f.hook('start', '../private-path', false);
    await delay(150);
    assert.equal(f.store.state.turn?.id, id);
    assert.deepEqual(f.store.state.activity?.subagents, []);
    assert.doesNotMatch(JSON.stringify(f.store.state), /late-child|private-path/);
    await f.hook('stop', 'parent', true, { executionNum: 1 });
    await until(() => !f.store.state.turn);
  } finally {
    await f.tui.stop();
  }
});

test('sequential delegation can open later workers after earlier panes have expired', async () => {
  let now = 1000;
  const f = await fixture(() => now);
  try {
    f.store.raise(alice);
    await f.tui.input(alice, 'delegate sequentially\r');
    await f.hook('start', 'parent', false);
    for (let number = 1; number <= 9; number++) {
      await f.hook('start', `child-${number}`, false);
      await f.hook('stop', `child-${number}`, true, { executionNum: 1 });
      await until(() => f.store.state.panes.some((pane) => pane.title === `Subagent ${number}`));
      now += 3000;
      f.store.tick();
      assert.equal(f.store.state.panes.length, 0);
    }
    await f.hook('stop', 'parent', false, { error: true });
    await delay(150);
    assert.ok(f.store.state.turn, 'a root error with background work cannot release the turn');
  } finally {
    await f.tui.stop();
  }
});

test('container metadata progress reaches panes only for its current parent and submission', async () => {
  let now = 1000;
  const f = await fixture(() => now);
  try {
    f.store.raise(alice);
    await f.tui.input(alice, 'native delegation\r');
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    const { turnToken } = JSON.parse(await readFile(resolve(f.bridge(), 'stage.json'), 'utf8'));
    const progress = {
      turnToken,
      conversationId: 'parent',
      childConversationId: 'child',
      at: Date.now(),
      agent: {
        id: `native-${createHash('sha256')
          .update(turnToken + 'child')
          .digest('hex')
          .slice(0, 40)}`,
        name: 'Subagent 1',
        state: 'working',
      },
    };
    const journal = resolve(f.bridge(), 'subagents.ndjson');
    await appendFile(
      journal,
      [
        { ...progress, turnToken: randomUUID() },
        { ...progress, conversationId: 'another-parent' },
        { ...progress, agent: { ...progress.agent, name: '/PRIVATE_PATH' } },
        { ...progress, agent: { ...progress.agent, id: 'native-mismatched' } },
      ]
        .map((event) => JSON.stringify(event) + '\n')
        .join(''),
    );
    await delay(150);
    assert.equal(f.store.state.panes.length, 0);
    await appendFile(journal, JSON.stringify(progress) + '\n');
    await until(() => f.store.state.panes.some((pane) => pane.kind === 'subagent'));
    assert.equal(f.store.state.panes[0].title, 'Subagent 1');
    assert.equal(f.store.state.panes[0].subagent?.state, 'working');
    assert.doesNotMatch(JSON.stringify(f.store.state), /PRIVATE_PATH|another-parent/);
    await f.hook('stop', 'parent', true, { executionNum: 1 });
    await until(() => !f.store.state.turn);
    assert.equal(f.store.state.panes[0].subagent?.state, 'ended');
    assert.equal(f.store.state.panes[0].subagent?.closeAt, now + 3000);
    now += 2999;
    f.store.tick();
    assert.equal(f.store.state.panes.length, 1);
    now++;
    f.store.tick();
    assert.equal(f.store.state.panes.length, 0);
  } finally {
    await f.tui.stop();
  }
});

for (const order of ['hook-first', 'metadata-first', 'same-poll'] as const) {
  test(`hook and metadata merge one native child identity (${order})`, async () => {
    let now = 1000;
    const f = await fixture(() => now);
    try {
      f.store.raise(alice);
      await f.tui.input(alice, 'delegate\r');
      await f.hook('start', 'parent', false);
      await until(() => !!f.store.state.turn);
      if (order === 'metadata-first') {
        await f.observe('child', 'working');
        await until(() => f.store.state.panes.length === 1);
      }
      await f.hook('start', 'child', false);
      if (order === 'hook-first') await until(() => f.store.state.panes.length === 1);
      await f.observe('child', 'working');
      await delay(150);
      assert.equal(f.store.state.panes.length, 1);
      assert.equal(f.store.state.panes[0].title, 'Subagent 1', 'server assigns one stable name');
      const id = f.store.state.panes[0].id;
      const startedAt = Date.now();
      await f.hook('stop', 'child', true, { at: startedAt, executionNum: 1 });
      await until(() => f.store.state.panes[0]?.subagent?.state === 'idle');
      const closeAt = f.store.state.panes[0].subagent!.closeAt!;
      await f.observe('child', 'working', { at: startedAt + 1 });
      await f.hook('start', 'child', false, { at: startedAt - 1 });
      await delay(150);
      assert.equal(f.store.state.panes.length, 1);
      assert.equal(f.store.state.panes[0].id, id);
      assert.equal(f.store.state.panes[0].subagent?.state, 'idle');
      assert.equal(f.store.state.panes[0].subagent?.closeAt, closeAt);
      now = closeAt;
      f.store.tick();
      await f.observe('child', 'working', { at: startedAt + 2 });
      await delay(150);
      assert.equal(
        f.store.state.panes.length,
        0,
        'late observations cannot resurrect expired panes',
      );
      await f.hook('start', 'child', false, { at: startedAt + 3 });
      await until(() => f.store.state.panes.length === 1);
      assert.equal(f.store.state.panes[0].title, 'Subagent 1');
      await f.observe('child', 'idle', { at: startedAt + 4 });
      await f.observe('other-child', 'working', { at: startedAt + 5 });
      await until(() => f.store.state.panes.length === 2);
      assert.equal(f.store.state.panes[0].subagent?.state, 'working');
      assert.equal(f.store.state.panes[1].title, 'Subagent 2');
      assert.doesNotMatch(JSON.stringify(f.store.state), /other-child|"child"/);
    } finally {
      await f.tui.stop();
    }
  });
}

test('a delayed initial start cannot reopen metadata completion, while explicit kill still ends hooked workers', async () => {
  const f = await fixture();
  try {
    f.store.raise(alice);
    await f.tui.input(alice, 'delegate\r');
    await f.hook('start', 'parent', false);
    await until(() => !!f.store.state.turn);
    const at = Date.now();
    await f.observe('child', 'idle', { at: at + 1 });
    await until(() => f.store.state.panes[0]?.subagent?.state === 'idle');
    await f.hook('start', 'child', false, { at });
    await delay(150);
    assert.equal(f.store.state.panes.length, 1);
    assert.equal(f.store.state.panes[0].subagent?.state, 'idle');
    await f.hook('start', 'child', false, { at: at + 2 });
    await until(() => f.store.state.panes[0]?.subagent?.state === 'working');
    await f.observe('child', 'ended', { at: at + 3 });
    await until(() => f.store.state.panes[0]?.subagent?.state === 'ended');
  } finally {
    await f.tui.stop();
  }
});

test('stop during Docker creation waits and terminates the new process before resolving', async () => {
  process.env.PADO_DATA_DIR = resolve('.pado/unit-tui', randomUUID());
  let finish!: () => void;
  let started = false;
  let stopped = false;
  const barrier = new Promise<void>((done) => {
    finish = done;
  });
  const tui = new TuiSession(new StageStore('antigravity'), async () => {
    started = true;
    await barrier;
    return {
      write: () => {},
      resize: async () => {},
      stop: async () => {
        stopped = true;
      },
      pause: () => {},
      resume: () => {},
    };
  });
  const launch = tui.ensure();
  await until(() => started);
  const shutdown = tui.stop();
  finish();
  await Promise.all([launch, shutdown]);
  assert.equal(stopped, true);
  assert.equal(tui.snapshot().status, 'stopped');
});

test('lease handoff clears the old native draft before allowing the next speaker input', async () => {
  const f = await fixture();
  try {
    await f.tui.ensure();
    f.store.raise(alice);
    f.tui.tick();
    await f.tui.input(alice, 'abandoned draft');
    f.store.release(alice);
    f.tui.tick();
    f.store.raise(bob);
    f.tui.tick();
    await f.tui.input(bob, 'new draft');
    assert.deepEqual(f.input, ['abandoned draft', '\x1b', '\x15', 'new draft']);
  } finally {
    await f.tui.stop();
  }
});

test('failed native shutdown is fail-closed', async () => {
  process.env.PADO_DATA_DIR = resolve('.pado/unit-tui', randomUUID());
  const tui = new TuiSession(new StageStore('antigravity'), async () => ({
    write: () => {},
    resize: async () => {},
    stop: async () => {
      throw new Error('no confirmation');
    },
    pause: () => {},
    resume: () => {},
  }));
  await tui.ensure();
  await assert.rejects(tui.stop());
  await assert.rejects(tui.ensure());
});

test('a new native session does not inherit a previous session lease-clear keystroke', async () => {
  const f = await fixture();
  try {
    f.store.raise(alice);
    f.tui.tick();
    await f.tui.input(alice, 'old draft');
    await f.tui.stop();
    f.store.reset();
    await f.tui.ensure();
    f.store.raise(bob);
    f.tui.tick();
    await f.tui.input(bob, 'new session draft');
    assert.deepEqual(f.input, ['old draft', 'new session draft']);
  } finally {
    await f.tui.stop();
  }
});

test('an unconfirmed stop during native startup also blocks all later launches', async () => {
  process.env.PADO_DATA_DIR = resolve('.pado/unit-tui', randomUUID());
  let finish!: () => void;
  let started = false;
  const barrier = new Promise<void>((done) => {
    finish = done;
  });
  const tui = new TuiSession(new StageStore('antigravity'), async () => {
    started = true;
    await barrier;
    return {
      write: () => {},
      resize: async () => {},
      stop: async () => {
        throw new Error('stop failed');
      },
      pause: () => {},
      resume: () => {},
    };
  });
  const launch = tui.ensure();
  await until(() => started);
  const shutdown = tui.stop();
  const rejectedLaunch = assert.rejects(launch);
  const rejectedShutdown = assert.rejects(shutdown);
  finish();
  await Promise.all([rejectedLaunch, rejectedShutdown]);
  await assert.rejects(tui.ensure());
});
