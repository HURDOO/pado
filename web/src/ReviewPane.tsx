import { useState } from 'react';
import { CheckCircle2, CircleHelp, XCircle, ChevronRight } from 'lucide-react';
import type { Pane } from '../../shared/protocol';
import { BrowserPane } from './BrowserPane';
import { ReviewContext } from './ContextPane';

const labels = { passed: '통과', failed: '실패', unverified: '미검증' };
const icons = { passed: CheckCircle2, failed: XCircle, unverified: CircleHelp };
export function ReviewPane({
  pane,
  projectId,
  readOnly = false,
}: {
  pane: Pane;
  projectId: string;
  readOnly?: boolean;
}) {
  const review = pane.review!;
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <div className="review-content">
      {pane.workContext && <ReviewContext context={pane.workContext} />}
      <p className="artifact-eyebrow">CHANGES & VERIFICATION</p>
      <h2>{review.summary}</h2>
      <div className="review-counts" aria-label="검증 현황">
        {(['passed', 'failed', 'unverified'] as const).map((status) => (
          <span className={`check-${status}`} key={status}>
            {labels[status]}{' '}
            <b>{review.checks.filter((check) => check.status === status).length}</b>
          </span>
        ))}
      </div>
      <section className="review-section" aria-label="변경 사항">
        <h3>무엇이 바뀌었나요</h3>
        {review.changes.length === 0 ? (
          <p className="artifact-muted">보고된 변경 사항이 없습니다.</p>
        ) : (
          review.changes.map((change, index) => (
            <article className="review-change" key={index}>
              <strong>{change.title}</strong>
              <p>{change.detail}</p>
              {!!change.files.length && (
                <details>
                  <summary>관련 파일 {change.files.length}개</summary>
                  <ul>
                    {change.files.map((file, index) => (
                      <li key={index}>
                        <code>{file}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))
        )}
      </section>
      <section className="review-section" aria-label="검증 결과">
        <h3>어디까지 확인했나요</h3>
        <p className="artifact-disclaimer">
          실행 확인은 실제 명령의 종료 상태입니다. 세부 검증 범위와 수동 확인은 에이전트 보고로
          구분합니다.
        </p>
        {!review.checks.length && (
          <p className="artifact-muted">아직 보고된 검증이 없습니다. 통과로 간주하지 않습니다.</p>
        )}
        {review.checks.map((check) => {
          const Icon = icons[check.status];
          return (
            <article className={`review-check check-${check.status}`} key={check.id}>
              <div className="review-check-heading">
                <Icon size={17} />
                <strong>{check.label}</strong>
                <span>{labels[check.status]}</span>
              </div>
              <p className="review-provenance">
                {check.run
                  ? `실행 확인 · 종료 ${check.run.code ?? '불명'} · ${new Date(check.run.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
                  : check.runId
                    ? '실행 근거를 확인하지 못함'
                    : check.status === 'unverified'
                      ? '검증되지 않음'
                      : '에이전트 보고 · 자동 실행 근거 없음'}
              </p>
              {check.evidence && (
                <details>
                  <summary>검증 근거 / 확인 방법</summary>
                  <pre>{check.evidence}</pre>
                </details>
              )}
              {check.reproduction && (
                <>
                  <button
                    className="review-reproduce"
                    type="button"
                    aria-expanded={opened === check.id}
                    onClick={() => setOpened(opened === check.id ? null : check.id)}
                  >
                    <ChevronRight size={14} />
                    {opened === check.id ? '재현 화면 닫기' : '재현 화면 보기'}
                  </button>
                  {opened === check.id && (
                    <div className="review-reproduction">
                      <small>
                        {readOnly
                          ? '내 화면에서 열기 · 읽기 전용'
                          : '내 화면에서 열기 · 조작은 실제 앱 데이터에 반영될 수 있어요'}
                      </small>
                      <BrowserPane
                        projectId={projectId}
                        checkId={check.id}
                        readOnly={readOnly}
                        pane={{
                          id: pane.id,
                          title: `${check.label} 재현`,
                          kind: 'browser',
                          content: '',
                          subtitle: '',
                          status: 'active',
                          size: 2,
                          server: check.reproduction,
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}
      </section>
      <section className="review-section review-limitations" aria-label="남은 확인 사항">
        <h3>남은 확인 · 주의할 점</h3>
        {review.limitations.length ? (
          <ul>
            {review.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>추가 주의 사항이 보고되지 않았습니다. 모든 동작의 검증을 뜻하지는 않습니다.</p>
        )}
      </section>
    </div>
  );
}
