import { execFile, spawn } from 'node:child_process';
import { request } from 'node:http';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { networkGate, secureContainerNetwork, publicMode } from './container-network.ts';

const exec = promisify(execFile);
async function docker(args: string[]) {
  const result = await exec('docker', args, { timeout: 15_000, maxBuffer: 64_000 });
  return result.stdout.trim();
}
let socket: Promise<string> | undefined;
async function dockerSocket() {
  return (socket ??= (async () => {
    const endpoint =
      process.env.DOCKER_HOST ||
      (await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']));
    if (!endpoint.startsWith('unix:///')) throw new Error('A local Docker socket is required');
    return endpoint.slice('unix://'.length);
  })());
}
export async function resizeDockerTerminal(name: string, cols: number, rows: number) {
  const socketPath = await dockerSocket();
  await new Promise<void>((ok, fail) => {
    const req = request(
      {
        socketPath,
        method: 'POST',
        path: `/containers/${encodeURIComponent(name)}/resize?w=${cols}&h=${rows}`,
        timeout: 5000,
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          res.statusCode === 200 ? ok() : fail(new Error('Terminal resize failed')),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('Terminal resize timed out')));
    req.on('error', fail);
    req.end();
  });
}
export type DockerTerminal = {
  write(data: string): void;
  resize(cols: number, rows: number): Promise<void>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
};
export class TerminalStartupUnconfirmed extends Error {}
export async function launchDockerTerminal(options: {
  name: string;
  workspace: string;
  bridge: string;
  cols: number;
  rows: number;
  conversation?: string;
  state?: string;
  onData(data: string): void;
  onExit(): void;
}): Promise<DockerTerminal> {
  await docker([
    'create',
    '--name',
    options.name,
    '--label',
    'pado.role=agent',
    '--init',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=128',
    ...(publicMode() ? ['--ulimit=fsize=268435456:268435456'] : []),
    '--memory=2g',
    '--cpus=2',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=256m',
    '--tmpfs=/home/node/.cache:rw,nosuid,uid=1000,gid=1000,size=256m',
    '--tmpfs=/home/node/.gemini:rw,nosuid,uid=1000,gid=1000,mode=0700,size=256m',
    '--tmpfs=/home/node/.gemini/antigravity-cli:rw,nosuid,uid=1000,gid=1000,mode=0700,size=256m',
    '--tmpfs=/home/node/.gemini/config:rw,nosuid,uid=1000,gid=1000,mode=0700,size=64m',
    // Persist only conversation data and non-secret cache. Login stays in session tmpfs.
    ...(options.state
      ? ['brain', 'conversations', 'cache'].flatMap((directory) => [
          '--mount',
          `type=bind,source=${resolve(options.state!, directory)},target=/home/node/.gemini/antigravity-cli/${directory}`,
        ])
      : []),
    ...(options.state
      ? [
          '--mount',
          `type=bind,source=${resolve(options.state, 'projects')},target=/home/node/.gemini/config/projects`,
        ]
      : []),
    '--env',
    'TERM=xterm-256color',
    '--env',
    'COLORTERM=truecolor',
    '--env',
    `COLUMNS=${options.cols}`,
    '--env',
    `LINES=${options.rows}`,
    '--mount',
    `type=bind,source=${options.workspace},target=/workspace`,
    '--mount',
    `type=bind,source=${options.bridge},target=/bridge`,
    '--mount',
    'type=volume,source=pado-agent-auth,target=/auth,readonly',
    ...(publicMode()
      ? [
          '--env',
          'PADO_PUBLIC_MODE=1',
          ...(process.env.PADO_PUBLIC_SUBAGENTS === '1'
            ? ['--env', 'PADO_PUBLIC_SUBAGENTS=1']
            : []),
          '--mount',
          `type=bind,source=${resolve('agent/public-hooks.json')},target=/home/node/.gemini/config/hooks.json,readonly`,
          '--tmpfs=/workspace/.agents:ro,nosuid,noexec,size=1m',
          '--tmpfs=/workspace/.gemini:ro,nosuid,noexec,size=1m',
        ]
      : []),
    '--interactive',
    '--tty',
    process.env.PADO_AGENT_IMAGE || 'pado-agent:local',
    ...networkGate([
      'node',
      '/opt/pado/tui-boot.mjs',
      ...(options.conversation ? [options.conversation] : []),
    ]),
  ]);
  return attachDockerTerminal(options);
}

/** A project shell has only workspace files, never agent auth, bridge or host environment. */
export async function launchShellTerminal(options: {
  name: string;
  workspace: string;
  cols: number;
  rows: number;
  onData(data: string): void;
  onExit(code: number | null): void;
}): Promise<DockerTerminal> {
  await docker([
    'create',
    '--name',
    options.name,
    '--label',
    'pado.role=shell',
    '--init',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=1000:1000',
    '--pids-limit=128',
    ...(publicMode() ? ['--ulimit=fsize=268435456:268435456'] : []),
    '--memory=1g',
    '--cpus=1',
    '--tmpfs=/tmp:rw,nosuid,size=256m',
    '--tmpfs=/home/node:rw,nosuid,uid=1000,gid=1000,size=256m',
    '--mount',
    `type=bind,source=${resolve(options.workspace)},target=/workspace`,
    '--workdir',
    '/workspace',
    '--env',
    'TERM=xterm-256color',
    '--env',
    'COLORTERM=truecolor',
    '--env',
    'PS1=\\w \\$ ',
    '--env',
    `COLUMNS=${options.cols}`,
    '--env',
    `LINES=${options.rows}`,
    '--interactive',
    '--tty',
    process.env.PADO_AGENT_IMAGE || 'pado-agent:local',
    ...networkGate(['bash', '--noprofile', '--norc', '-i']),
  ]);
  return attachDockerTerminal(options);
}

async function attachDockerTerminal(options: {
  name: string;
  onData(data: string): void;
  onExit(code: number | null): void;
}): Promise<DockerTerminal> {
  // Starting an already allocated Docker PTY accepts piped host stdin. No host shell/PTY is exposed.
  const child = spawn('docker', ['start', '--attach', '--interactive', options.name], {
    stdio: 'pipe',
  });
  child.stdin.on('error', () => {});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', options.onData);
  // Docker client diagnostics are deliberately not part of the public terminal.
  child.stderr.resume();
  child.once('error', () => options.onExit(null));
  child.once('close', options.onExit);
  let stopping: Promise<void> | undefined;
  const result: DockerTerminal = {
    write(data) {
      if (child.exitCode !== null || child.stdin.destroyed || child.stdin.writableLength > 64_000)
        throw new Error('Terminal is not accepting input');
      child.stdin.write(data);
    },
    resize: (cols, rows) => resizeDockerTerminal(options.name, cols, rows),
    pause: () => child.stdout.pause(),
    resume: () => child.stdout.resume(),
    stop: () =>
      (stopping ??= (async () => {
        await docker(['stop', '--timeout', '2', options.name]).catch(() => {});
        if (await docker(['ps', '--filter', `name=^/${options.name}$`, '--format', '{{.Names}}']))
          await docker(['kill', options.name]);
        if (await docker(['ps', '--filter', `name=^/${options.name}$`, '--format', '{{.Names}}']))
          throw new Error('Could not confirm terminal container shutdown');
        child.stdin.end();
        if (child.exitCode === null) child.kill('SIGTERM');
      })()),
  };
  // A stop of a merely-created container can race the still-in-flight `docker start`.
  // Do not hand ownership back until start is observed or its client has exited.
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await docker(['ps', '--filter', `name=^/${options.name}$`, '--format', '{{.Names}}'])) {
        await secureContainerNetwork(options.name);
        return result;
      }
      if (child.exitCode !== null) return result;
      await delay(50);
    }
  } catch {
    // A daemon inspection failure does not prove the pending start was canceled.
  }
  // No later launch may assume that a pending daemon request was canceled by killing attach.
  await result.stop().catch(() => {});
  throw new TerminalStartupUnconfirmed('Terminal startup was not confirmed');
}
