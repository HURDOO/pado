import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { Session, TuiFrame } from '../shared/protocol.ts';
import {
  launchShellTerminal,
  TerminalStartupUnconfirmed,
  type DockerTerminal,
} from './docker-terminal.ts';
import { TerminalScreen } from './terminal-screen.ts';
import { StageError, StageStore } from './stage.ts';

type Shell = {
  runId: string;
  screen: TerminalScreen;
  process?: DockerTerminal;
  starting?: Promise<void>;
  stopping?: Promise<void>;
  resizing: Promise<void>;
  ended: boolean;
};

export class ShellSessions {
  private shells = new Map<string, Shell>();
  private listeners = new Set<(id: string, frame: TuiFrame) => void>();
  private unsafe = false;
  private stopping = false;
  constructor(
    private store: StageStore,
    private workspace: string,
    private launch = launchShellTerminal,
  ) {}
  subscribe(listener: (id: string, frame: TuiFrame) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private pane(id: string) {
    const pane = this.store.state.panes.find((pane) => pane.id === id && pane.shell);
    if (!pane) throw new StageError('터미널 pane이 닫혔습니다.', 404);
    return pane;
  }
  snapshot(id: string): TuiFrame {
    this.pane(id);
    return (
      this.shells.get(id)?.screen.snapshot() ?? {
        kind: 'reset',
        epoch: id,
        seq: 0,
        cols: 100,
        rows: 30,
        status: 'stopped',
        data: '',
      }
    );
  }
  assertCanOpen() {
    if (this.unsafe || this.stopping)
      throw new StageError('터미널 실행 환경을 확인해 주세요.', 503);
    if ([...this.shells.values()].filter((shell) => !shell.ended).length >= 3)
      throw new StageError('직접 입력하는 터미널은 최대 3개까지 실행할 수 있습니다.');
  }
  async start(session: Session, id: string) {
    this.store.assertPaneControl(session);
    const pane = this.pane(id);
    if (this.store.state.runner !== 'antigravity')
      throw new StageError('직접 입력하는 터미널은 실제 실행 모드에서 사용할 수 있습니다.', 409);
    if (this.unsafe || this.stopping)
      throw new StageError('터미널 실행 환경을 확인해 주세요.', 503);
    const existing = this.shells.get(id);
    if (existing?.starting) return existing.starting;
    if (existing?.stopping) throw new StageError('터미널이 종료 중입니다.');
    if (existing && !existing.ended) return;
    this.assertCanOpen();
    existing?.screen.dispose();
    const shell: Shell = {
      runId: randomUUID(),
      screen: new TerminalScreen(
        100,
        30,
        (frame) => {
          for (const listener of this.listeners) listener(id, frame);
        },
        (data) => {
          try {
            shell.process?.write(data);
          } catch {
            /* Session is ending. */
          }
        },
      ),
      ended: false,
      resizing: Promise.resolve(),
    };
    this.shells.set(id, shell);
    pane.status = 'active';
    pane.terminal = { runId: shell.runId, startedAt: Date.now(), command: ['bash'], cwd: '.' };
    const runId = pane.terminal.runId;
    const finish = (status: 'stopped' | 'error', code: number | null = null) => {
      if (shell.ended) return;
      shell.ended = true;
      shell.screen.setStatus(status);
      this.store.terminal({
        type: 'terminal.exit',
        id,
        runId,
        code,
      });
    };
    this.store.publish();
    shell.starting = (async () => {
      try {
        await mkdir(this.workspace, { recursive: true });
        shell.process = await this.launch({
          name: `pado-shell-${randomUUID()}`,
          workspace: this.workspace,
          cols: 100,
          rows: 30,
          onData: (data) => {
            if (!shell.ended) void shell.screen.write(data);
          },
          onExit: (code) => finish(code === 0 ? 'stopped' : 'error', code),
        });
        shell.screen.onFlow = (paused) =>
          paused ? shell.process?.pause() : shell.process?.resume();
        if (shell.stopping || shell.ended) return;
        // Recheck the lease after Docker startup; a stale request must not gain input access.
        this.store.assertPaneControl(session);
        this.pane(id);
        await shell.process.resize(100, 30);
        shell.screen.setStatus('ready');
      } catch (error) {
        // A launcher can fail before returning ownership. Conservatively block more launches.
        if (error instanceof TerminalStartupUnconfirmed) this.unsafe = true;
        await shell.process?.stop().catch(() => {
          this.unsafe = true;
        });
        finish('error');
        throw new StageError(
          '터미널을 시작하지 못했습니다. Docker 실행 환경을 확인해 주세요.',
          503,
        );
      } finally {
        shell.starting = undefined;
      }
    })();
    return shell.starting;
  }
  input(session: Session, id: string, data: string, epoch: string) {
    this.store.assertPaneControl(session);
    this.pane(id);
    const shell = this.shells.get(id);
    if (
      !shell?.process ||
      shell.ended ||
      shell.stopping ||
      shell.screen.status !== 'ready' ||
      shell.screen.epoch !== epoch
    )
      throw new StageError('터미널이 종료되었거나 다시 연결 중입니다.');
    try {
      shell.process.write(data);
    } catch {
      throw new StageError('터미널 입력 연결이 종료되었습니다.', 503);
    }
  }
  async resize(session: Session, id: string, cols: number, rows: number, epoch: string) {
    this.store.assertPaneControl(session);
    this.pane(id);
    const shell = this.shells.get(id);
    if (!shell) throw new StageError('터미널이 종료되었습니다.');
    const task = shell.resizing.then(async () => {
      this.store.assertPaneControl(session);
      this.pane(id);
      if (!shell.process || shell.ended || shell.stopping || shell.screen.epoch !== epoch)
        throw new StageError('터미널이 종료되었습니다.');
      if (cols === shell.screen.cols && rows === shell.screen.rows) return;
      const previous = { cols: shell.screen.cols, rows: shell.screen.rows };
      shell.process.pause();
      try {
        await shell.screen.resize(cols, rows);
        await shell.process.resize(cols, rows);
      } catch {
        await shell.screen.resize(previous.cols, previous.rows);
        throw new StageError('터미널 크기를 변경하지 못했습니다.', 503);
      } finally {
        shell.process.resume();
      }
    });
    shell.resizing = task.catch(() => {});
    return task;
  }
  async close(id: string) {
    const shell = this.shells.get(id);
    if (!shell) return;
    if (shell.stopping) return shell.stopping;
    shell.stopping = (async () => {
      await shell.starting?.catch(() => {});
      await shell.resizing;
      try {
        await shell.process?.stop();
      } catch {
        this.unsafe = true;
        throw new StageError('터미널 종료를 확인하지 못했습니다.', 503);
      }
      shell.ended = true;
      shell.screen.setStatus('stopped');
      shell.screen.dispose();
      this.shells.delete(id);
      this.store.terminal({ type: 'terminal.exit', id, runId: shell.runId, code: null });
    })();
    return shell.stopping;
  }
  reconcile() {
    for (const id of this.shells.keys())
      if (!this.store.state.panes.some((pane) => pane.id === id && pane.shell))
        void this.close(id).catch(() => {});
  }
  async stop() {
    this.stopping = true;
    try {
      await Promise.all([...this.shells.keys()].map((id) => this.close(id)));
    } finally {
      this.stopping = false;
    }
  }
}
