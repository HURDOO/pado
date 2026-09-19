import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentProgress } from '../server/agent-progress.ts';
import { AgentStream } from '../server/agent-stream.ts';
import { StageStore } from '../server/stage.ts';
import type { AgentActivity } from '../shared/protocol.ts';

const cid = '11111111-1111-1111-1111-111111111111';
const invoke = (state: string) => ({
  step_index: 4,
  state,
  tool_name: 'invoke_subagent',
  subagent_info: {
    subagents: [
      {
        type_name: 'accessibility_reviewer',
        role: 'PRIVATE_ROLE',
        initial_prompt: 'PRIVATE_PROMPT',
        conversation_id: cid,
        log_uri: 'file:///PRIVATE_PATH',
      },
    ],
  },
});
test('actual delegation envelopes expose only bounded public names and confirmed states', () => {
  const progress = new AgentProgress();
  assert.equal(progress.read(invoke('ACTIVE'))?.subagents[0].state, 'starting');
  const delegated = progress.read(invoke('DONE'))!;
  assert.deepEqual(delegated.subagents[0], {
    id: 'delegate-4-0',
    name: 'accessibility reviewer',
    state: 'working',
  });
  assert.doesNotMatch(JSON.stringify(delegated), /PRIVATE|file:|11111111/);
  const idle = progress.read({
    state: 'DONE',
    tool_name: 'manage_subagents',
    tool_info: {
      parameters: { Action: 'list' },
      output: `You have 1 active subagent(s):\n${JSON.stringify([{ conversationId: cid, state: 'idle', transcript: 'PRIVATE_PATH' }])}`,
    },
  });
  assert.equal(idle?.subagents[0].state, 'idle');
  assert.equal(
    progress.read({
      state: 'DONE',
      tool_name: 'manage_subagents',
      tool_info: { parameters: { Action: 'kill', ConversationIds: [cid] }, output: 'killed' },
    })?.subagents[0].state,
    'ended',
  );
});
test('malformed and oversized metadata cannot create unlimited cards or leak raw fields', () => {
  const progress = new AgentProgress();
  let last: AgentActivity | undefined;
  for (let index = 0; index < 20; index++)
    last = progress.read({ ...invoke('ACTIVE'), step_index: index }) ?? last;
  assert.equal(last?.subagents.length, 8);
  const invalid = new AgentProgress().read({
    ...invoke('ACTIVE'),
    subagent_info: { subagents: [{ type_name: 'file:///secret' }] },
  });
  assert.equal(invalid?.subagents[0].name, 'Subagent');
});
test('only delegation opens a Subagent pane; file activity and stale updates do not', () => {
  const store = new StageStore('antigravity'),
    session = { id: 'p', nickname: 'P', admin: false };
  store.raise(session);
  const id = store.begin(session, 'delegate');
  const stream = new AgentStream((activity) => store.progress(id, activity));
  stream.push(
    JSON.stringify({
      event: 'step_update',
      step_update: { tool_name: 'view_file', state: 'ACTIVE' },
    }) + '\n',
  );
  assert.equal(store.state.panes.length, 0);
  stream.push(JSON.stringify({ event: 'step_update', step_update: invoke('DONE') }) + '\n');
  assert.equal(store.state.panes.length, 1);
  assert.equal(store.state.panes[0].kind, 'subagent');
  assert.equal(store.state.panes[0].title, 'accessibility reviewer');
  assert.doesNotMatch(JSON.stringify(store.state.panes), /PRIVATE|file:|11111111/);
  assert.equal(store.state.activity?.subagents.length, 1);
  store.finish(id);
  assert.equal(store.state.activity?.subagents[0].state, 'ended');
  store.reset();
  stream.push(JSON.stringify({ event: 'step_update', step_update: invoke('ACTIVE') }) + '\n');
  assert.equal(store.state.activity, null);
  assert.equal(store.state.panes.length, 0);
});
