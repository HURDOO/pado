import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Only the fixed host-side launcher signals readiness after installing the namespace firewall.
const deadline = Date.now() + 30_000;
while (true) {
  if (await access('/tmp/pado-network-ready').then(() => true, () => false)) break;
  if (Date.now() > deadline) process.exit(78);
  await delay(50);
}
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: 'inherit' });
child.on('error', () => process.exit(78));
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
