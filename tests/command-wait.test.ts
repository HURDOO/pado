import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const { bindCommandWait, recordCommandPhase, waitingSteps, CommandWaitObserver } = await import(
  new URL('../agent/command-wait.mjs', import.meta.url).href
);

const command = ['exec', 'check', 'node', '-e', 'console.log("hello")'];
test('normal and public hooks retain both command-return and subagent observation', async () => {
  for (const file of ['tui-hooks.json', 'public-hooks.json']) {
    const hooks = JSON.parse(await readFile(new URL(`../agent/${file}`, import.meta.url), 'utf8'))[
      'pado-stage'
    ].PostToolUse;
    assert.ok(
      hooks.some(
        (entry: { matcher: string; hooks: { command: string }[] }) =>
          entry.matcher === 'run_command' &&
          entry.hooks.some((hook) => hook.command.endsWith(' command-return')),
      ),
      `${file} must observe native command return`,
    );
    assert.ok(
      hooks.some((entry: { matcher: string }) => entry.matcher.includes('invoke_subagent')),
      `${file} must preserve subagent observation`,
    );
  }
});
function call(step = 4, args = command) {
  return {
    step_index: step,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    tool_calls: [
      {
        name: 'run_command',
        args: {
          CommandLine: JSON.stringify(
            'node /opt/pado/present.mjs ' + args.map((a) => "'" + a + "'").join(' '),
          ),
        },
      },
    ],
  };
}
async function fixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'pado-command-wait-')));
  const bridge = resolve(root, 'bridge'),
    brain = resolve(root, 'brain');
  const conversationId = randomUUID(),
    turnToken = randomUUID();
  const logDir = resolve(brain, conversationId, '.system_generated/logs');
  await mkdir(bridge);
  await mkdir(logDir, { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFile(resolve(bridge, name), JSON.stringify(value));
  await write('stage.json', { turnToken });
  await write('subagent-view.json', { conversationId, turnToken });
  await write(`lifecycle-${conversationId}.json`, { turnToken, initialNumSteps: 3 });
  const transcript = resolve(logDir, 'transcript.jsonl');
  const rows = (value: unknown[]) =>
    writeFile(transcript, value.map((v) => JSON.stringify(v)).join('\n') + '\n');
  await rows([call()]);
  return {
    bridge,
    brain,
    conversationId,
    turnToken,
    write,
    rows,
    transcript,
    observer: new CommandWaitObserver(bridge, brain),
    snapshot: async () => JSON.parse(await readFile(resolve(bridge, 'command-wait.json'), 'utf8')),
  };
}
test('native binding uses exact helper argv and current root turn, never a child or completed/reused call', async () => {
  const f = await fixture();
  const expected = { conversationId: f.conversationId, turnToken: f.turnToken, step: 4 };
  assert.deepEqual(bindCommandWait(command, f.bridge, f.brain), expected);
  f.observer.poll();
  assert.deepEqual(
    (await f.snapshot())[0].steps,
    [4],
    'helper entry confirms a pending tool without a progress hook',
  );
  assert.equal(
    bindCommandWait(['exec', 'other', ...command.slice(2)], f.bridge, f.brain),
    undefined,
  );
  await f.rows([call(), { step_index: 5, type: 'GENERIC', status: 'DONE' }]);
  assert.equal(bindCommandWait(command, f.bridge, f.brain), undefined);
  await f.rows([call(), { ...call(6), tool_calls: [{ name: 'invoke_subagent', args: {} }] }]);
  assert.equal(bindCommandWait(command, f.bridge, f.brain), undefined);
  await f.rows([call(8)]);
  assert.equal(bindCommandWait(command, f.bridge, f.brain)?.step, 8);
  await f.write('stage.json', { turnToken: randomUUID() });
  assert.equal(bindCommandWait(command, f.bridge, f.brain), undefined);
});
test('blocked tool, returned background task and genuinely paused invocation are distinct', () => {
  const rows = [call()];
  assert.deepEqual(waitingSteps(rows, 'tools'), [4]);
  assert.deepEqual(waitingSteps(rows, 'thinking'), []);
  assert.deepEqual(waitingSteps(rows, 'idle'), []);
  const background = [...rows, { step_index: 5, type: 'GENERIC', status: 'RUNNING' }];
  assert.deepEqual(waitingSteps(background, 'tools'), [4]);
  assert.deepEqual(waitingSteps(background, 'between-tools'), []);
  assert.deepEqual(waitingSteps(background, 'thinking'), []);
  assert.deepEqual(waitingSteps(background, 'waiting'), [4]);
  assert.deepEqual(
    waitingSteps([...background, { ...call(6), tool_calls: [{ name: 'view_file' }] }], 'tools'),
    [],
  );
  assert.deepEqual(
    waitingSteps(
      [{ ...call(), tool_calls: [...call().tool_calls, ...call().tool_calls] }],
      'tools',
    ),
    [],
  );
  assert.deepEqual(waitingSteps([call(4, ['wait', 'input'])], 'tools'), []);
  assert.deepEqual(
    waitingSteps(
      [{ ...call(), tool_calls: [{ name: 'run_command', args: { CommandLine: 'echo hello' } }] }],
      'tools',
    ),
    [],
  );
});
test('phase and bounded wait snapshots contain identifiers only, reject stale lifecycle and never follow transcript symlinks', async () => {
  const f = await fixture();
  const value = {
    conversationId: f.conversationId,
    transcriptPath: '/PRIVATE',
    prompt: 'PRIVATE',
    toolCall: { args: 'PRIVATE' },
  };
  recordCommandPhase('start', value, f.bridge);
  f.observer.poll();
  assert.deepEqual((await f.snapshot())[0].steps, []);
  recordCommandPhase('progress', value, f.bridge);
  f.observer.poll();
  assert.deepEqual((await f.snapshot())[0].steps, [4]);
  assert.doesNotMatch(JSON.stringify(await f.snapshot()), /PRIVATE|hello|CommandLine/);
  await f.rows([call(), { step_index: 5, type: 'GENERIC', status: 'RUNNING' }]);
  recordCommandPhase('command-return', { ...value, toolCall: { name: 'run_command' } }, f.bridge);
  f.observer.poll();
  assert.deepEqual((await f.snapshot())[0].steps, []);
  recordCommandPhase('stop', { ...value, fullyIdle: false }, f.bridge);
  f.observer.poll();
  assert.deepEqual((await f.snapshot())[0].steps, [4]);
  recordCommandPhase('start', value, f.bridge);
  f.observer.poll();
  assert.deepEqual((await f.snapshot())[0].steps, []);
  await f.write(`lifecycle-${f.conversationId}.json`, {
    turnToken: randomUUID(),
    initialNumSteps: 3,
  });
  assert.equal(bindCommandWait(command, f.bridge, f.brain), undefined);
  const other = await fixture();
  const alias = resolve(other.brain, 'alias');
  await symlink(resolve(other.brain, other.conversationId), alias);
  await other.write('subagent-view.json', { conversationId: 'alias', turnToken: other.turnToken });
  await other.write('lifecycle-alias.json', { turnToken: other.turnToken, initialNumSteps: 3 });
  assert.equal(bindCommandWait(command, other.bridge, other.brain), undefined);
});
