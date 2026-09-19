import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { type Pane, type Presentation } from '../shared/protocol.ts';
import { StageError, StageStore } from './stage.ts';
import { TuiSession, type TuiWorkspace } from './tui-session.ts';

const choiceHtml = `<style>body{font:15px system-ui;color:#e8ebf2;background:#171a20;padding:24px;margin:0}h2{font-size:22px;margin:0 0 12px}p{color:#939cac;line-height:1.7}button{display:block;width:100%;padding:16px;margin-top:12px;border:1px solid #364355;border-radius:12px;background:#202732;color:#f1f5fc;text-align:left;font:inherit;cursor:pointer}button:hover{border-color:#438dff;background:#223c65}</style><h2>어떤 분위기가 좋을까요?</h2><p>리허설 결과에 사용할 테마를 골라 주세요.</p><button onclick="window.pado.submit({theme:'Ocean blue'})">● &nbsp; Ocean blue · 선명하고 차분하게</button><button onclick="window.pado.submit({theme:'Midnight'})">● &nbsp; Midnight · 깊고 고요하게</button>`;

export class Runner {
  private controller?: AbortController;
  private child?: ChildProcess;
  readonly tui: TuiSession;
  private task?: Promise<void>;
  private answer?: { paneId: string; resolve: (value: Record<string, string>) => void };
  private submissions = new Set<string>();
  constructor(
    private store: StageStore,
    project: TuiWorkspace = {},
  ) {
    this.tui = new TuiSession(store, undefined, project);
  }

  assertReady() {
    if (this.controller)
      throw new StageError('이전 작업을 정리하고 있습니다. 잠시 후 다시 시도해 주세요.');
  }

