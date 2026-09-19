import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRunError, AgentStream } from '../server/agent-stream.ts';

test('stream handles split UTF-8 and a final envelope without a newline', () => {
  const stream = new AgentStream();
  const source = Buffer.from(
    JSON.stringify({
      event: 'result',
      result: {
        status: 'SUCCESS',
        response: '파도 테스트',
        conversation_id: '11111111-1111-1111-1111-111111111111',
      },
    }),
  );
  for (const byte of source) stream.push(Buffer.from([byte]));
  stream.end();
  assert.deepEqual(stream.completed(0), { success: true, response: '파도 테스트' });
  assert.equal(stream.conversationId, '11111111-1111-1111-1111-111111111111');
});
test('raw tool output never becomes a user response', () => {
  const stream = new AgentStream();
  stream.push(
    JSON.stringify({
      event: 'step_update',
      step_update: { tool_info: { output: 'PRIVATE_TOOL_PAYLOAD' } },
    }) + '\n',
  );
  stream.push(
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '공개 결과' } }) +
      '\n',
  );
  assert.equal(stream.completed(0).response, '공개 결과');
});
test('authentication diagnostics are classified across chunks without exposing contents', () => {
  const stream = new AgentStream();
  stream.diagnostic('Authentic');
  stream.diagnostic('ation required. secret diagnostic content');
  assert.throws(
    () => stream.completed(1),
    (error: unknown) =>
      error instanceof AgentRunError &&
      error.kind === 'authentication' &&
      !error.message.includes('secret'),
  );
});
test('permission failures and nonzero exits do not pass as successful work', () => {
  const stream = new AgentStream();
  stream.push('{"event":"result","result":{"status":"ERROR","error":"Tool permission denied"}}\n');
  assert.throws(
    () => stream.completed(0),
    (error: unknown) => error instanceof AgentRunError && error.kind === 'permission',
  );
  const crash = new AgentStream();
  crash.push('{"event":"result","result":{"status":"SUCCESS","response":"partial"}}\n');
  assert.throws(() => crash.completed(1));
});

test('headless soft-denied tools fail even when the CLI reports SUCCESS with exit zero', () => {
  const stream = new AgentStream();
  stream.diagnostic('no output produced — a tool required the "read_file" permission ');
  stream.diagnostic('that headless mode cannot prompt for, so it was auto-denied.');
  stream.push('{"event":"result","result":{"status":"SUCCESS","response":""}}\n');
  assert.throws(
    () => stream.completed(0),
    (error: unknown) => error instanceof AgentRunError && error.kind === 'permission',
  );
});
test('malformed large streams and duplicate result envelopes are rejected', () => {
  assert.throws(() => new AgentStream().push('x'.repeat(2_000_001)), AgentRunError);
  const stream = new AgentStream();
  const envelope = '{"event":"result","result":{"status":"SUCCESS"}}\n';
  stream.push(envelope);
  assert.throws(() => stream.push(envelope), AgentRunError);
});
