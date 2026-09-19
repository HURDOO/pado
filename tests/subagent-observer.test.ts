import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const { observeSubagents } = await import(
  new URL('../agent/subagent-observer.mjs', import.meta.url).href
);
const { recordLifecycle } = await import(new URL('../agent/tui-hooks.mjs', import.meta.url).href);

async function fixture() {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), 'pado-observer-')));
  const brain = resolve(directory, 'brain'),
    bridge = resolve(directory, 'bridge');
  const parentId = randomUUID(),
    childId = randomUUID(),
    turnToken = randomUUID();
  const parent = resolve(brain, parentId, '.system_generated');
  const child = resolve(brain, childId, '.system_generated');
  const parentTranscript = resolve(parent, 'logs/transcript.jsonl');
  const childTranscript = resolve(child, 'logs/transcript.jsonl');
  await Promise.all([
    mkdir(resolve(parent, 'logs'), { recursive: true }),
    mkdir(resolve(parent, 'subagents'), { recursive: true }),
    mkdir(resolve(child, 'logs'), { recursive: true }),
    mkdir(bridge),
  ]);
  await writeFile(resolve(bridge, 'stage.json'), JSON.stringify({ turnToken }));
  await writeFile(
    parentTranscript,
    JSON.stringify({
      step_index: 4,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      tool_calls: [{ name: 'invoke_subagent', args: { PRIVATE: true } }],
    }) + '\n',
  );
  await writeFile(
    childTranscript,
    JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      content: 'PRIVATE_PROMPT',
    }) + '\n',
  );
  const value = { conversationId: parentId, transcriptPath: parentTranscript, initialNumSteps: 4 };
  recordLifecycle('start', value, bridge);
  const metadata = {
    conversationId: childId,
    spawnStepIndex: 5,
    state: 'SUBAGENT_STATE_ALIVE',
    subagentDescriptor: { typeName: 'PRIVATE_NAME', role: 'PRIVATE_ROLE' },
    workspaceUris: ['file:///PRIVATE_PATH'],
  };
  const metadataPath = resolve(parent, 'subagents', `${childId}.json`);
  await writeFile(metadataPath, JSON.stringify(metadata));
  const events = async () => {
    try {
      return (await readFile(resolve(bridge, 'subagents.ndjson'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };
  const observe = (event = 'progress', extra = {}) =>
    observeSubagents(event, { ...value, ...extra }, bridge, brain);
  const row = (step_index: number, extra = {}) =>
    appendFile(
      childTranscript,
      JSON.stringify({
        step_index,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: new Date(step_index * 1000).toISOString(),
        ...extra,
      }) + '\n',
    );
  return {
    brain,
    bridge,
    parentId,
    childId,
    turnToken,
    parentTranscript,
    childTranscript,
    metadata,
    metadataPath,
    observe,
    events,
    row,
    value,
  };
}

test('native metadata opens a public worker, messages do not finish it and its final response does', async () => {
  const f = await fixture();
  f.observe();
  assert.equal((await f.events())[0].agent.state, 'working');
  assert.equal((await f.events())[0].childConversationId, f.childId);
  assert.equal(
    (await f.events())[0].agent.id,
    `native-${createHash('sha256')
      .update(f.turnToken + f.childId)
      .digest('hex')
      .slice(0, 40)}`,
  );
  await f.row(1, { tool_calls: [{ name: 'send_message', args: { Message: 'PRIVATE_MESSAGE' } }] });
  f.observe();
  assert.equal((await f.events()).length, 1);
  await f.row(2, { content: 'PRIVATE_FINAL_RESPONSE' });
  f.observe();
  f.observe();
  const events = await f.events();
  assert.deepEqual(
    events.map((event) => event.agent.state),
    ['working', 'idle'],
  );
  assert.equal(events[0].agent.id, events[1].agent.id);
  assert.equal(events[0].agent.name, 'Subagent 1');
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|file:|transcript/);
  assert.ok(!JSON.stringify(events.map((event) => event.agent)).includes(f.childId));
});

test('sending new work resumes a worker without treating its old final response as new completion', async () => {
  const f = await fixture();
  await f.row(1, { content: 'PRIVATE_DONE' });
  f.observe();
  const message = {
    stepIdx: 10,
    toolCall: { name: 'send_message', args: { Recipient: f.childId } },
  };
  f.observe('tool', message);
  f.observe();
  assert.deepEqual(
    (await f.events()).map((event) => event.agent.state),
    ['idle', 'working'],
  );
  await f.row(2, { content: 'PRIVATE_NEW_DONE' });
  f.observe();
  f.observe('tool', message);
  assert.deepEqual(
    (await f.events()).map((event) => event.agent.state),
    ['idle', 'working', 'idle'],
  );
  f.observe('tool', {
    toolCall: { name: 'manage_subagents', args: { Action: 'kill', ConversationIds: [f.childId] } },
  });
  f.observe();
  assert.equal((await f.events()).at(-1).agent.state, 'ended');
});

test('native observer ignores supplied paths and skips old turns, symlinks and oversized metadata', async () => {
  const f = await fixture();
  await writeFile(f.metadataPath, JSON.stringify({ ...f.metadata, spawnStepIndex: 3 }));
  f.observe('progress', { transcriptPath: '/PRIVATE_PATH/transcript.jsonl' });
  assert.equal((await f.events()).length, 0);
  f.observe();
  assert.equal((await f.events()).length, 0);
  await writeFile(f.metadataPath, 'x'.repeat(16_001));
  f.observe();
  assert.equal((await f.events()).length, 0);
  const foreignId = randomUUID();
  await symlink(
    f.metadataPath,
    resolve(f.brain, f.parentId, '.system_generated/subagents', `${foreignId}.json`),
  );
  f.observe();
  assert.equal((await f.events()).length, 0);
  await writeFile(f.metadataPath, JSON.stringify(f.metadata));
  await writeFile(resolve(f.bridge, 'stage.json'), JSON.stringify({ turnToken: randomUUID() }));
  f.observe();
  assert.equal((await f.events()).length, 0);
});

test('a missing or different hook transcript path cannot redirect observation outside the fixed brain root', async () => {
  const f = await fixture();
  f.observe('progress', { transcriptPath: '/PRIVATE_PATH/transcript.jsonl' });
  assert.equal((await f.events())[0].agent.state, 'working');
  await f.row(1, { content: 'PRIVATE_DONE' });
  f.observe('progress', { transcriptPath: undefined });
  assert.equal((await f.events())[1].agent.state, 'idle');
});

test('the first invocation fixes the turn boundary and observer IDs are deterministic', async () => {
  const f = await fixture();
  recordLifecycle('start', { ...f.value, initialNumSteps: 100 }, f.bridge);
  f.observe();
  const id = (await f.events())[0].agent.id;
  assert.match(id, /^native-[a-f0-9]{40}$/);
  const saved = resolve(f.brain, f.parentId, '.system_generated/pado-subagents.json');
  await writeFile(saved, '{}');
  f.observe();
  assert.equal((await f.events())[1].agent.id, id);
});
