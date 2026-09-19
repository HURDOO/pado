import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { StageStore } from '../server/stage.ts';
import { TuiSession } from '../server/tui-session.ts';
import { launchDockerTerminal } from '../server/docker-terminal.ts';

const exec = promisify(execFile);
test('real Docker startup/retirement leaves no late-starting project TUI', async () => {
  await mkdir('.pado/startup-proof', { recursive: true });
  const root = await mkdtemp(resolve('.pado/startup-proof', 'run-'));
  for (const cancelEarly of [true, false]) {
    const names: string[] = [];
    const data = resolve(root, cancelEarly ? 'canceled' : 'ready');
    const tui = new TuiSession(
      new StageStore('antigravity'),
      async (options) => {
        names.push(options.name);
        return launchDockerTerminal(options);
      },
      { root: data, workspace: resolve(data, 'workspace') },
    );
    const starting = tui.ensure();
    if (cancelEarly) await delay(10);
    else await starting;
    await tui.retire();
    await starting;
    await assert.rejects(tui.ensure());
    await delay(250);
    for (const name of names) {
      const result = await exec('docker', ['inspect', '--format', '{{.State.Running}}', name]);
      assert.equal(result.stdout.trim(), 'false');
    }
  }
});
