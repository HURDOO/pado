import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

test('local setup creates a private password once, preserves settings and never prints it', async () => {
  await mkdir('.pado/tests', { recursive: true });
  const folder = await mkdtemp(resolve('.pado/tests/setup-'));
  await writeFile(resolve(folder, 'package.json'), JSON.stringify({ name: 'pado' }));
  await writeFile(resolve(folder, '.env'), '# keep this comment\nPADO_RUNNER=antigravity\n');
  const run = () =>
    execFileSync(process.execPath, [resolve('scripts/setup-local.mjs')], {
      cwd: folder,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const output = run();
  const first = await readFile(resolve(folder, '.env'), 'utf8');
  const password = first.match(/^PADO_ADMIN_PASSWORD=(.+)$/m)![1];
  assert.match(password, /^[a-zA-Z0-9_-]{32}$/);
  assert.ok(!output.includes(password));
  assert.ok(first.startsWith('# keep this comment\nPADO_RUNNER=antigravity\n'));
  assert.equal((await stat(resolve(folder, '.env'))).mode & 0o777, 0o600);
  run();
  assert.equal(await readFile(resolve(folder, '.env'), 'utf8'), first);
  await writeFile(resolve(folder, '.env'), 'PADO_ADMIN_PASSWORD=short\n');
  assert.throws(run);
  assert.equal(await readFile(resolve(folder, '.env'), 'utf8'), 'PADO_ADMIN_PASSWORD=short\n');
});
