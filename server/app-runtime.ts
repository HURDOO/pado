import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { previewPorts, type RuntimeRequest, type PreviewInfo } from '../shared/protocol.ts';
import { StageError } from './stage.ts';
import { ProjectSecrets, SecretOutputFilter } from './project-secrets.ts';
import type { TerminalEvent } from './terminal-events.ts';
import { networkGate, secureContainerNetwork, publicMode } from './container-network.ts';

const exec = promisify(execFile);
async function docker(args: string[], environment?: Record<string, string>) {
  return (
    await exec('docker', args, {
      timeout: 15000,
      maxBuffer: 64000,
      ...(environment ? { env: { ...process.env, ...environment } } : {}),
    })
  ).stdout.trim();
}
export type PreviewTarget = { host: '127.0.0.1'; port: number; epoch: string };
export class AppRuntime {
  constructor(private readonly secrets?: ProjectSecrets) {}
  state: PreviewInfo['state'] = 'stopped';
  epoch = randomUUID();
  private ports = new Map<number, number>();
  private names = new Set<string>();
  private creates = new Set<Promise<unknown>>();
  private attachments = new Map<string, ChildProcess>();
  private logOwners = new Map<string, string>();
  private logExits = new Map<string, () => void>();
  private operation = false;
  private generation = 0;
  private stopping?: Promise<void>;
  private unsafe = false;
  private appName?: string;
  private listeners = new Set<() => void>();
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private changed() {
    for (const listener of this.listeners) listener();
  }
  target(port: number): PreviewTarget | undefined {
    const mapped = this.ports.get(port);
    return this.state === 'running' && mapped
      ? { host: '127.0.0.1', port: mapped, epoch: this.epoch }
      : undefined;
  }
  async execute(request: RuntimeRequest, workspace: string, emit: (event: TerminalEvent) => void) {
    if (this.stopping || this.operation || this.unsafe)
      throw new StageError('앱 실행 환경이 정리 중이거나 다른 명령을 실행 중입니다.');
    this.operation = true;
    const generation = this.generation;
    const logId = request.action === 'run' ? request.id : `${request.id}-logs`;
    const runId = request.requestId;
    const showOutput =
      request.action !== 'secrets' && (request.action === 'serve' || request.display !== 'none');
    if (request.action !== 'stop') this.logOwners.set(logId, request.requestId);
    let name: string | undefined;
    let output = '';
    const log = (event: TerminalEvent) => {
      if (!showOutput) return;
      if (generation !== this.generation || this.logOwners.get(logId) !== request.requestId) return;
      // Closing a log pane must not crash a background app or recreate the pane.
      try {
        emit(event);
      } catch {
        /* A removed pane no longer accepts logs. */
      }
    };
    const append = (stream: 'stdout' | 'stderr', text: string) => {
      if (generation !== this.generation) return;
      output = (output + text).slice(-60_000);
      for (let index = 0; index < text.length; index += 8000)
        log({
          type: 'terminal.append',
          id: logId,
          runId,
          stream,
          text: text.slice(index, index + 8000),
        });
    };
    try {
      if (request.action === 'stop') {
        await this.stop();
        return { ok: true, output: 'App server stopped.' };
      }
      if (request.action === 'secrets')
        return { ok: true, output: JSON.stringify({ names: (await this.secrets?.names()) ?? [] }) };
      const environment = this.secrets ? await this.secrets.environment(request.secrets ?? []) : {};
      if (request.secrets?.length && !this.secrets)
        throw new StageError('프로젝트 실행 환경 설정을 사용할 수 없습니다.', 400);
      if (generation !== this.generation) throw new Error('Canceled');
      const filters = {
        stdout: new SecretOutputFilter(Object.values(environment)),
        stderr: new SecretOutputFilter(Object.values(environment)),
      };
      if (request.action === 'serve') {
        if (this.appName) await this.stopContainer(this.appName);
        if (generation !== this.generation) throw new Error('Canceled');
        this.ports.clear();
        this.appName = undefined;
        this.state = 'starting';
        this.epoch = randomUUID();
        this.changed();
      }
      if (showOutput)
        emit({
          type: 'terminal.open',
          startedAt: Date.now(),
          id: logId,
          runId,
          title: request.action === 'serve' ? '앱 서버 로그' : '앱 환경 명령',
          subtitle: request.command!.slice(0, 3).join(' ').slice(0, 180),
          size: 1,
          command: request.command!,
          cwd: request.cwd,
          ...(request.action === 'serve' ? { port: request.port } : {}),
        });
      name = `pado-app-${randomUUID()}`;
      const containerName = name;
      this.logExits.set(name, () => log({ type: 'terminal.exit', id: logId, runId, code: null }));
      this.names.add(name);
      const creation = docker(
        [
          'create',
          '--name',
          name,
          '--label',
          'pado.role=app',
          '--init',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--pids-limit=256',
          ...(publicMode() ? ['--ulimit=fsize=268435456:268435456'] : []),
          '--memory=2g',
          '--cpus=2',
          '--tmpfs=/tmp:rw,nosuid,size=256m',
          '--tmpfs=/home/node:rw,nosuid,uid=1000,gid=1000,size=512m',
          '--mount',
          `type=bind,source=${resolve(workspace)},target=/workspace`,
          '--workdir',
          `/workspace/${request.cwd}`,
          '--env',
          'TERM=xterm-256color',
          '--env',
          'FORCE_COLOR=1',
          ...(request.action === 'serve'
            ? previewPorts.flatMap((port) => ['--publish', `127.0.0.1::${port}`])
            : []),
          ...(request.port ? ['--env', `PORT=${request.port}`] : []),
          // Only names reach argv; Docker reads selected values from this child process's env.
          ...Object.keys(environment).flatMap((key) => ['--env', key]),
          process.env.PADO_AGENT_IMAGE || 'pado-agent:local',
          ...networkGate(request.command!),
        ],
        environment,
      );
      this.creates.add(creation);
      try {
        await creation;
      } finally {
        this.creates.delete(creation);
      }
      if (generation !== this.generation) {
        await this.stopContainer(name);
        throw new Error('Canceled');
      }
      const child = spawn('docker', ['start', '--attach', name], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.attachments.set(name, child);
      // Non-TTY attach forwards the app's stdout/stderr separately. Filter recognizable
      // Docker client diagnostics rather than displaying daemon connection details.
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (text) => append('stdout', filters.stdout.write(text)));
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (text) => {
        if (
          !/^Error response from daemon:|^Cannot connect to the Docker daemon|^error during connect:/m.test(
            text,
          )
        )
          append('stderr', filters.stderr.write(text));
      });
      const completion = new Promise<number | null>((done) => {
        let ended = false;
        const finish = (code: number | null) => {
          if (ended) return;
          ended = true;
          append('stdout', filters.stdout.write('', true));
          append('stderr', filters.stderr.write('', true));
          this.attachments.delete(containerName);
          this.logExits.delete(containerName);
          if (generation === this.generation) {
            log({ type: 'terminal.exit', id: logId, runId, code });
            if (this.appName === containerName) {
              this.ports.clear();
              this.state = code === 0 ? 'stopped' : 'error';
              this.changed();
            }
          }
          done(code);
        };
        child.once('error', () => finish(null));
        child.once('close', finish);
      });
      // Register stream/exit handling before waiting for the namespace policy.
      if (process.env.PADO_PUBLIC_MODE === '1') {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await docker(['ps', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'])) break;
          await delay(50);
        }
        await secureContainerNetwork(name);
      }
      if (request.action === 'exec' || request.action === 'run') {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const code = await Promise.race([
          completion,
          new Promise<null>((done) => {
            timeout = setTimeout(() => {
              void this.stopContainer(containerName).then(
                () => done(null),
                () => {
                  this.unsafe = true;
                  done(null);
                },
              );
            }, 180000);
          }),
        ]);
        clearTimeout(timeout);
        return { ok: code === 0, code, output: output.slice(-12000) };
      }
      this.appName = name;
      for (let attempt = 0; attempt < 150; attempt++) {
        if (generation !== this.generation || child.exitCode !== null || child.signalCode)
          throw new Error('Server stopped');
        try {
          if (!this.ports.size) {
            const mapping = JSON.parse(
              await docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name]),
            );
            for (const port of previewPorts) {
              const entry = mapping[`${port}/tcp`]?.find(
                (binding: { HostIp: string }) => binding.HostIp === '127.0.0.1',
              );
              const mapped = Number(entry?.HostPort);
              if (!Number.isInteger(mapped) || mapped < 1024 || mapped > 65535)
                throw new Error('Invalid published port');
              this.ports.set(port, mapped);
            }
          }
          const response = await fetch(`http://127.0.0.1:${this.ports.get(request.port!)}/`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(1000),
          });
          await response.body?.cancel();
          if (generation !== this.generation) throw new Error('Canceled');
          this.state = 'running';
          log({ type: 'terminal.ready', id: logId, runId });
          this.changed();
          return {
            ok: true,
            output: `App server is listening on sandbox port ${request.port}. Use a browser pane with server: {port: ${request.port}, path: '/'}.`,
          };
        } catch {
          await delay(200);
        }
      }
      await this.stopContainer(name);
      throw new Error('App did not become ready');
    } catch (error) {
      if (name)
        await this.stopContainer(name).catch(() => {
          this.unsafe = true;
        });
      if (request.action === 'serve' && generation === this.generation) {
        this.ports.clear();
        this.state = 'error';
        this.changed();
      }
      log({ type: 'terminal.exit', id: logId, runId, code: null });
      return {
        ok: false,
        output: output.slice(-12000),
        error:
          error instanceof StageError
            ? error.message
            : '앱 실행에 실패했습니다. 서버 로그와 0.0.0.0 바인딩·포트를 확인해 주세요.',
      };
    } finally {
      this.operation = false;
    }
  }
  private async stopContainer(name: string) {
    await docker(['stop', '--timeout', '2', name]).catch(() => {});
    if (await docker(['ps', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']))
      await docker(['kill', name]);
    if (await docker(['ps', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'])) {
      this.unsafe = true;
      throw new Error('App shutdown not confirmed');
    }
    this.names.delete(name);
    this.logExits.get(name)?.();
    this.logExits.delete(name);
    this.attachments.get(name)?.kill('SIGTERM');
    this.attachments.delete(name);
  }
  async stop() {
    if (this.stopping) return this.stopping;
    for (const end of this.logExits.values()) end();
    this.logExits.clear();
    ++this.generation;
    this.logOwners.clear();
    this.ports.clear();
    this.state = 'stopped';
    this.changed();
    this.stopping = (async () => {
      await Promise.allSettled(this.creates);
      await Promise.all([...this.names].map((name) => this.stopContainer(name)));
      this.appName = undefined;
      if (this.unsafe) throw new StageError('앱 컨테이너 종료를 확인하지 못했습니다.', 503);
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }
}
