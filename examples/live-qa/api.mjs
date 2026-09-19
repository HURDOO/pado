import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// This workshop board is intentionally collaborative, not a moderator/admin system.
export function createApi(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, text TEXT NOT NULL, author TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS votes (question TEXT NOT NULL, voter TEXT NOT NULL, PRIMARY KEY(question,voter));`);
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const body = async req => {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('질문이 너무 깁니다.'); }
    return JSON.parse(text);
  };
  const handle = async (req, res) => {
    try {
      const path = new URL(req.url, 'http://app').pathname;
      let voter = req.headers.cookie?.match(/(?:^|;\s*)qa_voter=([a-f0-9-]{36})(?:;|$)/)?.[1];
      if (!voter) { voter = randomUUID(); res.setHeader('Set-Cookie', `qa_voter=${voter}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`); }
      if (path === '/api/questions' && req.method === 'GET') {
        const questions = db.prepare(`SELECT q.*, (SELECT count(*) FROM votes v WHERE v.question=q.id) votes,
          EXISTS(SELECT 1 FROM votes v WHERE v.question=q.id AND v.voter=?) voted
          FROM questions q ORDER BY done ASC, votes DESC, created DESC LIMIT 500`).all(voter);
        return json(res, 200, { questions });
      }
      if (path === '/api/questions' && req.method === 'POST') {
        const value = await body(req);
        const text = typeof value.text === 'string' ? value.text.trim() : '';
        const author = typeof value.author === 'string' ? value.author.trim() : '';
        if (!text || text.length > 280 || author.length > 24) return json(res, 400, { error: '질문은 1~280자, 이름은 24자 이내로 입력해 주세요.' });
        if (db.prepare('SELECT count(*) n FROM questions').get().n >= 500) return json(res, 409, { error: '이 모임의 질문 한도에 도달했어요.' });
        const id = randomUUID();
        db.prepare('INSERT INTO questions(id,text,author,created) VALUES(?,?,?,?)').run(id, text, author || '익명', Date.now());
        return json(res, 201, { id });
      }
      const action = path.match(/^\/api\/questions\/([a-f0-9-]{36})\/(vote|resolve)$/);
      if (action && req.method === 'POST') {
        if (!db.prepare('SELECT id FROM questions WHERE id=?').get(action[1])) return json(res, 404, { error: '질문을 찾을 수 없어요.' });
        if (action[2] === 'vote') db.prepare('INSERT OR IGNORE INTO votes(question,voter) VALUES(?,?)').run(action[1], voter);
        else db.prepare('UPDATE questions SET done=1 WHERE id=?').run(action[1]);
        return json(res, 200, { ok: true });
      }
      json(res, 404, { error: '요청을 찾을 수 없어요.' });
    } catch { json(res, 400, { error: '입력을 확인하고 다시 시도해 주세요.' }); }
  };
  return { handle, close: () => db.close() };
}
