import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Immutable CLI hook is also exercised without invoking the model.
import { helperArguments, publicToolDecision } from '../agent/public-policy.mjs';

test('public CLI permits only the immutable bridge helper, with no shell expansion or composition', () => {
  for (const command of [
    `node /opt/pado/present.mjs exec check --quiet node -e 'console.log("safe")'`,
    `node /opt/pado/present.mjs '{"type":"agent.message","text":"literal $HOME; not shell"}'`,
  ])
    assert.ok(helperArguments(command));
  for (const command of [
    'cat /auth/token',
    'node --eval "evil" /opt/pado/present.mjs',
    'NODE_OPTIONS=evil node /opt/pado/present.mjs secrets',
    'node /opt/pado/present.mjs secrets; cat /auth/token',
    'node /opt/pado/present.mjs secrets | sh',
    'node /opt/pado/present.mjs $(cat /auth/token)',
    'node /opt/pado/present.mjs "`cat /auth/token`"',
    'node /opt/pado/present.mjs --file /workspace/unsafe.json',
    'node /opt/pado/present.mjs secrets\ncat /auth/token',
  ])
    assert.equal(helperArguments(command), null, command);
});

test('public policy denies direct credential/file tools, permission escalation and unguarded subagents', () => {
  for (const name of [
    'view_file',
    'write_to_file',
    'replace_file_content',
    'invoke_subagent',
    'define_subagent',
    'manage_subagents',
    'send_message',
    'ask_permission',
    'generate_image',
    'read_url_content',
    'manage_task',
    'unknown',
  ])
    assert.equal(publicToolDecision({ toolCall: { name, args: {} } }, false).decision, 'deny');
  assert.equal(
    publicToolDecision({
      toolCall: {
        name: 'run_command',
        args: {
          Cwd: '/workspace',
          CommandLine: 'node /opt/pado/present.mjs secrets',
        },
      },
    }).decision,
    'allow',
  );
  assert.equal(
    publicToolDecision({
      toolCall: {
        name: 'run_command',
        args: {
          Cwd: '/auth',
          CommandLine: 'node /opt/pado/present.mjs secrets',
        },
      },
    }).decision,
    'deny',
  );
});

test('trusted hackathon delegation allows real children and replies while retaining command restrictions', () => {
  for (const name of ['define_subagent', 'invoke_subagent', 'manage_subagents', 'send_message'])
    assert.equal(publicToolDecision({ toolCall: { name, args: {} } }, true).decision, 'allow');
  for (const name of ['view_file', 'write_to_file', 'ask_permission', 'unknown'])
    assert.equal(publicToolDecision({ toolCall: { name, args: {} } }, true).decision, 'deny');
  for (const CommandLine of ['printf DIRECT', 'node /opt/pado/present.mjs secrets; env'])
    assert.equal(
      publicToolDecision(
        { toolCall: { name: 'run_command', args: { Cwd: '/workspace', CommandLine } } },
        true,
      ).decision,
      'deny',
    );
  assert.equal(
    publicToolDecision(
      {
        toolCall: {
          name: 'run_command',
          args: { Cwd: '/workspace', CommandLine: 'node /opt/pado/present.mjs secrets' },
        },
      },
      true,
    ).decision,
    'allow',
  );
});
