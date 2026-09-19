import type { Pane } from '../../shared/protocol';
import { Markdown } from './Markdown';

export function ContextPane({ pane }: { pane: Pane }) {
  const context = pane.workContext;
  const state = context?.state ?? 'interrupted';
  return (
    <div className="context-content">
      <div className="context-meta">
        <span className={`context-state context-${state}`}>
          {state === 'working'
            ? '작업 중 · 적용하는 기준'
            : state === 'interrupted'
              ? '작업 중단 · 마지막 기준'
              : '작업 종료 · Review 미제출'}
        </span>
        {context && (
          <time dateTime={new Date(context.updatedAt).toISOString()}>
            {new Date(context.updatedAt).toLocaleTimeString('ko-KR', {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            갱신
          </time>
        )}
      </div>
      <Markdown text={pane.content} />
      <p className="context-note">
        {state === 'working'
          ? '해석이 다르면 Agent에 알려 주세요. 변경·검증 결과는 작업 후 Review로 이어집니다.'
          : state === 'interrupted'
            ? '작업이 끝까지 완료되지 않았습니다. 이 기준의 구현 여부는 확인되지 않았습니다.'
            : '검토 보고가 제출되지 않았습니다. 작업 종료가 구현·검증 완료를 뜻하지는 않습니다.'}
      </p>
    </div>
  );
}

export function ReviewContext({ context }: { context: NonNullable<Pane['workContext']> }) {
  return (
    <section className="review-context" aria-label="작업 기준과 검토">
      <p className="context-transition">
        작업 기준 <span aria-hidden="true">→</span> Review
      </p>
      {context.state !== 'finished' && (
        <p className="context-note">
          {context.state === 'working'
            ? '작업이 진행 중입니다. 현재까지 제출된 검토 보고입니다.'
            : '작업이 중단되었습니다. 중단 전에 제출된 검토 보고입니다.'}
        </p>
      )}
      <details>
        <summary>이 작업의 기준 다시 보기</summary>
        <Markdown text={context.content} />
        <p className="context-note">
          에이전트가 공개한 요청·합의·가정입니다. 구현 여부는 아래 검증 결과를 확인하세요.
        </p>
      </details>
    </section>
  );
}
