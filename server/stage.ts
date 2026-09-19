import { randomUUID } from 'node:crypto';
import {
  presentationSchema,
  paneSchema,
  decisionAnswerSchema,
  speakerLeaseMs,
  subagentProgressSchema,
  type Presentation,
  type Session,
  type Stage,
  type AgentActivity,
  type SubagentProgress,
  type Pane,
} from '../shared/protocol.ts';
import type { TerminalEvent } from './terminal-events.ts';

export class StageError extends Error {
  constructor(
    message: string,
    public status = 409,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export class StageStore {
  state: Stage;
  private savedPanes = new Map<string, Pane>();
  private workContextPaneId?: string;
  private reviewRuns = new Map<string, { id: string; code: number | null; at: number }>();
  private tuiSubmissionUntil = 0;
  private listeners = new Set<() => void>();
  private subagentRuns = new Map<
    string,
    { paneId: string; state: SubagentProgress['state']; dismissed: boolean }
  >();
  private subagentTimer?: ReturnType<typeof setTimeout>;
  private subagentOutputTurn?: string;
  private subagentOutputs = new Map<string, string>();
  constructor(
    runner: Stage['runner'] = 'rehearsal',
    private now = Date.now,
  ) {
    this.state = {
      revision: 0,
      title: 'Build something together',
      runner,
      phase: 'idle',
      participants: [],
      speaker: null,
      turn: null,
      panes: [],
      focusId: 'agent',
      focusVersion: 0,
      messages: [
        {
          id: randomUUID(),
          author: 'agent',
          at: now(),
          text: '무엇을 만들어 볼까요?\n손을 들고 아이디어를 남겨 주세요. 필요한 순간에 workspace가 함께 바뀝니다.',
        },
      ],
      activity: null,
      serverTime: now(),
    };
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  /** Hidden artifacts are restorable presentation state, never a file deletion. */
  knownPanes() {
    const panes = new Map(this.savedPanes);
    for (const pane of this.state.panes)
      if (pane.kind !== 'input' && pane.kind !== 'subagent') panes.set(pane.id, pane);
    return [...panes.values()].map(({ id, kind, title, size, status }) => ({
      id,
      kind,
      title,
      size,
      status,
      visible: this.state.panes.some((pane) => pane.id === id),
    }));
  }
  private remember(pane: Pane) {
    if (pane.kind === 'input' || pane.kind === 'subagent') return;
    this.savedPanes.delete(pane.id);
    this.savedPanes.set(pane.id, structuredClone(pane));
    while (this.savedPanes.size > 24) {
      // Keep this turn's basis even when it is dismissed while other artifacts are published.
      const oldest = [...this.savedPanes.keys()].find((id) => id !== this.workContextPaneId)!;
      this.savedPanes.delete(oldest);
    }
  }
  private clearForTurn() {
    this.reviewRuns.clear();
    this.workContextPaneId = undefined;
    for (const pane of this.state.panes) this.remember(pane);
    clearTimeout(this.subagentTimer);
    this.subagentRuns.clear();
    this.subagentOutputs.clear();
    this.subagentOutputTurn = this.state.turn?.id;
    this.state.panes = this.state.panes.filter((pane) => pane.manual);
    this.state.focusId = 'agent';
    this.state.focusVersion++;
  }
  private foreground(id: string, size?: number) {
    const pane = this.state.panes.find((item) => item.id === id);
    if (id !== 'agent' && !pane) return;
    if (pane && pane.kind !== 'subagent') {
      pane.size = size ?? Math.max(2, pane.size);
      this.state.panes = [pane, ...this.state.panes.filter((item) => item.id !== id)];
    }
    this.state.focusId = id;
    this.state.focusVersion++;
  }
  checkpoint() {
    for (const pane of this.state.panes) this.remember(pane);
    return structuredClone({
      panes: this.state.panes.filter((pane) => pane.kind !== 'input' && pane.kind !== 'subagent'),
      savedPanes: [...this.savedPanes.values()],
      focusId: this.state.focusId,
      messages: this.state.messages,
    });
  }
  restore(saved: ReturnType<StageStore['checkpoint']>) {
    this.reviewRuns.clear();
    this.workContextPaneId = undefined;
    clearTimeout(this.subagentTimer);
    this.subagentRuns.clear();
    this.subagentOutputs.clear();
    this.subagentOutputTurn = undefined;
    this.tuiSubmissionUntil = 0;
    const restorePanes = (panes: Pane[]) =>
      structuredClone(panes)
        // Legacy Terminal content could be authored by the agent; it has no process provenance.
        .filter((pane) => pane.kind !== 'terminal' || !!pane.terminal)
        .map((pane) => {
          if (pane.workContext?.state === 'working') {
            pane.workContext.state = 'interrupted';
            if (pane.kind === 'context') pane.status = 'error';
          }
          if (pane.terminal && pane.terminal.finishedAt === undefined) {
            pane.status = 'error';
            pane.terminal.finishedAt = this.now();
            pane.terminal.code = null;
          }
          return pane;
        });
    this.savedPanes = new Map(restorePanes(saved.savedPanes).map((pane) => [pane.id, pane]));
    this.state.panes = restorePanes(saved.panes);
    this.state.messages = structuredClone(saved.messages);
    this.state.focusId = this.state.panes.some((pane) => pane.id === saved.focusId)
      ? saved.focusId
      : 'agent';
    this.state.focusVersion++;
    this.state.speaker = null;
    this.state.turn = null;
    this.state.phase = 'idle';
    this.state.activity = null;
    this.publish();
  }
  publish() {
    this.state.revision++;
    this.state.serverTime = this.now();
    for (const fn of this.listeners) fn();
  }
  join(session: Session) {
    if (this.state.participants.length >= 200)
      throw new StageError('현재 stage가 가득 찼습니다.', 503);
    this.state.participants.push({ id: session.id, nickname: session.nickname, online: false });
    this.publish();
  }
  presence(id: string, online: boolean) {
    const p = this.state.participants.find((p) => p.id === id);
    if (p && p.online !== online) {
      p.online = online;
      this.publish();
    }
  }
  leave(id: string) {
    this.state.participants = this.state.participants.filter((p) => p.id !== id);
    if (this.state.speaker?.participantId === id) this.state.speaker = null;
    this.publish();
  }
  get interactionBusy() {
    return !!this.state.turn || !!this.state.speaker || this.tuiSubmissionUntil > this.now();
  }
  tick() {
    let changed = false;
    if (this.tuiSubmissionUntil && this.tuiSubmissionUntil <= this.now()) {
      this.tuiSubmissionUntil = 0;
      changed = true;
    }
    if (
      this.state.speaker &&
      this.state.speaker.expiresAt <= this.now() &&
      this.tuiSubmissionUntil <= this.now()
    ) {
      this.state.speaker = null;
      changed = true;
    }
    const expired = this.state.panes.filter(
      (pane) => pane.subagent?.closeAt !== undefined && pane.subagent.closeAt <= this.now(),
    );
    for (const pane of expired) this.closePane(pane.id);
    if (expired.length) {
      this.scheduleSubagentClose();
      changed = true;
    }
    if (changed) this.publish();
  }
  raise(session: Session) {
    this.tick();
    if (this.state.speaker || this.state.turn)
      throw new StageError('다른 참가자가 발언 중이거나 작업이 진행 중입니다.');
    this.state.speaker = { participantId: session.id, expiresAt: this.now() + speakerLeaseMs };
    this.publish();
  }
  release(session: Session) {
    if (!session.admin && this.state.speaker?.participantId !== session.id)
      throw new StageError('발언권이 없습니다.', 403);
    this.state.speaker = null;
    this.tuiSubmissionUntil = 0;
    this.publish();
  }
  assertTuiControl(session: Session) {
    this.tick();
    const owner = this.state.turn?.participantId ?? this.state.speaker?.participantId;
    if (!session.admin && owner !== session.id)
      throw new StageError('현재 발언자 또는 관리자만 TUI를 조작할 수 있습니다.', 403);
  }
  assertPaneControl(session: Session) {
    this.tick();
    const owner = this.state.turn?.participantId ?? this.state.speaker?.participantId;
    if (!session.admin && owner !== session.id)
      throw new StageError('현재 발언자 또는 관리자만 pane을 조작할 수 있습니다.', 403);
  }
  addManualPane(value: Pane) {
    const pane = paneSchema.parse({ ...value, manual: true });
    if (this.state.panes.filter((item) => item.kind !== 'subagent').length >= 6)
      throw new StageError('pane은 최대 6개까지 열 수 있습니다.');
    this.state.panes.push(pane);
    this.foreground(pane.id, pane.size);
    this.remember(pane);
    this.publish();
  }
  showManualPane(id: string) {
    if (!this.knownPanes().some((pane) => pane.id === id))
      throw new StageError('다시 표시할 pane이 없습니다.', 404);
    this.present({ type: 'pane.show', id });
    const pane = this.state.panes.find((item) => item.id === id)!;
    pane.manual = true;
    this.remember(pane);
    this.publish();
  }
  holdTuiSubmission(session: Session) {
    if (session.admin || this.state.speaker?.participantId === session.id) {
      this.tuiSubmissionUntil = this.now() + 5000;
      this.publish();
    }
  }
  assertTuiResize(session: Session) {
    this.assertTuiControl(session);
    const owner = this.state.turn?.participantId ?? this.state.speaker?.participantId;
    if (owner !== session.id)
      throw new StageError('공유 터미널 크기는 현재 발언자 화면을 따릅니다.', 403);
  }
  beginTui(session: Session) {
    this.assertTuiControl(session);
    if (this.state.turn) throw new StageError('이미 작업 중입니다.');
    const id = randomUUID();
    this.state.turn = { id, participantId: session.id, prompt: '', startedAt: this.now() };
    this.state.speaker = null;
    this.tuiSubmissionUntil = 0;
    this.state.phase = 'running';
    this.state.activity = { phase: 'planning', subagents: [] };
    this.clearForTurn();
    this.publish();
    return id;
  }
  begin(session: Session, prompt: string) {
    this.tick();
    if (this.state.turn) throw new StageError('작업이 진행 중입니다.');
    if (this.state.speaker?.participantId !== session.id)
      throw new StageError('먼저 발언권을 얻어 주세요.', 403);
    const value = prompt.trim();
    if (!value || value.length > 4000)
      throw new StageError('프롬프트는 1~4,000자로 입력해 주세요.', 400);
    this.state.turn = {
      id: randomUUID(),
      participantId: session.id,
      prompt: value,
      startedAt: this.now(),
    };
    this.state.phase = 'running';
    this.state.activity = { phase: 'planning', subagents: [] };
    this.state.speaker = null;
    this.clearForTurn();
    this.message('user', value, session.nickname);
    this.publish();
    return this.state.turn.id;
  }
  message(author: 'agent' | 'user' | 'system', text: string, nickname?: string) {
    this.state.messages.push({ id: randomUUID(), author, text, at: this.now(), nickname });
    this.state.messages = this.state.messages.slice(-60);
  }
  progress(turnId: string, activity: AgentActivity) {
    if (this.state.turn?.id !== turnId) return;
    this.state.activity ??= { phase: 'planning', subagents: [] };
    this.state.activity.phase = activity.phase;
    for (const agent of activity.subagents.slice(0, 8)) this.updateSubagent(agent);
    this.scheduleSubagentClose();
    this.publish();
  }
  subagent(turnId: string, agent: SubagentProgress) {
    if (this.state.turn?.id !== turnId) return;
    if (!this.updateSubagent(agent)) return;
    this.scheduleSubagentClose();
    this.publish();
  }
  /** Output updates never create or reopen a pane or alter its close deadline. */
  subagentOutput(turnId: string, id: string, output: string) {
    if (turnId !== this.subagentOutputTurn || !/^native-[a-f0-9]{40}$/.test(id)) return;
    if (typeof output !== 'string' || output.length > 16_000) return;
    // The container emits plain text; independently reject terminal control bytes.
    // oxlint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(output)) return;
    if (!this.subagentOutputs.has(id) && this.subagentOutputs.size >= 64) return;
    if (this.subagentOutputs.get(id) === output) return;
    this.subagentOutputs.set(id, output);
    const run = this.subagentRuns.get(id);
    const pane = this.state.panes.find((item) => item.id === run?.paneId);
    if (!pane?.subagent) return;
    pane.subagent.output = output;
    this.publish();
  }
  private updateSubagent(value: SubagentProgress) {
    const parsed = subagentProgressSchema.safeParse(value);
    if (!parsed.success) return false;
    const agent = parsed.data;
    const active = agent.state === 'starting' || agent.state === 'working';
    let run = this.subagentRuns.get(agent.id);
    // Bound live panes independently of the six user-facing artifact panes.
    const visible = this.state.panes.filter((pane) => pane.kind === 'subagent');
    let pane = this.state.panes.find((pane) => pane.id === run?.paneId);
    if (!run) {
      if (this.subagentRuns.size >= 64) return false;
      run = { paneId: `subagent-${randomUUID()}`, state: agent.state, dismissed: false };
      this.subagentRuns.set(agent.id, run);
    } else if (active && run.state !== 'starting' && run.state !== 'working') {
      run.dismissed = false;
      if (pane) pane.subagent = { state: agent.state, startedAt: this.now() };
    }
    run.state = agent.state;
    this.state.activity ??= { phase: 'delegating', subagents: [] };
    const existing = this.state.activity.subagents.findIndex((item) => item.id === agent.id);
    if (existing >= 0) this.state.activity.subagents[existing] = agent;
    else {
      this.state.activity.subagents.push(agent);
      this.state.activity.subagents = this.state.activity.subagents.slice(-8);
    }
    if (run.dismissed) return true;
    if (!pane) {
      if (visible.length >= 8) return true;
      pane = paneSchema.parse({
        id: run.paneId,
        kind: 'subagent',
        title: agent.name,
        subagent: { state: agent.state, startedAt: this.now() },
      });
      this.state.panes.push(pane);
      // Preserve an outstanding decision's focus when a background worker starts.
      if (!this.state.panes.some((item) => item.kind === 'input' && item.status === 'active')) {
        this.state.focusId = pane.id;
        this.state.focusVersion++;
      }
    }
    this.setSubagentState(pane, agent.state);
    const output = this.subagentOutputs.get(agent.id);
    if (output !== undefined) pane.subagent!.output = output;
    pane.title = agent.name;
    return true;
  }
  private setSubagentState(pane: Pane, state: SubagentProgress['state']) {
    const metadata = pane.subagent!;
    metadata.state = state;
    const active = state === 'starting' || state === 'working';
    pane.status = active ? 'active' : state === 'error' ? 'error' : 'done';
    pane.subtitle = {
      starting: '서브에이전트를 시작하고 있어요',
      working: '위임받은 작업을 진행하고 있어요',
      idle: '작업 응답을 마쳤어요',
      ended: '서브에이전트 실행이 종료됐어요',
      error: '서브에이전트 실행이 중단됐어요',
    }[state];
    if (active) {
      delete metadata.finishedAt;
      delete metadata.closeAt;
    } else if (metadata.closeAt === undefined) {
      metadata.finishedAt = this.now();
      metadata.closeAt = metadata.finishedAt + 3000;
    }
  }
  private scheduleSubagentClose() {
    clearTimeout(this.subagentTimer);
    const deadlines = this.state.panes.flatMap((pane) =>
      pane.subagent?.closeAt === undefined ? [] : [pane.subagent.closeAt],
    );
    if (!deadlines.length) return;
    this.subagentTimer = setTimeout(
      () => {
        this.tick();
        // Timers may run just before the deadline; always arrange the remainder.
        this.scheduleSubagentClose();
      },
      Math.max(0, Math.min(...deadlines) - this.now()),
    );
    this.subagentTimer.unref();
  }
  private closePane(id: string) {
    const pane = this.state.panes.find((item) => item.id === id);
    if (pane) this.remember(pane);
    for (const run of this.subagentRuns.values()) if (run.paneId === id) run.dismissed = true;
    this.state.panes = this.state.panes.filter((pane) => pane.id !== id);
    if (this.state.focusId === id) {
      this.state.focusId = this.state.panes[0]?.id ?? 'agent';
      this.state.focusVersion++;
    }
  }
  recordReviewRun(turnId: string, id: string, code: number | null) {
    if (this.state.turn?.id !== turnId) return;
    this.reviewRuns.set(id, { id, code, at: this.now() });
    while (this.reviewRuns.size > 100) this.reviewRuns.delete(this.reviewRuns.keys().next().value!);
  }
  publishesPreview(port: number) {
    return this.state.panes.some(
      (pane) =>
        (pane.kind === 'browser' && pane.server?.port === port) ||
        (pane.kind === 'review' &&
          pane.review?.checks.some((check) => check.reproduction?.port === port)),
    );
  }
  validateAnswer(id: string, values: Record<string, string>) {
    const pane = this.state.panes.find(
      (pane) => pane.id === id && pane.kind === 'input' && pane.status === 'active',
    );
    if (!pane) throw new StageError('입력 요청이 종료되었습니다.');
    if (pane.secret) throw new StageError('시크릿 전용 입력으로 설정해 주세요.', 400);
    if (!pane.decision) return values;
    const answer = decisionAnswerSchema.safeParse(values);
    if (
      !answer.success ||
      !pane.decision.options.some((option) => option.id === answer.data.optionId)
    )
      throw new StageError('표시된 선택지 중 하나를 골라 주세요.', 400);
    return answer.data;
  }
  present(event: Presentation, turnId?: string) {
    if (turnId && this.state.turn?.id !== turnId) return;
    const e = presentationSchema.parse(event);
    switch (e.type) {
      case 'pane.upsert': {
        if (
          this.state.panes.find((pane) => pane.id === e.pane.id)?.terminal ||
          this.savedPanes.get(e.pane.id)?.terminal
        )
          throw new StageError(
            '실행 로그는 덮어쓸 수 없습니다. 다른 pane ID를 사용해 주세요.',
            400,
          );
        const currentContext = this.workContextPaneId
          ? (this.state.panes.find((pane) => pane.id === this.workContextPaneId) ??
            this.savedPanes.get(this.workContextPaneId))
          : undefined;
        const context =
          currentContext?.workContext?.turnId === this.state.turn?.id ? currentContext : undefined;
        const previous = this.state.panes.find((pane) => pane.id === e.pane.id);
        if (previous?.manual || this.savedPanes.get(e.pane.id)?.manual) e.pane.manual = true;
        if (context?.id === e.pane.id && !['context', 'review'].includes(e.pane.kind))
          throw new StageError('작업 기준은 Context 또는 Review로만 갱신할 수 있습니다.', 400);
        if (e.pane.kind === 'context') {
          if (!this.state.turn)
            throw new StageError('작업 기준은 진행 중인 작업에서만 공개할 수 있습니다.');
          if (context && (context.id !== e.pane.id || context.kind === 'review'))
            throw new StageError(
              '이번 작업의 기준은 같은 ID로 갱신하고 Review 이후에는 바꾸지 마세요.',
            );
          e.pane.status = 'active';
          e.pane.workContext = {
            turnId: this.state.turn.id,
            title: e.pane.title,
            content: e.pane.content,
            updatedAt:
              context?.content === e.pane.content && context.title === e.pane.title
                ? context.workContext!.updatedAt
                : this.now(),
            state: 'working',
          };
          // Updating the side reference must not move panes, resize them or steal input focus.
          if (previous) e.pane.size = previous.size;
        }
        if (e.pane.review) {
          if (context) {
            if (context.kind === 'review' && context.id !== e.pane.id)
              throw new StageError('이번 작업의 Review는 기존 ID로 갱신해 주세요.');
            e.pane.workContext = structuredClone(context.workContext);
          }
          for (const check of e.pane.review.checks) {
            if (check.runId) {
              const run = this.reviewRuns.get(check.runId);
              check.run = run ? { ...run } : undefined;
              check.status =
                !run || run.code === null ? 'unverified' : run.code === 0 ? 'passed' : 'failed';
            } else if (!check.evidence.trim()) check.status = 'unverified';
          }
          // A completed report is not synonymous with a fully verified implementation.
          e.pane.status = e.pane.review.checks.some((check) => check.status === 'failed')
            ? 'error'
            : 'done';
        }
        // A new Review ID can also take over the current context's place without duplicating it.
        const replacedContext =
          e.pane.kind === 'review' && context && context.id !== e.pane.id ? context : undefined;
        if (replacedContext?.manual) e.pane.manual = true;
        const remaining = this.state.panes.filter((pane) => pane.id !== replacedContext?.id);
        const existing = remaining.findIndex((p) => p.id === e.pane.id);
        if (existing < 0 && remaining.filter((pane) => pane.kind !== 'subagent').length >= 6)
          throw new StageError('pane은 최대 6개까지 열 수 있습니다.');
        this.state.panes = remaining;
        if (replacedContext) this.savedPanes.delete(replacedContext.id);
        if (existing >= 0) this.state.panes[existing] = e.pane;
        else this.state.panes.push(e.pane);
        if (e.pane.workContext) this.workContextPaneId = e.pane.id;
        if (e.pane.kind !== 'context') this.foreground(e.pane.id, e.pane.size);
        this.remember(e.pane);
        break;
      }
      case 'pane.show': {
        let pane = this.state.panes.find((item) => item.id === e.id);
        if (!pane) {
          const saved = this.savedPanes.get(e.id);
          if (!saved) throw new StageError('다시 표시할 pane이 없습니다.', 404);
          if (this.state.panes.filter((item) => item.kind !== 'subagent').length >= 6)
            throw new StageError('pane은 최대 6개까지 열 수 있습니다.');
          pane = structuredClone(saved);
          this.state.panes.push(pane);
        }
        this.foreground(e.id, e.size);
        break;
      }
      case 'pane.close':
        this.closePane(e.id);
        this.scheduleSubagentClose();
        break;
      case 'pane.focus':
        this.foreground(e.id);
        break;
      case 'pane.resize': {
        const pane = this.state.panes.find((p) => p.id === e.id);
        if (pane) pane.size = e.size;
        break;
      }
      case 'agent.message':
        this.message('agent', e.text);
        break;
    }
    this.syncPhase();
    this.publish();
  }
  terminal(event: TerminalEvent, turnId?: string) {
    if (turnId && this.state.turn?.id !== turnId) return;
    if (event.type === 'terminal.open') {
      if (event.id.startsWith('user-'))
        throw new StageError('직접 연 pane의 ID는 실행 로그에 사용할 수 없습니다.', 400);
      if (event.id === this.workContextPaneId)
        throw new StageError('작업 기준과 Review의 ID는 실행 로그에 사용할 수 없습니다.', 400);
      const existing = this.state.panes.findIndex((pane) => pane.id === event.id);
      if (existing < 0 && this.state.panes.filter((pane) => pane.kind !== 'subagent').length >= 6)
        throw new StageError('pane은 최대 6개까지 열 수 있습니다.');
      const pane = paneSchema.parse({
        id: event.id,
        kind: 'terminal',
        title: event.title,
        subtitle: event.subtitle,
        size: event.size,
        content: '',
        status: 'active',
        manual: (
          this.state.panes.find((pane) => pane.id === event.id) ?? this.savedPanes.get(event.id)
        )?.manual,
        terminal: {
          runId: event.runId,
          startedAt: event.startedAt ?? this.now(),
          command: event.command,
          cwd: event.cwd,
          port: event.port,
        },
      });
      if (existing < 0) this.state.panes.push(pane);
      else this.state.panes[existing] = pane;
      this.remember(pane);
      if (event.foreground !== false) this.foreground(pane.id, pane.size);
    } else {
      // Hidden logs continue collecting output without reopening or stealing focus.
      const pane =
        this.state.panes.find((pane) => pane.id === event.id) ?? this.savedPanes.get(event.id);
      if (
        !pane?.terminal ||
        pane.terminal.runId !== event.runId ||
        pane.terminal.finishedAt !== undefined
      )
        return;
      if (event.type === 'terminal.append')
        pane.content = (
          pane.content +
          (event.stream === 'stderr' ? '[stderr] ' : '') +
          event.text
        ).slice(-60_000);
      else if (event.type === 'terminal.ready') {
        if (!pane.terminal.port) return;
        pane.terminal.readyAt ??= this.now();
      } else {
        pane.terminal.code = event.code;
        pane.terminal.finishedAt = this.now();
        pane.status = event.code === 0 ? 'done' : 'error';
      }
      this.remember(pane);
    }
    this.publish();
  }
  interruptTerminals() {
    for (const pane of [...this.savedPanes.values(), ...this.state.panes])
      if (pane.terminal && !pane.shell && pane.terminal.finishedAt === undefined)
        this.terminal({
          type: 'terminal.exit',
          id: pane.id,
          runId: pane.terminal.runId,
          code: null,
        });
  }
  private syncPhase() {
    if (this.state.turn)
      this.state.phase = this.state.panes.some(
        (pane) => pane.kind === 'input' && pane.status === 'active',
      )
        ? 'waiting'
        : 'running';
  }
  waiting(turnId: string) {
    if (this.state.turn?.id === turnId) {
      this.state.phase = 'waiting';
      this.publish();
    }
  }
  running(turnId: string) {
    if (this.state.turn?.id === turnId) {
      this.syncPhase();
      this.publish();
    }
  }
  canAnswer(session: Session, id: string) {
    return (
      !!this.state.turn &&
      (session.admin || this.state.turn.participantId === session.id) &&
      this.state.panes.some((p) => p.id === id && p.kind === 'input' && p.status === 'active')
    );
  }
  finish(turnId: string, error?: string) {
    if (this.state.turn?.id !== turnId) return;
    // Include a dismissed context/report, so restoring it cannot imply the job is still running.
    const artifacts = new Map(this.savedPanes);
    for (const pane of this.state.panes) artifacts.set(pane.id, pane);
    for (const pane of artifacts.values()) {
      if (pane.workContext?.turnId !== turnId) continue;
      pane.workContext.state = error ? 'interrupted' : 'finished';
      if (pane.kind === 'context') pane.status = error ? 'error' : 'done';
      this.remember(pane);
    }
    this.workContextPaneId = undefined;
    this.state.phase = error ? 'error' : 'idle';
    this.state.turn = null;
    if (this.state.activity)
      for (const agent of this.state.activity.subagents)
        if (agent.state === 'starting' || agent.state === 'working')
          agent.state = error ? 'error' : 'ended';
    for (const pane of this.state.panes)
      if (pane.subagent && pane.status === 'active')
        this.setSubagentState(pane, error ? 'error' : 'ended');
    this.scheduleSubagentClose();
    this.state.panes = this.state.panes.filter((p) => p.kind !== 'input');
    if (error)
      for (const pane of this.state.panes)
        if (pane.status === 'active' && !pane.terminal && !pane.manual) pane.status = 'error';
    if (
      this.state.focusId !== 'agent' &&
      !this.state.panes.some((p) => p.id === this.state.focusId)
    ) {
      this.state.focusId = this.state.panes.at(-1)?.id ?? 'agent';
      this.state.focusVersion++;
    }
    if (error) this.message('system', error);
    this.publish();
  }
  reset() {
    this.reviewRuns.clear();
    this.workContextPaneId = undefined;
    clearTimeout(this.subagentTimer);
    this.subagentRuns.clear();
    this.subagentOutputs.clear();
    this.subagentOutputTurn = undefined;
    this.savedPanes.clear();
    this.tuiSubmissionUntil = 0;
    this.state.turn = null;
    this.state.speaker = null;
    this.state.phase = 'idle';
    this.state.panes = [];
    this.state.focusId = 'agent';
    this.state.focusVersion++;
    this.state.messages = [];
    this.state.activity = null;
    this.message('agent', '새로운 아이디어를 기다리고 있어요. 손을 들고 함께 시작해 보세요.');
    this.publish();
  }
}
