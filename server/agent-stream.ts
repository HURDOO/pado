import { StringDecoder } from 'node:string_decoder';
import type { AgentActivity } from '../shared/protocol.ts';
import { AgentProgress } from './agent-progress.ts';

export type AgentFailure = 'authentication' | 'permission' | 'timeout' | 'protocol' | 'execution';
export class AgentRunError extends Error {
  constructor(public kind: AgentFailure) {
    super(
      {
        authentication:
          '전용 Antigravity 환경에 Google 로그인이 필요합니다. 진행자가 로그인 후 다시 시작해 주세요.',
        permission:
          'Antigravity 도구 실행 권한을 확인해야 합니다. 진행자가 전용 환경의 권한 설정을 확인해 주세요.',
        timeout:
          'Antigravity 작업 시간이 초과되어 중단했습니다. 요청 범위를 줄여 다시 시도해 주세요.',
        protocol: 'Antigravity 응답 형식을 처리하지 못했습니다. 진행자가 CLI 상태를 확인해 주세요.',
        execution: 'Antigravity 작업을 완료하지 못했습니다. 진행자가 runner 상태를 확인해 주세요.',
      }[kind],
    );
  }
}

export function classifyAgentError(text: string): AgentFailure {
  if (
    /authentication required|not authenticated|please.*log.?in|sign.?in required|GEMINI_API_KEY.*not set/i.test(
      text,
    )
  )
    return 'authentication';
  if (/permission|approval required|requires approval|not allowed/i.test(text)) return 'permission';
  if (/timed?\s*out|timeout/i.test(text)) return 'timeout';
  return 'execution';
}

/** Consume only documented CLI envelopes. Raw tool events/diagnostics stay private. */
export class AgentStream {
  private progress = new AgentProgress();
  constructor(private onActivity?: (activity: AgentActivity) => void) {}
  private decoder = new StringDecoder('utf8');
  private line = '';
  private diagnosticTail = '';
  private diagnosticDecoder = new StringDecoder('utf8');
  failure?: AgentFailure;
  conversationId?: string;
  result?: { success: boolean; response: string };

  push(chunk: Buffer | string) {
    this.line += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    if (this.line.length > 2_000_000) throw new AgentRunError('protocol');
    let newline;
    while ((newline = this.line.indexOf('\n')) >= 0) {
      this.parse(this.line.slice(0, newline));
      this.line = this.line.slice(newline + 1);
    }
  }
  diagnostic(chunk: Buffer | string) {
    this.diagnosticTail = (
      this.diagnosticTail +
      (typeof chunk === 'string' ? chunk : this.diagnosticDecoder.write(chunk))
    ).slice(-8000);
    const kind = classifyAgentError(this.diagnosticTail);
    if (kind !== 'execution') this.failure = kind;
  }
  end() {
    this.line += this.decoder.end();
    if (this.line.trim()) this.parse(this.line);
    this.line = '';
  }
  private parse(line: string) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      this.diagnostic(line);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.event === 'step_update' && this.onActivity) {
      const activity = this.progress.read(value.step_update);
      if (activity) this.onActivity(activity);
    }
    if (value.event !== 'init' && value.event !== 'result') return;
    const payload = value.event === 'result' ? value.result : value;
    if (!payload || typeof payload !== 'object') return;
    const id = payload.conversation_id;
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) this.conversationId = id;
    if (value.event !== 'result') return;
    if (this.result) throw new AgentRunError('protocol');
    const success = payload.status === 'SUCCESS';
    this.result = {
      success,
      response: typeof payload.response === 'string' ? payload.response.slice(0, 12_000) : '',
    };
    if (!success)
      this.failure ??= classifyAgentError(typeof payload.error === 'string' ? payload.error : '');
  }
  completed(exitCode: number | null) {
    // Headless CLI soft-denials can end with SUCCESS + exit 0 and no work done.
    // Treat the private diagnostic as failure rather than announcing completion.
    if (this.failure === 'authentication' || this.failure === 'permission')
      throw new AgentRunError(this.failure);
    if (!this.result || !this.result.success || exitCode !== 0)
      throw new AgentRunError(this.failure ?? 'execution');
    return this.result;
  }
}
