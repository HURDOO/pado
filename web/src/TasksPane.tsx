import { taskLabels, taskStates, taskSummary } from '../../shared/tasks';
import { Markdown } from './Markdown';

export function TasksPane({ content }: { content: string }) {
  const { counts, total } = taskSummary(content);
  return (
    <div className="tasks-content">
      <section className="tasks-overview" aria-label="작업 현황">
        <div className="tasks-overview-heading">
          <h2>작업 현황</h2>
          <span>
            총 <strong>{total}</strong>개
          </span>
        </div>
        <div className="tasks-summary" aria-label="작업 상태 요약" role="list">
          {taskStates.map((state) => (
            <span
              key={state}
              className={`task-count task-${state}`}
              role="listitem"
              aria-label={`${taskLabels[state]} ${counts[state]}개`}
            >
              <span>{taskLabels[state]}</span>
              <strong>{counts[state]}</strong>
            </span>
          ))}
        </div>
      </section>
      <p className="tasks-note">공개된 작업 목록 · 상태 변경은 에이전트에게 요청하세요.</p>
      {counts.next === 0 && (
        <p className="tasks-next-note">선택된 다음 작업 없음 · 대기 순서가 실행 순서는 아닙니다.</p>
      )}
      {counts.next > 1 && (
        <p className="tasks-warning" role="alert">
          다음 작업이 여러 개 지정되어 있어요. 하나를 정해 주세요.
        </p>
      )}
      {total === 0 && <p className="tasks-next-note">아직 표시할 작업 항목이 없습니다.</p>}
      <Markdown text={content} tasks />
    </div>
  );
}
