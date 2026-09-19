import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { promisify } from 'node:util';
const exec = promisify(execFile);

// A fail-closed watchdog, not a filesystem quota. A per-process file-size limit also
// applies in Docker. No untrusted script is used to measure the host workspace.
export async function assertPublicStorage(workspace: string) {
  const [{ stdout }, space] = await Promise.all([
    exec('/usr/bin/du', ['-sk', workspace], { timeout: 5000, maxBuffer: 4096 }),
    statfs(workspace),
  ]);
  const kib = Number(stdout.split(/\s+/)[0]);
  if (!Number.isFinite(kib) || kib > 2 * 1024 * 1024 || space.bavail * space.bsize < 10 * 1024 ** 3)
    throw new Error('Public storage budget exceeded');
}
