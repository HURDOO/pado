import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const { recordLifecycle } = await import(new URL('../agent/tui-hooks.mjs', import.meta.url).href);

async function fixture() {
  const bridge = await mkdtemp(resolve(tmpdir(), 'pado-tui-hooks-'));
  const turnToken = randomUUID();
  await writeFile(resolve(bridge, 'stage.json'), JSON.stringify({ turnToken, panes: [] }));
  const events = async () =>
    (await readFile(resolve(bridge, 'lifecycle.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { bridge, turnToken, events };
}

test('native hook publishes only validated lifecycle fields and retains its originating submission', async () => {
  const f = await fixture();
  const value = {
    conversationId: 'child-1',
    invocationNum: 0,
    initialNumSteps: 2,
    workspacePaths: ['/PRIVATE_PATH'],
    transcriptPath: '/PRIVATE_TRANSCRIPT',
    prompt: 'PRIVATE_PROMPT',
  };
  recordLifecycle('start', value, f.bridge);
  await writeFile(
    resolve(f.bridge, 'stage.json'),
    JSON.stringify({ turnToken: randomUUID(), panes: [] }),
  );
  recordLifecycle(
    'stop',
    { ...value, executionNum: 1, fullyIdle: true, error: 'PRIVATE_ERROR' },
    f.bridge,
  );
  const events = await f.events();
  assert.equal(events.length, 2);
  assert.equal(events[1].turnToken, f.turnToken);
  assert.equal(events[1].error, true);
  assert.equal(events[1].fullyIdle, true);
  assert.equal(events[1].executionNum, 1);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
});

test('duplicate stops preserve their timestamp while a new submission may reuse execution numbers', async () => {
  const f = await fixture();
  const value = { conversationId: 'parent' };
  recordLifecycle('start', value, f.bridge);
  recordLifecycle('stop', { ...value, executionNum: 1, fullyIdle: true }, f.bridge);
  recordLifecycle('start', value, f.bridge);
  recordLifecycle('stop', { ...value, executionNum: 1, fullyIdle: true }, f.bridge);
  const nextToken = randomUUID();
  await writeFile(
    resolve(f.bridge, 'stage.json'),
    JSON.stringify({ turnToken: nextToken, panes: [] }),
  );
  recordLifecycle('start', value, f.bridge);
  recordLifecycle('stop', { ...value, executionNum: 1, fullyIdle: true }, f.bridge);
  const events = await f.events();
  assert.equal(events[3].turnToken, f.turnToken);
  assert.equal(events[3].at, events[1].at);
  assert.equal(events[4].turnToken, nextToken);
  assert.equal(events[5].turnToken, nextToken);
  assert.equal(events[5].executionNum, 1);
});

test('native hooks reject unsafe conversation names and ignore stops with no invocation context', async () => {
  const f = await fixture();
  assert.throws(() => recordLifecycle('start', { conversationId: '../secret' }, f.bridge));
  assert.throws(() => recordLifecycle('other', { conversationId: 'valid' }, f.bridge));
  recordLifecycle('stop', { conversationId: 'unknown', fullyIdle: true }, f.bridge);
  await assert.rejects(readFile(resolve(f.bridge, 'lifecycle.ndjson')), { code: 'ENOENT' });
  recordLifecycle('start', { conversationId: 'valid' }, f.bridge);
  recordLifecycle(
    'stop',
    { conversationId: 'valid', fullyIdle: false, terminationReason: 'error' },
    f.bridge,
  );
  assert.equal((await f.events())[1].error, true);
});
