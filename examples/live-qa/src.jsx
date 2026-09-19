import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [questions, setQuestions] = useState([]);
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('');
  const [filter, setFilter] = useState('open');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const response = await fetch('/api/questions');
    if (!response.ok) throw new Error('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    setQuestions((await response.json()).questions);
  };
  useEffect(() => {
    let alive = true;
    const poll = async () => { try { if (alive) await refresh(); } catch (error) { if (alive) setError(error.message); } };
    void poll(); const timer = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const act = async (path, body) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      await refresh(); return true;
    } catch (error) { setError(error.message); return false; }
    finally { setBusy(false); }
  };
  const open = questions.filter(q => !q.done).length;
  const shown = questions.filter(q => filter === 'all' || (filter === 'open' ? !q.done : q.done));
  return <main>
    <header><div className="eyebrow"><i/> LIVE · 모두의 질문이 모이는 곳</div><h1>모임 질문 보드</h1><p>궁금한 점을 남기고, 함께 듣고 싶은 질문에 공감해 주세요.</p><div className="stats"><span>답변 대기 <b>{open}</b></span><span>해결한 질문 <b>{questions.length - open}</b></span><span className="database">서버에 저장 · 함께 공유</span></div></header>
    <section className="compose" aria-label="질문 작성"><form onSubmit={async e => { e.preventDefault(); if (await act('/api/questions', { text, author })) setText(''); }}>
      <label htmlFor="question">어떤 점이 궁금한가요?</label><textarea id="question" value={text} onChange={e => setText(e.target.value)} required maxLength={280} placeholder="예: 오늘 만든 앱을 다음 모임에서도 이어서 쓸 수 있나요?" rows={3}/>
      <div className="form-bottom"><input aria-label="이름 (선택)" value={author} onChange={e => setAuthor(e.target.value)} maxLength={24} placeholder="이름 (선택)"/><small>{text.length}/280</small><button disabled={busy || !text.trim()}>질문 올리기 <span>↗</span></button></div>
    </form></section>
    {error && <p role="alert" className="error">{error}</p>}
    <nav aria-label="질문 필터">{[['open','답변 대기'],['done','해결됨'],['all','전체']].map(([key,label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}<small>공감 많은 순 · 1초마다 동기화</small></nav>
    <section className="questions" aria-label="질문 목록">{shown.length ? shown.map(q => <article key={q.id} className={q.done ? 'resolved' : ''}><button className="vote" aria-label={`공감 ${q.votes}`} aria-pressed={!!q.voted} disabled={busy || !!q.voted} onClick={() => act(`/api/questions/${q.id}/vote`)}><span>↑</span><b>{q.votes}</b></button><div className="question-body"><p>{q.text}</p><div className="meta"><span>{q.author}</span><span>{q.done ? '✓ 함께 해결했어요' : '답변을 기다리고 있어요'}</span></div></div>{!q.done && <button className="resolve" disabled={busy} onClick={() => act(`/api/questions/${q.id}/resolve`)}>해결 표시</button>}</article>) : <div className="empty"><span>✳</span><h2>{filter === 'done' ? '해결한 질문이 여기에 모여요' : '첫 질문으로 대화를 열어 주세요'}</h2><p>다른 참가자가 올린 질문도 이 화면에 함께 나타납니다.</p></div>}</section>
    <footer>참가자 모두가 질문·공감·해결 표시를 함께 관리하는 모임용 보드입니다.<br/>React + Node API + SQLite · 새로고침하거나 서버를 다시 켜도 질문은 남아요.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
