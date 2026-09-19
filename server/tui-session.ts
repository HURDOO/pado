import { mkdir, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  presentationSchema,
  runtimeRequestSchema,
  subagentProgressSchema,
  type Session,
  type TuiFrame,
  type RuntimeRequest,
} from '../shared/protocol.ts';
import { StageError, StageStore } from './stage.ts';
import {
  launchDockerTerminal,
  TerminalStartupUnconfirmed,
  type DockerTerminal,
} from './docker-terminal.ts';
import { TerminalScreen } from './terminal-screen.ts';
import { PresentationJournal } from './presentation-journal.ts';
import { SubagentOutputSnapshot } from './subagent-output.ts';
import { AppRuntime } from './app-runtime.ts';
import { WaitingTerminal, commandWaitSchema, type CommandWait } from './waiting-terminal.ts';
import { ProjectSecrets } from './project-secrets.ts';
import { publicMode, participantTuiEnabled } from './container-network.ts';

const lifecycle = z.object({
  event: z.enum(['start', 'stop']),
  conversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  turnToken: z.uuid(),
  at: z.number().int().nonnegative(),
  executionNum: z.number().int().nonnegative().optional(),
  fullyIdle: z.boolean(),
  error: z.boolean(),
});
type Lifecycle = z.infer<typeof lifecycle>;
const nativeSubagent = z.object({
  turnToken: z.uuid(),
  conversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  childConversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  at: z.number().int().nonnegative(),
  agent: subagentProgressSchema,
});
type NativeSubagent = z.infer<typeof nativeSubagent>;
const subagentOutput = z.object({
  turnToken: z.uuid(),
  conversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  at: z.number().int().nonnegative(),
  id: z.string().regex(/^native-[a-f0-9]{40}$/),
  output: z.string().max(16_000),
});
type Child = {
  id: string;
  name: string;
  startedAt: number;
  updatedAt: number;
  hooked: boolean;
  state: NativeSubagent['agent']['state'];
};
export type TuiWorkspace = {
  root?: string;
  workspace?: string;
  conversation?: string;
  onConversation?: (id?: string) => Promise<void>;
  app?: RuntimeRequest;
  onApp?: (request?: RuntimeRequest) => Promise<void>;
};
export class TuiSession {
  readonly runtime: AppRuntime;
  readonly secrets: ProjectSecrets;
  private screen = new TerminalScreen();
  private process?: DockerTerminal;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private generation = 0;
  private bridge = '';
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private accepted = new Set<string>();
  private reported = new Set<string>();
  private inputOwner?: Session;
  private conversation?: string;
  private turnToken?: string;
  private submittedAt = 0;
  private lifecycleTurn?: string;
  private completedOutput?: { turnToken: string; turnId: string; parent: string; until: number };
  private rootStartedAt = 0;
  private children = new Map<string, Child>();
  private knownChildren = new Set<string>();
  private stoppedExecutions = new Set<string>();
  private previousSpeaker?: string;
  private listeners = new Set<(frame: TuiFrame) => void>();
  private unsafe = false;
  private retired = false;
  private resizing = Promise.resolve();
  private clearing = Promise.resolve();
  private publicSubmission = false;
  constructor(
    private store: StageStore,
    private launchTerminal = launchDockerTerminal,
    private project: TuiWorkspace = {},
  ) {
    this.secrets = new ProjectSecrets(
      project.root ?? resolve(process.env.PADO_DATA_DIR || '.pado'),
    );
    this.runtime = new AppRuntime(this.secrets);
  }
  subscribe(listener: (frame: TuiFrame) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  snapshot() {
    return this.screen.snapshot();
  }
  private broadcast = (frame: TuiFrame) => {
    for (const listener of this.listeners) listener(frame);
  };
  async ensure() {
    if (this.stopping || this.retired)
      throw new StageError('TUI 전환 중입니다. 잠시 후 다시 시도해 주세요.');
    if (this.unsafe) throw new StageError('이전 TUI 컨테이너의 종료를 확인해야 합니다.', 503);
    if (this.starting) return this.starting;
    if (this.process) return;
    this.starting = this.launch().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async launch() {
    const generation = ++this.generation;
    const root = this.project.root ?? resolve(process.env.PADO_DATA_DIR || '.pado');
    const workspace = this.project.workspace ?? resolve(root, 'workspace');
    this.bridge = resolve(root, 'tui', randomUUID());
    await mkdir(workspace, { recursive: true });
    await mkdir(this.bridge, { recursive: true });
    const privateState = resolve(root, 'cli');
    for (const directory of ['brain', 'conversations', 'cache', 'projects'])
      await mkdir(resolve(privateState, directory), { recursive: true, mode: 0o700 });
    this.screen.dispose();
    this.screen = new TerminalScreen(100, 30, this.broadcast, (data) => {
      try {
        this.process?.write(data);
      } catch {
        /* Exit handling owns the state. */
      }
    });
    this.broadcast(this.screen.snapshot());
    this.accepted.clear();
    this.reported.clear();
    this.conversation = undefined;
    this.turnToken = undefined;
    this.lifecycleTurn = undefined;
    this.completedOutput = undefined;
    this.children.clear();
    this.knownChildren.clear();
    this.stoppedExecutions.clear();
    const events = new PresentationJournal(resolve(this.bridge, 'events.ndjson'));
    const states = new PresentationJournal(resolve(this.bridge, 'lifecycle.ndjson'), 500_000);
    const subagents = new PresentationJournal(resolve(this.bridge, 'subagents.ndjson'), 500_000);
    const outputs = new SubagentOutputSnapshot(resolve(this.bridge, 'subagent-output.json'));
    const requests = new PresentationJournal(resolve(this.bridge, 'runtime.ndjson'), 2_000_000);
    const waitSnapshot = new SubagentOutputSnapshot(resolve(this.bridge, 'command-wait.json'));
    const waitingRuns = new Map<string, WaitingTerminal>();
    let nativeWait: CommandWait | undefined;
    const handled = new Set<string>();
    try {
      const child = await this.launchTerminal({
        name: `pado-tui-${randomUUID()}`,
        workspace,
        bridge: this.bridge,
        cols: 100,
        rows: 30,
        conversation: this.project.conversation,
        state: privateState,
        onData: (data) => {
          if (generation === this.generation) void this.screen.write(data);
        },
        onExit: () => {
          if (generation === this.generation && !this.stopping)
            void this.fail('Antigravity TUI가 종료되었습니다. 다시 손들면 새 세션을 시작합니다.');
        },
      });
      if (generation !== this.generation) {
        try {
          await child.stop();
        } catch {
          this.unsafe = true;
          throw new Error('Canceled startup could not stop its container');
        }
        return;
      }
      this.process = child;
      this.screen.onFlow = (paused) => (paused ? this.process?.pause() : this.process?.resume());
      // Docker's newly created PTY initially has zero dimensions until its first resize.
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          await this.process.resize(100, 30);
          break;
        } catch {
          if (attempt === 19) throw new Error('PTY did not start');
          await delay(100);
        }
      }
      if (generation !== this.generation) return;
      this.screen.setStatus('ready');
      this.timer = setInterval(() => {
        if (this.polling || generation !== this.generation) return;
        this.polling = true;
        void (async () => {
          const transitions = await states.read();
          const workers = await subagents.read();
          const workerOutputs = await outputs.read();
          const presentations = await events.read();
          const commands = await requests.read();
          const waits = await waitSnapshot.read();
          if (generation !== this.generation) return;
          // Preserve hook ordering, including a worker stopping and resuming in one poll.
          // Root completion is deferred until its final presentation events are drained.
          let finished: { id: string; error: boolean } | undefined;
          for (const raw of transitions) {
            const parsed = lifecycle.safeParse(raw);
            if (!parsed.success || !this.currentHook(parsed.data)) continue;
            if (parsed.data.event === 'start') {
              await this.started(parsed.data);
              if (parsed.data.conversationId === this.conversation) finished = undefined;
            } else {
              const completion = this.stopped(parsed.data);
              if (completion) finished = completion;
            }
          }
          for (const raw of workers) {
            const parsed = nativeSubagent.safeParse(raw);
            if (
              !parsed.success ||
              !this.currentHook(parsed.data) ||
              parsed.data.conversationId !== this.conversation ||
              !this.lifecycleTurn ||
              this.store.state.turn?.id !== this.lifecycleTurn
            )
              continue;
            this.observed(parsed.data);
          }
          for (const raw of workerOutputs) {
            const parsed = subagentOutput.safeParse(raw);
            if (!parsed.success) continue;
            const event = parsed.data;
            const completed = this.completedOutput;
            const turn =
              this.currentHook(event) && event.conversationId === this.conversation
                ? this.lifecycleTurn
                : completed &&
                    Date.now() <= completed.until &&
                    event.turnToken === completed.turnToken &&
                    event.conversationId === completed.parent
                  ? completed.turnId
                  : undefined;
            if (turn) this.store.subagentOutput(turn, event.id, event.output);
          }
          for (const raw of presentations) {
            const parsed = presentationSchema.safeParse(raw);
            if (!parsed.success || !this.store.state.turn) continue;
            if (parsed.data.type === 'pane.upsert' && parsed.data.pane.kind === 'input')
              this.reported.delete(parsed.data.pane.id);
            this.store.present(parsed.data, this.store.state.turn.id);
          }
          for (const raw of commands) {
            const parsed = runtimeRequestSchema.safeParse(raw);
            if (!parsed.success || handled.has(parsed.data.requestId) || !this.store.state.turn)
              continue;
            if (handled.size >= 500) throw new Error('Too many app commands');
            handled.add(parsed.data.requestId);
            const commandTurn = this.store.state.turn.id;
            const emit = (event: Parameters<StageStore['terminal']>[0]) => {
              if (generation === this.generation) this.store.terminal(event, commandTurn);
            };
            const waiting =
              parsed.data.display === 'waiting' && ['exec', 'run'].includes(parsed.data.action)
                ? new WaitingTerminal(parsed.data, emit)
                : undefined;
            if (waiting) waitingRuns.set(parsed.data.requestId, waiting);
            void this.runtime
              .execute(parsed.data, workspace, (event) => {
                if (waiting) waiting.event(event);
                else if (generation === this.generation) this.store.terminal(event);
              })
              .catch(() => ({
                ok: false,
                error: '다른 앱 명령이 진행 중이거나 실행 환경을 확인해야 합니다.',
              }))
              .then(async (result) => {
                if (
                  generation === this.generation &&
                  (parsed.data.action === 'exec' || parsed.data.action === 'run') &&
                  'code' in result
                )
                  this.store.recordReviewRun(
                    commandTurn,
                    parsed.data.requestId,
                    result.code as number | null,
                  );
                if (
                  generation === this.generation &&
                  result.ok &&
                  ['serve', 'stop'].includes(parsed.data.action)
                ) {
                  this.project.app = parsed.data.action === 'serve' ? parsed.data : undefined;
                  await this.project.onApp?.(this.project.app);
                }
                if (generation === this.generation)
                  await this.atomic(`${parsed.data.requestId}.runtime.json`, {
                    ...result,
                    runId: parsed.data.requestId,
                  });
              })
              .catch(() => {
                if (generation === this.generation)
                  void this.fail('앱 실행 결과를 전달하지 못했습니다.');
              })
              .finally(() => {
                waiting?.finish();
                waitingRuns.delete(parsed.data.requestId);
              });
          }
          for (const raw of waits) {
            const parsed = commandWaitSchema.safeParse(raw);
            if (
              parsed.success &&
              parsed.data.turnToken === this.turnToken &&
              parsed.data.conversationId === this.conversation &&
              parsed.data.at >= this.submittedAt &&
              (!nativeWait || parsed.data.at >= nativeWait.at)
            )
              nativeWait = parsed.data;
          }
          for (const waiting of waitingRuns.values())
            waiting.update(
              nativeWait,
              !!nativeWait &&
                this.store.state.turn?.id === this.lifecycleTurn &&
                nativeWait.turnToken === this.turnToken &&
                nativeWait.at >= this.rootStartedAt &&
                !this.store.state.panes.some(
                  (pane) => pane.kind === 'input' && pane.status === 'active',
                ),
            );
          if (finished && this.store.state.turn?.id === finished.id) {
            this.completedOutput = {
              turnToken: this.turnToken!,
              turnId: finished.id,
              parent: this.conversation!,
              until: Date.now() + 3000,
            };
            this.store.finish(
              finished.id,
              finished.error ? 'TUI에서 작업 결과를 확인해 주세요.' : undefined,
            );
            this.inputOwner = undefined;
            this.turnToken = undefined;
            this.lifecycleTurn = undefined;
            this.publicSubmission = false;
          }
        })()
          .catch(() => {
            if (generation === this.generation)
              return this.fail('TUI 작업 상태 연결에 문제가 생겼습니다. 관리자가 재시작해 주세요.');
          })
          .finally(() => {
            this.polling = false;
          });
      }, 75);
      this.timer.unref();
    } catch (error) {
      if (error instanceof TerminalStartupUnconfirmed) this.unsafe = true;
      try {
        await this.process?.stop();
      } catch {
        this.unsafe = true;
      }
      this.process = undefined;
      if (generation === this.generation) this.screen.setStatus('error');
      throw new StageError(
        'Antigravity TUI를 시작하지 못했습니다. Docker와 전용 로그인을 확인해 주세요.',
        503,
      );
    }
  }
  private currentHook(event: { turnToken: string; at: number }) {
    return event.turnToken === this.turnToken && event.at >= this.submittedAt;
  }
  private childId(conversation: string) {
    return `native-${createHash('sha256')
      .update(this.turnToken! + conversation)
      .digest('hex')
      .slice(0, 40)}`;
  }
  private child(conversation: string, at: number) {
    let child = this.children.get(conversation);
    if (!child) {
      if (this.children.size >= 64) return;
      child = {
        // Both journals describe the same native conversation. Never key panes by
        // a hook-local counter: the metadata observer uses this same opaque ID.
        id: this.childId(conversation),
        name: `Subagent ${this.children.size + 1}`,
        startedAt: at,
        updatedAt: at,
        hooked: false,
        state: 'working',
      };
      this.children.set(conversation, child);
      this.knownChildren.add(conversation);
      if (this.knownChildren.size > 512)
        this.knownChildren.delete(this.knownChildren.values().next().value!);
    }
    return child;
  }
  private observed(event: NativeSubagent) {
    if (
      event.childConversationId === this.conversation ||
      event.agent.id !== this.childId(event.childConversationId)
    )
      return;
    const child = this.child(event.childConversationId, event.at);
    if (!child) return;
    // Native hooks are direct execution evidence; a later metadata observation
    // can still describe an older transcript. It must not undo an idle hook or
    // finish a resumed invocation. Explicit kill is metadata-only evidence.
    if (child.hooked && event.agent.state !== 'ended') return;
    if (event.at < child.updatedAt) return;
    child.updatedAt = event.at;
    child.state = event.agent.state;
    this.store.subagent(this.lifecycleTurn!, {
      id: child.id,
      name: child.name,
      state: child.state,
    });
  }
  private async started(event: Lifecycle) {
    const conversation = event.conversationId;
    if (!this.store.state.turn) {
      // A late worker invocation must never claim the next speaker's submission.
      if (!this.inputOwner || this.knownChildren.has(conversation)) return;
      this.lifecycleTurn = this.store.beginTui(this.inputOwner);
      this.conversation = conversation;
      this.project.conversation = conversation;
      await this.project.onConversation?.(conversation);
      await this.atomic('subagent-view.json', {
        conversationId: conversation,
        turnToken: this.turnToken,
      });
      this.rootStartedAt = event.at;
      this.children.clear();
      this.stoppedExecutions.clear();
      this.accepted.clear();
      this.reported.clear();
      return;
    }
    if (this.store.state.turn.id !== this.lifecycleTurn) return;
    if (conversation === this.conversation) {
      this.rootStartedAt = Math.max(this.rootStartedAt, event.at);
      return;
    }
    const child = this.child(conversation, event.at);
    if (!child) return;
    if (!child.hooked && event.at <= child.updatedAt && child.state !== 'working') {
      // The observer may have already seen completion before the start hook was
      // drained. Claim lifecycle ownership without reopening that older start.
      child.hooked = true;
      child.startedAt = event.at;
      return;
    }
    if (
      child.hooked &&
      (event.at < child.updatedAt || (event.at === child.updatedAt && child.state !== 'working'))
    )
      return;
    child.hooked = true;
    child.startedAt = event.at;
    child.updatedAt = event.at;
    child.state = 'working';
    this.store.subagent(this.lifecycleTurn, { id: child.id, name: child.name, state: 'working' });
  }
  private stopped(event: Lifecycle) {
    const turnId = this.lifecycleTurn;
    if (!turnId || this.store.state.turn?.id !== turnId) return;
    const child = this.children.get(event.conversationId);
    const root = event.conversationId === this.conversation;
    if (!root && !child) return;
    if (event.at < (root ? this.rootStartedAt : child!.startedAt)) return;
    if (root && !event.fullyIdle) return;
    if (!event.fullyIdle && !event.error) return;
    if (event.executionNum !== undefined) {
      const key = `${event.turnToken}:${event.conversationId}:${event.executionNum}`;
      if (this.stoppedExecutions.has(key)) return;
      this.stoppedExecutions.add(key);
    }
    if (root) return { id: turnId, error: event.error };
    if (event.at < child!.updatedAt) return;
    child!.updatedAt = event.at;
    child!.hooked = true;
    child!.state = event.error ? 'error' : 'idle';
    this.store.subagent(turnId, {
      id: child!.id,
      name: child!.name,
      state: child!.state,
    });
  }
  async input(session: Session, data: string) {
    if (!participantTuiEnabled() && !session.admin)
      throw new StageError('공개 참여자는 프롬프트 입력창을 사용해 주세요.', 403);
    return this.writeInput(session, data);
  }
  async submitPublicPrompt(session: Session, prompt: string) {
    if (!publicMode() || participantTuiEnabled())
      throw new StageError('공개 프롬프트 모드가 아닙니다. TUI에 직접 입력해 주세요.', 400);
    // No VT escapes, CLI commands or permission-dialog responses may enter this channel.
    // The fixed prefix also prevents slash/shell shortcuts and @-file expansion at the start.
    if (
      !prompt.trim() ||
      prompt.length > 4000 ||
      /(?:^|[^a-zA-Z0-9])@/.test(prompt) ||
      /[\p{Cc}\p{Cf}]/u.test(prompt.replace(/[\n\t]/g, ''))
    )
      throw new StageError('일반 텍스트로 요청을 입력해 주세요.', 400);
    if (
      this.publicSubmission ||
      this.store.state.turn ||
      this.store.state.phase === 'running' ||
      this.store.state.phase === 'waiting'
    )
      throw new StageError('현재 작업을 마친 뒤 다시 요청해 주세요.', 409);
    this.store.assertTuiControl(session);
    this.publicSubmission = true;
    try {
      await this.writeInput(session, `\x15\x1b[200~참가자 요청:\n${prompt}\x1b[201~\r`);
    } catch (error) {
      this.publicSubmission = false;
      throw error;
    }
  }
  private async writeInput(session: Session, data: string) {
    this.store.assertTuiControl(session);
    await this.ensure();
    await this.clearing;
    this.store.assertTuiControl(session);
    if (!this.store.state.turn) this.inputOwner = session;
    if (data.includes('\r')) {
      this.store.holdTuiSubmission(session);
      if (!this.store.state.turn) {
        this.completedOutput = undefined;
        this.turnToken = randomUUID();
        this.submittedAt = Date.now();
      }
      await this.atomic('stage.json', {
        turnToken: this.turnToken,
        panes: this.store.knownPanes(),
      });
      this.store.assertTuiControl(session);
    }
    try {
      this.process!.write(data);
    } catch {
      throw new StageError('TUI 입력 연결이 종료되었습니다.', 503);
    }
  }
  async forgetConversation() {
    this.project.conversation = undefined;
    await this.project.onConversation?.();
  }
  private async syncNativeConversation() {
    if (!this.project.conversation) return; // An explicit reset must not revive its old cache.
    const root = this.project.root ?? resolve(process.env.PADO_DATA_DIR || '.pado');
    let file;
    let id: unknown;
    try {
      file = await open(
        resolve(root, 'cli/cache/last_conversations.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size > 100000) return;
      id = JSON.parse(await file.readFile('utf8'))['/workspace'];
    } catch {
      return;
    } finally {
      await file?.close();
    }
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return;
    this.project.conversation = id;
    await this.project.onConversation?.(id);
  }
  async forgetApp() {
    this.project.app = undefined;
    await this.project.onApp?.();
  }
  async resumeApp(required = false, quiet = false) {
    if (!this.project.app) {
      if (required)
        throw new StageError(
          '저장된 앱 실행 명령이 없습니다. Agent에게 서버 실행을 요청해 주세요.',
        );
      return;
    }
    if (this.runtime.state === 'running') return;
    if (this.runtime.state === 'starting') throw new StageError('앱 서버가 시작 중입니다.');
    const result = await this.runtime.execute(
      { ...this.project.app, requestId: randomUUID(), display: quiet ? 'none' : 'terminal' },
      this.project.workspace ?? resolve(process.env.PADO_DATA_DIR || '.pado', 'workspace'),
      (event) => {
        // Startup restoration is not a new presentation decision. Keep saved evidence
        // unchanged; an explicit serve/resume owns any new live log pane.
        if (!quiet) this.store.terminal(event);
      },
    );
    if (!result.ok)
      throw new StageError(
        '프로젝트는 열었지만 앱 서버를 재시작하지 못했습니다. Agent에서 확인해 주세요.',
        503,
      );
  }
  async resize(session: Session, cols: number, rows: number) {
    this.store.assertTuiResize(session);
    const task = this.resizing.then(async () => {
      await this.starting;
      this.store.assertTuiResize(session);
      const child = this.process;
      const generation = this.generation;
      if (!child || this.stopping)
        throw new StageError('TUI가 중지되어 있습니다. 다시 손들어 시작해 주세요.', 409);
      if (cols === this.screen.cols && rows === this.screen.rows) return;
      const previous = { cols: this.screen.cols, rows: this.screen.rows };
      child.pause();
      try {
        // Parse the PTY's resize repaint at the new dimensions, never the old ones.
        await this.screen.resize(cols, rows);
        await child.resize(cols, rows);
      } catch {
        if (generation === this.generation) await this.screen.resize(previous.cols, previous.rows);
        throw new StageError('터미널 크기를 변경하지 못했습니다.', 503);
      } finally {
        child.resume();
      }
    });
    this.resizing = task.catch(() => {});
    return task;
  }
  tick() {
    const current = this.store.state.speaker?.participantId;
    if (this.previousSpeaker && current !== this.previousSpeaker && !this.store.state.turn) {
      this.inputOwner = undefined;
      const generation = this.generation;
      this.clearing = this.clearing
        .then(async () => {
          if (generation !== this.generation) return;
          this.process?.write('\x1b');
          // ESC must be a standalone key, not an Alt prefix on the following Ctrl+U.
          await delay(100);
          if (generation === this.generation) this.process?.write('\x15');
        })
        .catch(() => {});
    }
    this.previousSpeaker = current;
  }
  private async atomic(name: string, value: unknown) {
    const temporary = resolve(this.bridge, `.${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(value));
    } finally {
      await file.close();
    }
    await rename(temporary, resolve(this.bridge, name));
  }
  assertCanSubmit(id: string) {
    if (!this.process || this.accepted.has(id)) throw new StageError('입력 요청이 종료되었습니다.');
  }
  async submit(id: string, values: Record<string, string>) {
    this.assertCanSubmit(id);
    this.accepted.add(id);
    try {
      await this.atomic(`${id}.answer.json`, values);
    } catch (error) {
      this.accepted.delete(id);
      throw error;
    }
  }
  async inputError(id: string, message: string) {
    if (!this.process || this.reported.has(id)) return;
    this.reported.add(id);
    await this.atomic(`${id}.error.json`, { message });
  }
  private async fail(message: string) {
    try {
      await this.stop();
    } catch {
      /* Marked unsafe by stop. */
    }
    this.screen.setStatus('error');
    const id = this.store.state.turn?.id;
    if (id) this.store.finish(id, message);
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      ++this.generation;
      this.previousSpeaker = undefined;
      clearInterval(this.timer);
      await this.starting?.catch(() => {});
      const child = this.process;
      this.process = undefined;
      this.inputOwner = undefined;
      this.turnToken = undefined;
      this.lifecycleTurn = undefined;
      this.publicSubmission = false;
      try {
        if (this.unsafe) throw new Error('Container shutdown is unconfirmed');
        const results = await Promise.allSettled([child?.stop(), this.runtime.stop()]);
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('Container shutdown is unconfirmed');
      } catch {
        this.unsafe = true;
        throw new StageError('TUI 컨테이너 중단을 확인하지 못했습니다.', 503);
      } finally {
        this.store.interruptTerminals();
        this.screen.setStatus('stopped');
      }
      if (child) await this.syncNativeConversation();
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }
  async retire() {
    this.retired = true;
    await this.stop();
    this.screen.dispose();
  }
}
