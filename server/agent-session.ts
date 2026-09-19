import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { presentationSchema, type Presentation, type AgentActivity } from '../shared/protocol.ts';
import { AgentRunError, AgentStream } from './agent-stream.ts';
import { agentInstructions } from './agent-instructions.ts';

type LaunchOptions = {
  name: string;
  image: string;
  workspace: string;
  bridge: string;
  conversationId?: string;
};
export type AgentProcess = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  closed: Promise<number | null>;
  stop: () => Promise<void>;
};
export type AgentLaunch = (options: LaunchOptions) => AgentProcess;

export function agentArguments(options: LaunchOptions) {
  return [
    'run',
    '--name',
    options.name,
    '--label',
    'pado.role=agent',
    '--init',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=128',
    '--memory=2g',
    '--cpus=2',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=256m',
    '--tmpfs=/home/node/.cache:rw,nosuid,uid=1000,gid=1000,size=256m',
    '--mount',
    `type=bind,source=${options.workspace},target=/workspace`,
    '--mount',
    `type=bind,source=${options.bridge},target=/bridge`,
    '--mount',
    'type=volume,source=pado-agent-auth,target=/home/node/.gemini',
    '--mount',
    `type=bind,source=${resolve('agent/settings.json')},target=/home/node/.gemini/antigravity-cli/settings.json,readonly`,
    '-i',
    options.image,
    'agy',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--disable-slash-commands',
    '--mode',
    'accept-edits',
    ...(options.conversationId ? ['--conversation', options.conversationId] : []),
  ];
}

async function dockerControl(args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-4096);
    });
    child.once('error', fail);
    child.once('close', (code) =>
      code === 0 ? ok(output.trim()) : fail(new Error('Docker control failed')),
    );
  });
}

