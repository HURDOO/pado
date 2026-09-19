import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { StageStore } from '../server/stage.ts';
import { TuiSession } from '../server/tui-session.ts';

// Explicit real-model check in its own workspace, never the shared demo project.
process.env.PADO_PUBLIC_MODE = '1';
process.env.PADO_PUBLIC_SUBAGENTS = '1';
process.env.PADO_PARTICIPANT_TUI = '1';
await mkdir('.pado/public-subagent-proof', { recursive: true });
const root = await mkdtemp(resolve('.pado/public-subagent-proof', 'run-'));
const workspace = resolve(root, 'workspace');
const store = new StageStore('antigravity');
const tui = new TuiSession(store, undefined, { root, workspace });
const participant = { id: 'subagent-proof', nickname: 'Subagent proof', admin: false };
const evidence = { seen: false, output: false, completed: false };
const unsubscribe = store.subscribe(() => {
  for (const pane of store.state.panes.filter((entry) => entry.kind === 'subagent')) {
    evidence.seen = true;
    evidence.output ||= !!pane.subagent?.output?.includes('PUBLIC_CHILD_OK');
    evidence.completed ||= !!pane.subagent?.closeAt;
  }
});
try {
  await tui.ensure();
  for (let index = 0; index < 30; index++) {
    if (tui.snapshot().text?.includes('for shortcuts')) break;
    await delay(1000);
  }
  assert.equal(tui.snapshot().status, 'ready');
  store.raise(participant);
  const prompt =
    'Verify real subagent delegation for this trusted hackathon demo. Use invoke_subagent with Type self exactly once, without defining a custom agent. Give the child this task: use run_command with Cwd /workspace and CommandLine exactly node /opt/pado/present.mjs exec child-proof --quiet node -e \'require("node:fs").writeFileSync("child-proof.txt","PUBLIC_CHILD_OK");console.log("PUBLIC_CHILD_OK")\'. This helper runs code in the credential-free app container. Do not use native file tools, other commands, browser, credentials or settings. Send one short interim message with send_message before running the helper. Then return PUBLIC_CHILD_OK as the final child response, not a second message. Parent: wait for the actual final child response, then reply PUBLIC_DELEGATION_DONE. Do not simulate a child, do its work yourself or create panes manually.';
  await tui.input(participant, `\x15\x1b[200~${prompt}\x1b[201~\r`);
  let complete = false;
  for (let index = 0; index < 120; index++) {
    await delay(2000);
    const result = await readFile(resolve(workspace, 'child-proof.txt'), 'utf8').catch(() => '');
    if (evidence.completed && result === 'PUBLIC_CHILD_OK' && !store.state.turn) {
      complete = true;
      break;
    }
    if (index % 10 === 0)
      console.log(JSON.stringify({ ...evidence, running: !!store.state.turn, file: !!result }));
  }
  const bridge = resolve(root, 'tui', (await readdir(resolve(root, 'tui')))[0]);
  const audit = (await readFile(resolve(bridge, 'public-policy.ndjson'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(audit.some((entry) => entry.tool === 'invoke_subagent' && entry.decision === 'allow'));
  assert.ok(evidence.seen, 'Real child must open a Subagent pane');
  assert.ok(evidence.output, 'Real child output must reach the pane');
  assert.ok(evidence.completed, 'Child completion must schedule pane close');
  assert.ok(complete, 'Child app work and parent turn must finish');
  await delay(3500);
  assert.equal(store.state.panes.filter((pane) => pane.kind === 'subagent').length, 0);
  console.log(JSON.stringify({ publicSubagentSmoke: 'passed', ...evidence, complete }));
} finally {
  unsubscribe();
  await tui.stop();
  console.log('Proof artifacts retained under .pado/public-subagent-proof');
}
