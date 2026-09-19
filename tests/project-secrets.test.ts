import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ProjectSecrets, SecretOutputFilter } from '../server/project-secrets.ts';
import { presentationSchema, runtimeRequestSchema, secretNameSchema } from '../shared/protocol.ts';
import { StageStore } from '../server/stage.ts';
import { Runner } from '../server/runner.ts';

const secretPane = {
  id: 'api-key',
  kind: 'input',
  title: 'API 연결',
  secret: { name: 'DEMO_API_KEY' },
};
const participant = { id: 'alice', nickname: 'Alice', admin: false };

test('secret metadata excludes values/HTML and rejects public or process-control variables', () => {
  const event = presentationSchema.parse({ type: 'pane.upsert', pane: secretPane });
  for (const patch of [
    { content: '<input type="password">' },
    { kind: 'docs' },
    { secret: { name: 'DEMO_API_KEY', value: 'never-in-presentation' } },
  ])
    assert.equal(
      presentationSchema.safeParse({ type: 'pane.upsert', pane: { ...secretPane, ...patch } })
        .success,
      false,
    );
  for (const name of [
    'PATH',
    'NODE_OPTIONS',
    'VITE_API_KEY',
    'NEXT_PUBLIC_KEY',
    'LD_PRELOAD',
    'PADO_RUNNER',
    'bad-name',
    'A=B',
  ])
    assert.equal(secretNameSchema.safeParse(name).success, false, name);
  assert.equal(
    runtimeRequestSchema.safeParse({
      requestId: randomUUID(),
      action: 'exec',
      id: 'test',
      command: ['node', 'test.mjs'],
      secrets: ['NODE_OPTIONS'],
    }).success,
    false,
  );
  const store = new StageStore();
  store.raise(participant);
  store.begin(participant, 'API 연결');
  store.present(event);
  assert.throws(() => store.validateAnswer(secretPane.id, { value: 'secret' }), /전용 입력/);
  assert.equal(store.checkpoint().panes.length, 0);
});

test('project values persist privately, merge concurrent updates and select only named variables', async () => {
  const root = resolve('.pado/unit-secrets', randomUUID());
  const first = new ProjectSecrets(resolve(root, 'a'));
  const second = new ProjectSecrets(resolve(root, 'b'));
  assert.deepEqual(await first.names(), []);
  await Promise.all([
    first.set('DEMO_API_KEY', 'demo-only-one'),
    first.set('DATABASE_PASSWORD', 'demo-only-two'),
  ]);
  await second.set('DEMO_API_KEY', 'other-project');
  assert.deepEqual(await new ProjectSecrets(resolve(root, 'a')).names(), [
    'DATABASE_PASSWORD',
    'DEMO_API_KEY',
  ]);
  assert.deepEqual(await first.environment(['DEMO_API_KEY']), { DEMO_API_KEY: 'demo-only-one' });
  assert.deepEqual(await first.environment([]), {});
  assert.deepEqual(await second.environment(['DEMO_API_KEY']), { DEMO_API_KEY: 'other-project' });
  await assert.rejects(first.environment(['MISSING_KEY']), /설정이 필요/);
  assert.equal((await stat(resolve(root, 'a/secrets.json'))).mode & 0o777, 0o600);
  await first.set('DEMO_API_KEY', 'replacement');
  assert.equal((await first.environment(['DEMO_API_KEY'])).DEMO_API_KEY, 'replacement');
});

test('secret submission sends only names/status to the waiting agent and blocks duplicates', async (t) => {
  const root = resolve('.pado/unit-secrets', randomUUID());
  await mkdir(root, { recursive: true });
  const store = new StageStore('antigravity');
  store.raise(participant);
  store.begin(participant, 'API 연결');
  store.present(presentationSchema.parse({ type: 'pane.upsert', pane: secretPane }));
  const runner = new Runner(store, { root });
  let answer: unknown;
  t.mock.method(runner.tui, 'assertCanSubmit', () => {});
  t.mock.method(runner.tui, 'submit', async (_id: string, values: unknown) => {
    answer = values;
  });
  await runner.submitSecret(secretPane.id, 'demo-value-never-sent');
  assert.deepEqual(answer, { name: 'DEMO_API_KEY', configured: 'true' });
  assert.equal(store.state.panes[0].status, 'done');
  assert.equal(store.state.phase, 'running');
  assert.equal(JSON.stringify(store.state).includes('demo-value-never-sent'), false);
  assert.equal(
    JSON.parse(await readFile(resolve(root, 'secrets.json'), 'utf8')).DEMO_API_KEY,
    'demo-value-never-sent',
  );
  await assert.rejects(runner.submitSecret(secretPane.id, 'rejected'), /종료/);
  await assert.rejects(runner.submit(secretPane.id, { value: 'rejected' }), /종료/);
  store.finish(store.state.turn!.id);
  assert.equal(JSON.stringify(store.checkpoint()).includes('demo-value-never-sent'), false);
});

test('output masking handles every chunk boundary, regex symbols, repetitions and flushes', () => {
  const secret = 'demo.$[key]\\token';
  const input = `before ${secret} after ${secret}!`;
  for (let split = 0; split <= input.length; split++) {
    const filter = new SecretOutputFilter([secret]);
    const output =
      filter.write(input.slice(0, split)) +
      filter.write(input.slice(split)) +
      filter.write('', true);
    assert.equal(output, 'before [REDACTED] after [REDACTED]!', `split ${split}`);
  }
  const filter = new SecretOutputFilter([secret]);
  let output = '';
  for (const char of input) output += filter.write(char);
  output += filter.write('', true);
  assert.equal(output, 'before [REDACTED] after [REDACTED]!');
  assert.equal(new SecretOutputFilter([]).write('normal output'), 'normal output');
});
