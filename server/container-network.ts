import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const publicMode = () => process.env.PADO_PUBLIC_MODE === '1';
// Input policy is independent from Docker/network hardening. Trusted, short-lived
// events can opt into native participant controls without disabling isolation.
export const participantTuiEnabled = () =>
  !publicMode() || process.env.PADO_PARTICIPANT_TUI === '1';
export function networkGate(command: string[]) {
  return publicMode() ? ['node', '/opt/pado/network-gate.mjs', ...command] : command;
}
export async function secureContainerNetwork(name: string) {
  if (!publicMode()) return;
  if (!/^pado-(?:app|tui|shell)-[a-f0-9-]+$/.test(name))
    throw new Error('Invalid container target');
  try {
    await exec(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        `container:${name}`,
        '--user=0:0',
        '--read-only',
        '--cap-drop=ALL',
        '--cap-add=NET_ADMIN',
        '--security-opt=no-new-privileges',
        '--pids-limit=32',
        '--memory=64m',
        '--entrypoint',
        '/bin/sh',
        process.env.PADO_AGENT_IMAGE || 'pado-agent:local',
        '/opt/pado/network-policy.sh',
      ],
      { timeout: 20000, maxBuffer: 16000 },
    );
    await exec(
      'docker',
      [
        'exec',
        name,
        'node',
        '-e',
        'require("node:fs").writeFileSync("/tmp/pado-network-ready", "ready", {mode:0o600,flag:"wx"})',
      ],
      { timeout: 5000, maxBuffer: 16000 },
    );
  } catch {
    await exec('docker', ['stop', '--timeout', '1', name], { timeout: 10000 }).catch(() => {});
    throw new Error('Container network isolation could not be verified');
  }
}
