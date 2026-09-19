import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchShellTerminal } from '../server/docker-terminal.ts';

test('Docker shell runs in the project workspace with PTY input, resize and interruption', async () => {
  const workspace = resolve('.pado/shell-smoke', randomUUID());
  await mkdir(workspace, { recursive: true });
  let output = '';
  let exited = false;
  let exitCode: number | null = null;
  const shell = await launchShellTerminal({
    name: `pado-shell-smoke-${randomUUID()}`,
    workspace,
    cols: 80,
    rows: 24,
    onData: (data) => {
      output += data;
    },
    onExit: (code) => {
      exited = true;
      exitCode = code;
    },
  });
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 150 && !predicate(); i++) await delay(50);
    assert.ok(predicate(), 'Expected shell output did not arrive');
  };
  try {
    await shell.resize(80, 24);
    shell.write(
      "printf 'shell-ok' > smoke.txt; pwd; test ! -e /auth && test ! -e /bridge/stage.json && printf 'ISOLATED-%s\\n' OK\r",
    );
    await until(() => output.includes('ISOLATED-OK'));
    assert.ok(output.includes('/workspace'));
    assert.equal(await readFile(resolve(workspace, 'smoke.txt'), 'utf8'), 'shell-ok');
    await shell.resize(60, 18);
    shell.write('stty size\r');
    await until(() => output.includes('18 60'));
    shell.write('sleep 60\r');
    await delay(150);
    shell.write('\x03');
    shell.write("printf 'INTERRUPTED-%s\\n' OK\r");
    await until(() => output.includes('INTERRUPTED-OK'));
    shell.write('exit 7\r');
    await until(() => exited);
    assert.equal(exitCode, 7);
  } finally {
    await shell.stop();
  }
  await until(() => exited);
});
