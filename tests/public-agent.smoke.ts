import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { StageStore } from '../server/stage.ts';
import { TuiSession } from '../server/tui-session.ts';

process.env.PADO_PUBLIC_MODE = '1';
await mkdir('.pado/public-agent-proof', { recursive: true });
const root = await mkdtemp(resolve('.pado/public-agent-proof', 'run-'));
const workspace = resolve(root, 'workspace');
const store = new StageStore('antigravity');
const tui = new TuiSession(store, undefined, { root, workspace });
const participant = { id: 'public-proof', nickname: 'Public proof', admin: false };
try {
  await tui.ensure();
  await delay(5000);
  assert.notEqual(tui.snapshot().status, 'error', 'Native CLI must start');
  store.raise(participant);
  await tui.submitPublicPrompt(
    participant,
    'Run this fixed public deployment smoke test. First try run_command with CommandLine "printf PADO_FORBIDDEN_DIRECT" and Cwd /workspace exactly once; the security policy must deny it. Do not try to bypass that denial. Next use run_command from /workspace with this exact command: node /opt/pado/present.mjs exec public-proof --quiet node -e \'require("node:fs").writeFileSync("public-proof.txt", "PUBLIC_APP_OK")\'. This sends code to the separate app runner. Do not request secrets or other files. After this, reply DONE.',
  );
  let complete = false;
  for (let index = 0; index < 90; index++) {
    await delay(2000);
    const file = await readFile(resolve(workspace, 'public-proof.txt'), 'utf8').catch(() => '');
    if (file === 'PUBLIC_APP_OK' && !store.state.turn) {
      complete = true;
      break;
    }
    if (index % 10 === 0)
      console.log(
        JSON.stringify({
          waiting: true,
          running: !!store.state.turn,
          appProof: file === 'PUBLIC_APP_OK',
          status: tui.snapshot().status,
        }),
      );
  }
  const bridge = resolve(root, 'tui', (await readdir(resolve(root, 'tui')))[0]);
  const audit = (await readFile(resolve(bridge, 'public-policy.ndjson'), 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  console.log(JSON.stringify({ hookDecisions: audit, complete }));
  assert.ok(
    audit.some((entry) => entry.tool === 'run_command' && entry.decision === 'deny'),
    'Native CLI must honor the deny hook',
  );
  assert.ok(
    audit.some((entry) => entry.tool === 'run_command' && entry.decision === 'allow'),
    'Native CLI must allow the immutable bridge helper',
  );
  assert.ok(complete, 'Credential-free app execution must complete');
  console.log('Public native-agent isolation smoke passed');
} finally {
  await tui.stop();
  console.log('Proof artifacts retained under .pado/public-agent-proof');
}
