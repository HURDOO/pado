import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Board } from '../api.ts';
import './style.css';

const categories = ['기술', '운영', '규칙'];
async function request(path: string, value?: unknown) {
  const res = await fetch(
    `/api/${path}`,
    value === undefined
      ? { signal: AbortSignal.timeout(8000) }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
          signal: AbortSignal.timeout(8000),
        },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '요청에 실패했어요.');
  return data;
}
function App() {
  const [board, setBoard] = useState<Board>({ teams: [], questions: [] });
  const [loaded, setLoaded] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [tab, setTab] = useState<'question' | 'team'>('question');
  const [teamId, setTeamId] = useState('');
  const [filter, setFilter] = useState('전체');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latest = useRef(0);
  async function refresh() {
    const version = ++latest.current;
    try {
      const data: Board = await request('board');
      if (version === latest.current) {
        setBoard(data);
        setLoaded(true);
        setConnectionError(false);
      }
    } catch {
      if (version === latest.current) setConnectionError(true);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      clearInterval(timer);
      latest.current++;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const value = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request(tab === 'team' ? 'teams' : 'questions', value);
      form.reset();
      await refresh();
      if (tab === 'team') {
        setTeamId(result.id);
        setTab('question');
        setNotice('팀을 등록했어요. 이어서 질문을 남길 수 있어요.');
      } else {
        setFilter('전체');
        setNotice('질문을 접수했어요. 아래 질문 목록에서 확인하세요.');
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name !== 'TimeoutError'
          ? cause.message
          : '연결을 확인해 주세요. 접수 여부를 목록에서 확인한 뒤 다시 시도하세요.',
      );
    } finally {
      setBusy(false);
    }
  }
  const questions = board.questions.filter((q) => filter === '전체' || q.category === filter);
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="해커톤 데스크 홈">
          <span className="mark">H.</span> HACKATHON DESK
        </a>
        <span className="badge">교체 가능한 시연 베이스</span>
      </header>
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">함께 만드는 동안, 필요한 연결</p>
            <h1>
              팀의 시작부터
              <br />
              막히는 순간까지.
            </h1>
            <p className="intro">
              만들고 있는 것을 소개하고, 궁금한 것을 남겨 주세요.
              <br className="wide" /> 작은 질문들이 모여 더 좋은 해커톤을 만듭니다.
            </p>
          </div>
          <div className="summary">
            <div>
              <strong>{board.teams.length.toString().padStart(2, '0')}</strong>
              <span>등록 팀</span>
            </div>
            <div>
              <strong>{board.questions.length.toString().padStart(2, '0')}</strong>
              <span>접수된 질문</span>
            </div>
            <p>
              예시 포함 ·{' '}
              {connectionError ? '연결 확인 필요' : loaded ? '3초마다 새로 확인' : '불러오는 중'}
            </p>
          </div>
        </section>
        <p className="scope">
          <span aria-hidden="true">ⓘ</span> 내부망 공동 시연용이에요. 모든 질문이 공개되며, 팀
          선택은 로그인이 아닙니다. 개인정보나 비밀은 남기지 마세요.
        </p>
        {connectionError && (
          <div role="alert" className="error">
            목록을 갱신하지 못했어요. 마지막으로 받은 목록을 표시합니다.{' '}
            <button onClick={() => void refresh()}>다시 확인</button>
          </div>
        )}
        <div className="columns">
          <aside className="composer">
            <div className="tabs" aria-label="등록할 항목">
              <button
                type="button"
                aria-pressed={tab === 'question'}
                disabled={busy}
                onClick={() => {
                  setTab('question');
                  setError('');
                }}
              >
                질문 접수
              </button>
              <button
                type="button"
                aria-pressed={tab === 'team'}
                disabled={busy}
                onClick={() => {
                  setTab('team');
                  setError('');
                }}
              >
                팀 등록
              </button>
            </div>
            <h2>{tab === 'team' ? '어떤 팀인가요?' : '어디서 막히셨나요?'}</h2>
            <p className="muted">
              {tab === 'team'
                ? '팀 이름과 프로젝트 한 줄이면 충분해요.'
                : '먼저 팀을 등록한 다음 질문을 남겨 주세요.'}
            </p>
            <div role="status" className={notice ? 'notice' : ''}>
              {notice}
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <form onSubmit={submit} key={tab}>
              <fieldset disabled={busy}>
                {tab === 'team' ? (
                  <>
                    <label>
                      팀 이름
                      <input
                        name="name"
                        maxLength={40}
                        required
                        placeholder="예: 새벽 세 시"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      프로젝트 한 줄 소개
                      <textarea
                        name="pitch"
                        maxLength={160}
                        required
                        rows={3}
                        placeholder="누구의 어떤 문제를 해결하고 있나요?"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      질문하는 팀
                      <select
                        name="teamId"
                        value={teamId}
                        onChange={(e) => setTeamId(e.target.value)}
                        required
                      >
                        <option value="">팀을 선택해 주세요</option>
                        {board.teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {loaded && board.teams.length === 0 && (
                      <p className="muted">
                        아직 등록된 팀이 없어요. 위의 ‘팀 등록’에서 시작하세요.
                      </p>
                    )}
                    <label>
                      질문 분야
                      <select name="category" defaultValue="기술">
                        {categories.map((category) => (
                          <option key={category}>{category}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      질문 제목
                      <input
                        name="title"
                        maxLength={100}
                        required
                        placeholder="어떤 도움이 필요한가요?"
                      />
                    </label>
                    <label>
                      자세한 내용
                      <textarea
                        name="body"
                        maxLength={1000}
                        required
                        rows={4}
                        placeholder="현재 상황과 시도한 방법을 적어 주세요."
                      />
                    </label>
                  </>
                )}
                <button
                  className="primary"
                  type="submit"
                  disabled={!loaded || (tab === 'question' && !board.teams.length)}
                >
                  {busy ? '저장 중…' : tab === 'team' ? '팀 등록하기' : '질문 접수하기'}
                  <span aria-hidden="true">↗</span>
                </button>
              </fieldset>
            </form>
            <p className="form-note">
              질문 접수까지만 제공해요.
              <br />
              운영자 답변과 공개 정책은 다음 작업입니다.
            </p>
          </aside>
          <section className="board" aria-labelledby="question-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">QUESTION BOARD</p>
                <h2 id="question-heading">
                  함께 보는 질문 <span>{board.questions.length}</span>
                </h2>
              </div>
              <span className="shared">
                <i /> 공동 열람
              </span>
            </div>
            <div className="filters" aria-label="질문 분야 필터">
              {['전체', ...categories].map((category) => (
                <button
                  key={category}
                  aria-pressed={filter === category}
                  onClick={() => setFilter(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="questions">
              {!loaded ? (
                <p className="empty">질문 목록을 불러오고 있어요.</p>
              ) : !questions.length ? (
                <div className="empty">
                  <strong>
                    {filter === '전체'
                      ? '첫 번째 질문을 기다리고 있어요.'
                      : '이 분야의 질문은 아직 없어요.'}
                  </strong>
                  <p>막히는 부분을 함께 풀어 볼까요?</p>
                </div>
              ) : (
                questions.map((question) => (
                  <article key={question.id} className="question">
                    <div className="question-meta">
                      <span className={`category cat-${categories.indexOf(question.category)}`}>
                        {question.category}
                      </span>
                      <span>접수됨</span>
                      {!!question.sample && <span className="sample">가상 예시</span>}
                    </div>
                    <h3>{question.title}</h3>
                    <p className="question-body">{question.body}</p>
                    <footer>
                      <span>{question.teamName}</span>
                      <time dateTime={new Date(question.created).toISOString()}>
                        {new Intl.DateTimeFormat('ko-KR', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(question.created)}
                      </time>
                    </footer>
                  </article>
                ))
              )}
            </div>
            <section className="teams" aria-labelledby="team-heading">
              <h2 id="team-heading">
                만들고 있는 팀들 <span>{board.teams.length}</span>
              </h2>
              {loaded && !board.teams.length && <p className="muted">첫 팀을 소개해 주세요.</p>}
              <div className="team-grid">
                {board.teams.map((team, index) => (
                  <article className="team" key={team.id}>
                    <span className="team-number">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>
                        {team.name} {!!team.sample && <small>가상 예시</small>}
                      </h3>
                      <p>{team.pitch}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>
        </div>
        <footer className="page-footer">
          <span>HACKATHON DESK / WORK IN PROGRESS</span>
          <span>작게 시작하고, 함께 발전시키기.</span>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
