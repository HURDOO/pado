import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runtimeRequestSchema } from '../shared/protocol.ts';
import { AppRuntime } from '../server/app-runtime.ts';
import { StageStore } from '../server/stage.ts';

// Optional Docker integration check. No AI request, network, or host credentials.
await mkdir('.pado/smoke', { recursive: true });
const bridge = await mkdtemp(resolve('.pado/smoke/bridge-'));
const workspace = await mkdtemp(resolve('.pado/smoke/workspace-'));
const base = [
  'run',
  '--network=none',
  '--read-only',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges',
  '--memory=256m',
  '--pids-limit=32',
  '--mount',
  `type=bind,source=${bridge},target=/bridge`,
  '--mount',
  `type=bind,source=${workspace},target=/workspace,readonly`,
  'pado-agent:local',
  'node',
  '/opt/pado/present.mjs',
];
const helper = promisify(execFile)(
  'docker',
  [
    ...base,
    'run',
    'checks',
    'node',
    '-e',
    'console.log("실제 stdout"); console.error("실제 stderr");',
  ],
  { encoding: 'utf8', timeout: 15_000 },
);
// The helper submits a command, never writes terminal content. The host observes its process.
void helper.catch(() => {});
let request;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    request = runtimeRequestSchema.parse(
      JSON.parse((await readFile(resolve(bridge, 'runtime.ndjson'), 'utf8')).trim()),
    );
    break;
  } catch {
    await delay(50);
  }
}
assert.ok(request, 'helper submitted a host runtime request');
assert.equal(request.action, 'run');
const runtime = new AppRuntime();
const stage = new StageStore();
try {
  const result = await runtime.execute(request, workspace, (event) => stage.terminal(event));
  await writeFile(resolve(bridge, `${request.requestId}.runtime.json`), JSON.stringify(result));
  await helper;
  assert.equal(stage.state.panes[0].id, 'checks');
  assert.equal(stage.state.panes[0].terminal?.code, 0);
  assert.match(stage.state.panes[0].content, /실제 stdout/);
  assert.match(stage.state.panes[0].content, /\[stderr\] 실제 stderr/);
  await assert.rejects(readFile(resolve(bridge, 'events.ndjson')), { code: 'ENOENT' });
} finally {
  await runtime.stop();
}
for (const event of [
  {
    type: 'pane.upsert',
    pane: { id: 'fake', kind: 'terminal', title: 'Fake', content: 'passed', status: 'done' },
  },
  { type: 'terminal.append', id: 'checks', stream: 'stdout', text: 'passed' },
  { type: 'terminal.exit', id: 'checks', code: 0 },
]) {
  const rejected = spawnSync('docker', [...base, JSON.stringify(event)], {
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Terminal output is process-owned/);
}
await writeFile(resolve(bridge, 'answer.answer.json'), JSON.stringify({ theme: 'blue' }));
const answer = execFileSync('docker', [...base, 'wait', 'answer'], {
  encoding: 'utf8',
  timeout: 15_000,
});
assert.deepEqual(JSON.parse(answer), { theme: 'blue' });
const input = {
  type: 'pane.upsert',
  pane: {
    id: 'quote-test',
    kind: 'input',
    title: '따옴표 확인',
    content: `<button onclick="window.pado.submit({theme:'ocean'})">Ocean blue</button>`,
  },
};
await writeFile(resolve(workspace, 'event.json'), JSON.stringify(input));
execFileSync('docker', [...base, '--file', '/workspace/event.json'], {
  encoding: 'utf8',
  timeout: 15_000,
});
const published = (await readFile(resolve(bridge, 'events.ndjson'), 'utf8'))
  .trim()
  .split('\n')
  .at(-1)!;
assert.deepEqual(JSON.parse(published), input);
await writeFile(
  resolve(bridge, 'quote-test.error.json'),
  JSON.stringify({ message: 'ocean is not defined' }),
);
const failed = spawnSync('docker', [...base, 'wait', 'quote-test'], {
  encoding: 'utf8',
  timeout: 15_000,
});
assert.equal(failed.status, 1);
assert.match(failed.stderr, /Input UI failed: ocean is not defined/);
execFileSync('docker', [...base, '--file', '/workspace/event.json'], {
  encoding: 'utf8',
  timeout: 15_000,
});
await assert.rejects(readFile(resolve(bridge, 'quote-test.error.json')), { code: 'ENOENT' });
await symlink('/etc/passwd', resolve(workspace, 'escape.json'));
const escape = spawnSync('docker', [...base, '--file', '/workspace/escape.json'], {
  encoding: 'utf8',
  timeout: 15_000,
});
assert.equal(escape.status, 1);
assert.match(escape.stderr, /inside \/workspace/);
console.log(
  'Docker bridge passed: schema, UTF-8 stdout/stderr, input reply, rich HTML JSON, input-error feedback, path boundary. Artifacts retained in .pado/smoke.',
);
