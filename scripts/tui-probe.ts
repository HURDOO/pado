import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { launchDockerTerminal } from '../server/docker-terminal.ts';
import { TerminalScreen } from '../server/terminal-screen.ts';

const root = resolve('.pado/tui-probe', randomUUID());
await mkdir(resolve(root, 'workspace'), { recursive: true });
await mkdir(resolve(root, 'bridge'), { recursive: true });
let child: Awaited<ReturnType<typeof launchDockerTerminal>> | undefined;
const screen = new TerminalScreen(
  100,
  30,
  () => {},
  (data) => child?.write(data),
);
try {
  child = await launchDockerTerminal({
    name: 'pado-tui-probe-' + randomUUID(),
    workspace: resolve(root, 'workspace'),
    bridge: resolve(root, 'bridge'),
    cols: 100,
    rows: 30,
    onData: (data) => {
      void screen.write(data);
    },
    onExit: () => console.log('Native session exited'),
  });
  await delay(1000);
  await child.resize(100, 30);
  await delay(3000);
  await screen.flush();
  console.log('INITIAL SCREEN\n' + screen.snapshot().text);
  const prompt = process.argv[2];
  if (prompt) {
    child.write(prompt + '\r');
    for (let index = 0; index < 12; index++) {
      await delay(5000);
      await screen.flush();
      console.log('SCREEN\n' + screen.snapshot().text);
      const lifecycle = await readFile(resolve(root, 'bridge/lifecycle.ndjson'), 'utf8').catch(
        () => '',
      );
      console.log(
        'Lifecycle: ' +
          lifecycle.replace(/"conversationId":"[^"]+"/g, '"conversationId":"[private]"'),
      );
      if (lifecycle.includes('"fullyIdle":true')) break;
    }
  }
} finally {
  await child?.stop();
  screen.dispose();
  console.log('Probe retained at ' + root);
}
