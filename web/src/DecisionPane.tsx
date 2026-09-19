import { useRef, useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import type { Pane } from '../../shared/protocol';
import { sandboxDocument } from './sandbox';

export function DecisionPane({
  pane,
  allowed,
  onSubmit,
}: {
  pane: Pane;
  allowed: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const decision = pane.decision!;
  const [selection, setSelection] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const done = pane.status !== 'active';
  const selected = pane.answer?.optionId ?? selection;
  return (
    <form
      className="decision-content"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!allowed || done || !selection || pending.current) return;
        pending.current = true;
        setSending(true);
        setError('');
        try {
          await onSubmit({ optionId: selection, note });
        } catch (error) {
          setError((error as Error).message);
        } finally {
          pending.current = false;
          setSending(false);
        }
      }}
    >
      <div className="decision-scroll">
        <p className="artifact-eyebrow">COMPARE & CHOOSE</p>
        <h2>{decision.question}</h2>
        {decision.context && <p className="artifact-muted">{decision.context}</p>}
        <p className="artifact-disclaimer">
          시각적 제안 · 아직 적용되지 않았어요. 선택 후 확인하면 에이전트가 이어서 작업합니다.
        </p>
        <fieldset disabled={!allowed || done || sending}>
          <legend className="sr-only">비교안 선택</legend>
          <div className="decision-options">
            {decision.options.map((option, index) => (
              <article
                className={`decision-option ${selected === option.id ? 'selected' : ''}`}
                key={option.id}
              >
                <div className="decision-preview">
                  <iframe
                    title={`${option.title} 미리보기`}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    tabIndex={-1}
                    srcDoc={sandboxDocument(
                      `<style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:12px;background:#10151e;color:#edf3fc;font:14px/1.5 system-ui;overflow-wrap:anywhere}img{max-width:100%}</style>${option.preview}`,
                    )}
                  />
                </div>
                <label className="decision-option-label">
                  <input
                    type="radio"
                    name={`decision-${pane.id}`}
                    value={option.id}
                    checked={selected === option.id}
                    onChange={() => setSelection(option.id)}
                  />
                  <span>
                    <small>OPTION {String(index + 1).padStart(2, '0')}</small>
                    <strong>{option.title}</strong>
                  </span>
                  {selected === option.id && <Check size={16} aria-hidden="true" />}
                </label>
                <p>{option.summary}</p>
                <p className="decision-tradeoff">
                  <b>고려할 점</b> {option.tradeoff}
                </p>
              </article>
            ))}
          </div>
        </fieldset>
        {allowed && !done && (
          <label className="decision-note">
            추가 요청 <span>선택 사항 · 모두에게 공개</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              rows={2}
              disabled={sending}
              placeholder="선택한 안에서 조정할 점이 있나요? 비밀번호나 API 키는 넣지 마세요."
            />
          </label>
        )}
        {pane.answer?.note && <p className="artifact-muted">추가 요청: {pane.answer.note}</p>}
      </div>
      <div className="decision-footer">
        {selected && (
          <p className="decision-selected">
            선택한 안: {decision.options.find((option) => option.id === selected)?.title}
          </p>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {!allowed || done ? (
          <p role="status">
            <LockKeyhole size={14} />
            {done ? '선택을 전달했습니다' : '발언자의 선택을 기다리고 있어요'}
          </p>
        ) : (
          <button className="primary" type="submit" disabled={!selection || sending}>
            {sending ? '선택 전달 중…' : '이 안으로 진행'}
          </button>
        )}
      </div>
    </form>
  );
}