const launchDocker: AgentLaunch = (options) => {
  const child: ChildProcessWithoutNullStreams = spawn('docker', agentArguments(options), {
    stdio: 'pipe',
  });
  child.stdin.on('error', () => {});
  const closed = new Promise<number | null>((ok, fail) => {
    child.once('error', fail);
    child.once('close', ok);
  });
  closed.catch(() => {});
  let stopPromise: Promise<void> | undefined;
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    closed,
    stop: () =>
      (stopPromise ??= (async () => {
        // A dead attach client does not prove the container stopped.
        await dockerControl(['stop', '--timeout', '2', options.name]).catch(() => {});
        const running = await dockerControl([
          'ps',
          '--filter',
          `name=^/${options.name}$`,
          '--format',
          '{{.Names}}',
        ]);
        if (running) {
          await dockerControl(['kill', options.name]);
          const remaining = await dockerControl([
            'ps',
            '--filter',
            `name=^/${options.name}$`,
            '--format',
            '{{.Names}}',
          ]);
          if (remaining) throw new Error('Container is still running');
        }
        if (child.exitCode === null) child.kill('SIGTERM');
        await Promise.race([closed.catch(() => {}), delay(3000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      })()),
  };
};

export class AgentSession {
  private conversationId?: string;
  private active?: {
    bridge: string;
    controller: AbortController;
    process?: AgentProcess;
    accepted: Set<string>;
    reported: Set<string>;
  };
  private unsafeToRestart = false;
  constructor(
    private options: {
      root?: string;
      image?: string;
      timeoutMs?: number;
      pollMs?: number;
      launch?: AgentLaunch;
    } = {},
  ) {}

  assertReady() {
    if (this.active) throw new Error('Agent session is still active');
    if (this.unsafeToRestart)
      throw new Error(
        'Runner stop could not be verified. Restart the server after checking the container.',
      );
  }
  reset() {
    this.conversationId = undefined;
  }
  async stop() {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    await active.process?.stop();
  }
  async submit(paneId: string, values: Record<string, string>) {
    const active = this.active;
    if (!active || !/^[a-zA-Z0-9_-]{1,64}$/.test(paneId) || active.accepted.has(paneId))
      throw new Error('Input no longer pending');
    active.accepted.add(paneId);
    // Publish the answer atomically: the agent never sees a half-written JSON file.
    const temporary = resolve(active.bridge, `.${paneId}.${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(values));
    } finally {
      await file.close();
    }
    if (this.active !== active || active.controller.signal.aborted)
      throw new Error('Turn has ended');
    await rename(temporary, resolve(active.bridge, `${paneId}.answer.json`));
  }
  async inputError(paneId: string, message: string) {
    const active = this.active;
    if (
      !active ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(paneId) ||
      active.accepted.has(paneId) ||
      active.reported.has(paneId)
    )
      return;
    active.reported.add(paneId);
    const temporary = resolve(active.bridge, `.${paneId}.${randomUUID()}.error.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({ message: message.slice(0, 300) }));
    } finally {
      await file.close();
    }
    if (this.active !== active || active.controller.signal.aborted) return;
    await rename(temporary, resolve(active.bridge, `${paneId}.error.json`));
  }

  async run(
    turnId: string,
    prompt: string,
    emit: (event: Presentation) => void,
    signal: AbortSignal,
    onActivity?: (activity: AgentActivity) => void,
  ) {
    this.assertReady();
    const root = resolve(this.options.root ?? globalThis.process.env.PADO_DATA_DIR ?? '.pado');
    const workspace = resolve(root, 'workspace');
    const bridge = resolve(root, 'bridges', randomUUID());
    const active = {
      bridge,
      controller: new AbortController(),
      process: undefined as AgentProcess | undefined,
      accepted: new Set<string>(),
      reported: new Set<string>(),
    };
    this.active = active;
    const abort = () => active.controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      active.controller.abort();
    }, this.options.timeoutMs ?? 600_000);
    let success = false;
    let stopped = false;
    const stream = new AgentStream((activity) => {
      if (!active.controller.signal.aborted) onActivity?.(activity);
    });
    try {
      await mkdir(workspace, { recursive: true });
      await mkdir(bridge, { recursive: true });
      active.controller.signal.throwIfAborted();
      const process = (this.options.launch ?? launchDocker)({
        name: `pado-turn-${turnId}`,
        image: this.options.image ?? globalThis.process.env.PADO_AGENT_IMAGE ?? 'pado-agent:local',
        workspace,
        bridge,
        conversationId: this.conversationId,
      });
      active.process = process;
      let streamError: Error | undefined;
      process.stdout.on('data', (chunk) => {
        try {
          stream.push(chunk);
        } catch (e) {
          streamError = e as Error;
          active.controller.abort();
        }
      });
      process.stderr.on('data', (chunk) => {
        stream.diagnostic(chunk);
        if (stream.failure === 'authentication') {
          streamError = new AgentRunError('authentication');
          active.controller.abort();
        }
      });
      const instruction = `${agentInstructions}\nUser request:\n${prompt}`;
      process.stdin.end(
        JSON.stringify({ event: 'user', message: { content: instruction } }) + '\n',
      );
      let closed = false;
      let exitCode: number | null = null;
      let processError: unknown;
      process.closed.then(
        (code) => {
          closed = true;
          exitCode = code;
        },
        (error) => {
          closed = true;
          processError = error;
        },
      );
      let offset = 0;
      let partial = '';
      let decoder = new StringDecoder('utf8');
      const poll = async () => {
        let file;
        try {
          file = await open(
            resolve(bridge, 'events.ndjson'),
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw new AgentRunError('protocol');
        }
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > 4_000_000 || stat.size < offset)
            throw new AgentRunError('protocol');
          const data = Buffer.alloc(Math.min(stat.size - offset, 128_000));
          const read = await file.read(data, 0, data.length, offset);
          offset += read.bytesRead;
          partial += decoder.write(data.subarray(0, read.bytesRead));
          const lines = partial.split('\n');
          partial = lines.pop() ?? '';
          if (partial.length > 80_000) throw new AgentRunError('protocol');
          for (const line of lines) {
            let value: unknown;
            try {
              value = JSON.parse(line);
            } catch {
              continue;
            }
            const parsed = presentationSchema.safeParse(value);
            if (parsed.success && !active.controller.signal.aborted) {
              if (parsed.data.type === 'pane.upsert' && parsed.data.pane.kind === 'input')
                active.reported.delete(parsed.data.pane.id);
              emit(parsed.data);
            }
          }
          return offset < stat.size;
        } finally {
          await file.close();
        }
      };
      while (!closed && !active.controller.signal.aborted) {
        await poll();
        await delay(this.options.pollMs ?? 100);
      }
      if (timedOut) throw new AgentRunError('timeout');
      if (streamError) throw streamError;
      active.controller.signal.throwIfAborted();
      if (processError) throw new AgentRunError('execution');
      while (await poll()) {
        /* Drain all buffered presentation events before finishing. */
      }
      stream.end();
      const result = stream.completed(exitCode);
      clearTimeout(timer);
      try {
        await process.stop();
        stopped = true;
      } catch {
        this.unsafeToRestart = true;
        throw new AgentRunError('execution');
      }
      active.controller.signal.throwIfAborted();
      // Only an explicit successful conversation can be resumed.
      this.conversationId = stream.conversationId;
      success = true;
      return result;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      try {
        if (!stopped) await active.process?.stop();
      } catch {
        this.unsafeToRestart = true;
        success = false;
      } finally {
        if (!success) this.conversationId = undefined;
        if (this.active === active) this.active = undefined;
      }
    }
  }
}