  start(turnId: string) {
    if (this.store.state.runner === 'antigravity')
      throw new StageError('Antigravity TUI에 직접 입력해 주세요.', 400);
    this.assertReady();
    const controller = new AbortController();
    this.controller = controller;
    const task = this.rehearsal(turnId, controller.signal);
    this.task = task
      .catch((error) => {
        if (!controller.signal.aborted)
          this.store.finish(
            turnId,
            error instanceof StageError
              ? error.message
              : '작업을 완료하지 못했습니다. 관리자가 runner 상태를 확인해 주세요.',
          );
      })
      .finally(() => {
        if (this.controller === controller) {
          this.controller = undefined;
          this.child = undefined;
          this.answer = undefined;
          this.task = undefined;
        }
      });
  }
  async stop(retire = false) {
    const id = this.store.state.turn?.id;
    this.controller?.abort();
    this.answer = undefined;
    const child = this.child;
    if (child && child.exitCode === null) child.kill('SIGTERM');
    let stopFailed = false;
    try {
      if (retire) await this.tui.retire();
      else await this.tui.stop();
    } catch {
      stopFailed = true;
    }
    await this.task;
    if (stopFailed) {
      if (id)
        this.store.finish(
          id,
          '컨테이너 중단을 확인하지 못했습니다. 진행자가 runner를 확인해 주세요.',
        );
      throw new StageError('컨테이너 중단을 확인하지 못했습니다.', 503);
    }
    if (id) this.store.finish(id, '관리자가 작업을 중단했습니다.');
  }
  async submit(paneId: string, values: Record<string, string>) {
    values = this.store.validateAnswer(paneId, values);
    return this.deliverAnswer(paneId, values);
  }
  async submitSecret(paneId: string, value: string) {
    const pane = this.store.state.panes.find(
      (p) => p.id === paneId && p.kind === 'input' && p.status === 'active',
    );
    if (!pane?.secret || !this.store.state.turn)
      throw new StageError('시크릿 입력 요청이 종료되었습니다.', 400);
    const name = pane.secret.name;
    return this.deliverAnswer(paneId, { name, configured: 'true' }, () =>
      this.tui.secrets.set(name, value),
    );
  }
  private async deliverAnswer(
    paneId: string,
    values: Record<string, string>,
    save?: () => Promise<void>,
  ) {
    if (this.submissions.has(paneId)) throw new StageError('입력을 처리하고 있습니다.');
    const turnId = this.store.state.turn?.id;
    const pane = this.store.state.panes.find((p) => p.id === paneId);
    if (this.store.state.runner === 'antigravity') this.tui.assertCanSubmit(paneId);
    else if (!this.answer || this.answer.paneId !== paneId)
      throw new StageError('이미 답변했거나 입력 요청이 종료되었습니다.');
    this.submissions.add(paneId);
    try {
      await save?.();
      if (this.store.state.turn?.id !== turnId || !this.store.state.panes.includes(pane!))
        throw new StageError('입력 요청이 종료되었습니다.');
      if (this.store.state.runner === 'antigravity') {
        try {
          await this.tui.submit(paneId, values);
        } catch {
          throw new StageError('이미 답변했거나 입력 요청이 종료되었습니다.');
        }
      } else {
        if (!this.answer || this.answer.paneId !== paneId)
          throw new StageError('이미 답변했거나 입력 요청이 종료되었습니다.');
        this.answer.resolve(values);
        this.answer = undefined;
      }
      if (pane) {
        pane.status = 'done';
        if (pane.decision) pane.answer = { optionId: values.optionId, note: values.note };
      }
      if (this.store.state.turn) this.store.running(this.store.state.turn.id);
    } finally {
      this.submissions.delete(paneId);
    }
  }
  async inputError(paneId: string, message: string) {
    if (this.store.state.runner === 'antigravity') await this.tui.inputError(paneId, message);
  }
  private emit(id: string, e: Presentation) {
    this.store.present(e, id);
  }
  private pane(id: string, pane: Pick<Pane, 'id' | 'kind' | 'title'> & Partial<Pane>) {
    this.emit(id, {
      type: 'pane.upsert',
      pane: { content: '', size: 1, subtitle: '', status: 'active', ...pane },
    });
  }
  private async rehearsal(id: string, signal: AbortSignal) {
    this.emit(id, {
      type: 'agent.message',
      text: '로컬 리허설을 시작합니다. 입력한 아이디어와 함께 화면 흐름을 확인하는 고정 시나리오예요. 실제 AI 구현은 Antigravity 연결 후 사용할 수 있습니다.',
    });
    await delay(650, undefined, { signal });
    this.pane(id, {
      id: 'work-context',
      kind: 'context',
      title: '작업 기준',
      content:
        '## 이번 작업\n\n- 선택한 테마를 리허설 결과에 반영합니다.\n\n## 적용하는 기준\n\n- 고정 시나리오로 화면 흐름을 확인합니다. 입력한 프롬프트를 실제 구현하거나 실행하지 않습니다.\n- 실행 결과는 고정 Node 프로세스의 출력입니다. 출처: Pado 리허설 모드.\n\n## 아직 정하지 않은 내용\n\n- 결과에 사용할 테마는 참가자의 선택을 기다립니다.',
    });
    await delay(900, undefined, { signal });
    this.pane(id, {
      id: 'direction',
      kind: 'input',
      title: '방향을 골라 주세요',
      subtitle: '작업을 요청한 참가자의 입력 대기',
      content: choiceHtml,
    });
    this.store.waiting(id);
    const values = await new Promise<Record<string, string>>((resolveAnswer, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      const timeout = setTimeout(() => {
        this.answer = undefined;
        signal.removeEventListener('abort', abort);
        reject(new StageError('입력 대기 시간이 끝났습니다. 다시 시작해 주세요.'));
      }, 180_000);
      signal.addEventListener('abort', abort, { once: true });
      this.answer = {
        paneId: 'direction',
        resolve: (value) => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          resolveAnswer(value);
        },
      };
      signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
    });
    signal.throwIfAborted();
    this.emit(id, { type: 'pane.close', id: 'direction' });
    const theme = values.theme === 'Midnight' ? 'Midnight' : 'Ocean blue';
    this.pane(id, {
      id: 'work-context',
      kind: 'context',
      title: '작업 기준',
      content: `## 이번 작업\n\n- 선택한 테마를 리허설 결과에 반영합니다.\n\n## 적용하는 기준\n\n- 고정 시나리오로 화면 흐름을 확인합니다. 실제 AI 구현은 수행하지 않습니다.\n- 실행 결과는 고정 Node 프로세스의 출력입니다. 출처: Pado 리허설 모드.\n\n## 이번에 결정한 내용\n\n- **${theme}** 테마를 사용합니다. 출처: 참가자의 Input 선택.`,
    });
    this.emit(id, {
      type: 'agent.message',
      text: '선택을 받았어요. 실행 결과를 함께 볼 수 있도록 Terminal을 열겠습니다.',
    });
    const runId = randomUUID();
    this.store.terminal(
      {
        type: 'terminal.open',
        id: 'run',
        runId,
        title: '리허설 실행 확인',
        subtitle: 'node · 고정 리허설 스크립트',
        size: 2,
        command: ['node', 'scripts/rehearsal.mjs'],
        cwd: '.',
      },
      id,
    );
    const child = spawn(process.execPath, ['scripts/rehearsal.mjs'], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    this.child = child;
    child.stdout.on('data', (chunk) =>
      this.store.terminal(
        {
          type: 'terminal.append',
          id: 'run',
          runId,
          stream: 'stdout',
          text: chunk.toString().slice(0, 16384),
        },
        id,
      ),
    );
    child.stderr.on('data', (chunk) =>
      this.store.terminal(
        {
          type: 'terminal.append',
          id: 'run',
          runId,
          stream: 'stderr',
          text: chunk.toString().slice(0, 16384),
        },
        id,
      ),
    );
    await new Promise<void>((ok, fail) => {
      child.once('error', (error) => {
        this.store.terminal({ type: 'terminal.exit', id: 'run', runId, code: null }, id);
        fail(error);
      });
      child.once('close', (code) => {
        this.store.terminal({ type: 'terminal.exit', id: 'run', runId, code }, id);
        this.store.recordReviewRun(id, runId, code);
        if (code === 0) ok();
        else fail(new Error('Rehearsal failed'));
      });
    });
    signal.throwIfAborted();
    this.pane(id, {
      id: 'result',
      kind: 'file',
      title: 'stage-result.json',
      subtitle: '리허설 결과 · 읽기 전용',
      content: JSON.stringify(
        {
          project: 'Pado',
          theme,
          checks: ['shared stage', 'isolated input', 'live process output'],
          ready: true,
        },
        null,
        2,
      ),
      status: 'done',
    });
    this.pane(id, {
      id: 'work-context',
      kind: 'review',
      title: '작업 검토',
      size: 2,
      review: {
        summary: '선택한 테마로 고정 리허설을 마쳤습니다.',
        changes: [
          { title: '선택 반영', detail: `${theme} 테마를 리허설 결과에 반영했습니다.`, files: [] },
        ],
        checks: [
          {
            id: 'rehearsal',
            label: '고정 리허설 프로세스',
            status: 'unverified',
            runId,
            evidence:
              'scripts/rehearsal.mjs의 실제 종료 결과입니다. 출력 문구가 제품의 사용자 흐름을 검증한 것은 아닙니다.',
          },
        ],
        limitations: [
          '실제 AI 구현은 수행하지 않았습니다. 입력한 아이디어의 구현·검증 결과가 아닙니다.',
        ],
      },
    });
    this.emit(id, {
      type: 'agent.message',
      text: '리허설이 끝났습니다. 입력 → 실행 → 결과 확인까지 연결됐어요. 이제 다른 참가자가 손을 들 수 있습니다.',
    });
    this.store.finish(id);
  }
}
