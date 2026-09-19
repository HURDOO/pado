import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AgentSession,
  agentArguments,
  type AgentLaunch,
  type AgentProcess,
} from '../server/agent-session.ts';
import { AgentRunError } from '../server/agent-stream.ts';
import type { Presentation } from '../shared/protocol.ts';

async function root() {
  await mkdir('.pado/tests', { recursive: true });
  return mkdtemp(resolve('.pado/tests/session-'));
}
function fixture() {
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  let complete!: (code: number) => void;
  let stops = 0;
  const process: AgentProcess = {
    stdin,
    stdout,
    stderr,
    closed: new Promise((ok) => {
      complete = ok;
    }),
    stop: async () => {
      stops++;
      complete(143);
    },
  };
  return {
    process,
    complete,
    stops: () => stops,
    success: (id = '11111111-1111-1111-1111-111111111111') => {
      stdout.write(
        JSON.stringify({
          event: 'result',
          result: { status: 'SUCCESS', response: '완료', conversation_id: id },
        }) + '\n',
      );
      complete(0);
    },
  };
}
test('conversation resumes only after successful completion and reset forgets it', async () => {
  const launches: Parameters<AgentLaunch>[0][] = [];
  const session = new AgentSession({
    root: await root(),
    pollMs: 1,
    launch: (options) => {
      launches.push(options);
      const child = fixture();
      child.process.stdin.once('finish', () => child.success());
      return child.process;
    },
  });
  await session.run('first', 'hello', () => {}, new AbortController().signal);
  await session.run('second', 'continue', () => {}, new AbortController().signal);
  assert.equal(launches[0].conversationId, undefined);
  assert.equal(launches[1].conversationId, '11111111-1111-1111-1111-111111111111');
  session.reset();
  await session.run('third', 'start again', () => {}, new AbortController().signal);
  assert.equal(launches[2].conversationId, undefined);
  const args = agentArguments(launches[1]);
  assert.ok(args.includes('--conversation'));
  assert.ok(args.includes('--read-only'));
  assert.ok(args.some((arg) => arg.endsWith('antigravity-cli/settings.json,readonly')));
  assert.equal(
    args.some((arg) => arg.includes('docker.sock') || arg.includes('--dangerously')),
    false,
  );
});
test('presentation journal is completely drained after process completion', async () => {
  const events: Presentation[] = [];
  const session = new AgentSession({
    root: await root(),
    pollMs: 1,
    launch: (options) => {
      const child = fixture();
      child.process.stdin.once('finish', () => {
        void (async () => {
          const lines = Array.from({ length: 200 }, (_, i) =>
            JSON.stringify({ type: 'agent.message', text: `${i}:` + '가'.repeat(300) }),
          );
          await writeFile(resolve(options.bridge, 'events.ndjson'), lines.join('\n') + '\n');
          child.success();
        })();
      });
      return child.process;
    },
  });
  await session.run('drain', 'go', (event) => events.push(event), new AbortController().signal);
  assert.equal(events.length, 200);
  assert.equal(events.at(-1)?.type, 'agent.message');
});
test('input is written atomically once and a competing turn is rejected', async () => {
  const child = fixture();
  let bridge = '';
  let began!: () => void;
  const ready = new Promise<void>((ok) => {
    began = ok;
  });
  const session = new AgentSession({
    root: await root(),
    pollMs: 1,
    launch: (options) => {
      bridge = options.bridge;
      child.process.stdin.once('finish', began);
      return child.process;
    },
  });
  const run = session.run('input', 'ask', () => {}, new AbortController().signal);
  await ready;
  await assert.rejects(session.run('overlap', 'race', () => {}, new AbortController().signal));
  await session.inputError('broken', 'PRIVATE_DIAGNOSTIC');
  await session.inputError('broken', 'duplicate');
  assert.deepEqual(JSON.parse(await readFile(resolve(bridge, 'broken.error.json'), 'utf8')), {
    message: 'PRIVATE_DIAGNOSTIC',
  });
  await session.submit('choice', { selected: '파랑' });
  assert.deepEqual(JSON.parse(await readFile(resolve(bridge, 'choice.answer.json'), 'utf8')), {
    selected: '파랑',
  });
  await assert.rejects(session.submit('choice', { selected: 'duplicate' }));
  child.success();
  await run;
  assert.ok(child.stops() >= 1);
  await assert.rejects(session.submit('choice', {}));
});
test('abort and timeout both stop the real process before permitting another turn', async () => {
  const children: ReturnType<typeof fixture>[] = [];
  const session = new AgentSession({
    root: await root(),
    timeoutMs: 100,
    pollMs: 1,
    launch: () => {
      const child = fixture();
      children.push(child);
      return child.process;
    },
  });
  const controller = new AbortController();
  const aborted = session.run('abort', 'go', () => {}, controller.signal);
  await delay(20);
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  assert.ok(children[0].stops() >= 1);
  await assert.rejects(
    session.run('timeout', 'go', () => {}, new AbortController().signal),
    (e: unknown) => e instanceof AgentRunError && e.kind === 'timeout',
  );
  assert.ok(children[1].stops() >= 1);
  session.assertReady();
});
test('failed stop blocks later execution and journal symlinks never disclose host files', async () => {
  const rootDir = await root();
  const secret = resolve(rootDir, 'private.json');
  await writeFile(secret, JSON.stringify({ type: 'agent.message', text: 'DO_NOT_PUBLISH' }) + '\n');
  const events: Presentation[] = [];
  const session = new AgentSession({
    root: rootDir,
    pollMs: 1,
    launch: (options) => {
      const child = fixture();
      child.process.stdin.once('finish', () => {
        void symlink(secret, resolve(options.bridge, 'events.ndjson')).then(() => child.success());
      });
      child.process.stop = async () => {
        throw new Error('stop failed');
      };
      return child.process;
    },
  });
  await assert.rejects(
    session.run('symlink', 'go', (e) => events.push(e), new AbortController().signal),
  );
  assert.deepEqual(events, []);
  assert.throws(() => session.assertReady());
});
