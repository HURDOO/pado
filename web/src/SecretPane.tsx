import { useRef, useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import type { Pane } from '../../shared/protocol';

export function SecretPane({
  pane,
  allowed,
  onSubmit,
}: {
  pane: Pane;
  allowed: boolean;
  onSubmit: (value: string) => Promise<void>;
}) {
  const secret = pane.secret!;
  const done = pane.status === 'done';
  return (
    <div className="secret-content">
      <div className="secret-details">
        <div className="secret-heading">
          <LockKeyhole size={20} />
          <span>실행 환경 설정</span>
        </div>
        <h2>{secret.name}</h2>
        {secret.description && <p>{secret.description}</p>}
        <p className="artifact-muted">
          값은 대화에 보내지 않고 이 프로젝트에 저장합니다. 에이전트에는 변수 이름과 설정 여부만
          전달돼요.
        </p>
        <p className="secret-note">
          로컬 데모용 · 실행 코드에서는 값을 읽을 수 있어요.
        </p>
      </div>
      {allowed && pane.status === 'active' ? (
        <SecretEntry name={secret.name} onSubmit={onSubmit} />
      ) : (
        <div className="secret-status" role="status">
          {done ? <Check size={18} /> : <LockKeyhole size={18} />}
          <span>
            {done
              ? '설정 완료 · 다음 실행부터 사용할 수 있어요'
              : '요청자의 실행 환경 설정을 기다리고 있어요'}
          </span>
        </div>
      )}
    </div>
  );
}

function SecretEntry({
  name,
  onSubmit,
}: {
  name: string;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  return (
    <form
      className="secret-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!value || pending.current) return;
        pending.current = true;
        setSending(true);
        setError('');
        try {
          await onSubmit(value);
          setValue('');
        } catch (error) {
          setError((error as Error).message);
        } finally {
          pending.current = false;
          setSending(false);
        }
      }}
    >
      <label className="secret-field">
        <span>시크릿 값</span>
        <input
          type="password"
          aria-label={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={8000}
          required
          disabled={sending}
          placeholder="키 또는 비밀번호 입력"
        />
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" type="submit" disabled={!value || sending}>
        {sending ? '저장 중…' : '저장하고 계속'}
      </button>
    </form>
  );
}
