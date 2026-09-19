import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const categories = ['기술', '운영', '규칙'] as const;
export type Team = { id: string; name: string; pitch: string; created: number; sample: number };
export type Question = {
  id: string;
  teamId: string;
  teamName: string;
  category: string;
  title: string;
  body: string;
  created: number;
  sample: number;
};
export type Board = { teams: Team[]; questions: Question[] };
const clean = (value: unknown, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new InputError('입력 길이와 필수 항목을 확인해 주세요.', 400);
  return value.trim();
};
class InputError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new InputError('JSON 형식으로 요청해 주세요.', 415);
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new InputError('입력이 너무 큽니다.', 413);
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new InputError('입력 형식을 확인해 주세요.', 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InputError('입력 형식을 확인해 주세요.', 400);
  return value;
}
export function createApi(file: string) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, nameKey TEXT UNIQUE NOT NULL, pitch TEXT NOT NULL, created INTEGER NOT NULL, sample INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, teamId TEXT NOT NULL REFERENCES teams(id), category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, sample INTEGER NOT NULL DEFAULT 0);`);
  const board = (): Board => ({
    teams: db
      .prepare('SELECT id,name,pitch,created,sample FROM teams ORDER BY created,id')
      .all() as Team[],
    questions: db
      .prepare(
        'SELECT q.*, t.name teamName FROM questions q JOIN teams t ON q.teamId=t.id ORDER BY q.created DESC,q.id DESC',
      )
      .all() as Question[],
  });
  const json = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = new URL(req.url || '/', 'http://app').pathname;
      if (path === '/api/board' && req.method === 'GET') return json(res, 200, board());
      if (path === '/api/teams' && req.method === 'POST') {
        const value = await readBody(req);
        const name = clean(value.name, 40).replace(/\s+/g, ' ');
        const pitch = clean(value.pitch, 160);
        const key = name.normalize('NFKC').toLowerCase();
        if (db.prepare('SELECT id FROM teams WHERE nameKey=?').get(key))
          throw new InputError(
            '이미 등록된 팀 이름이에요. 기존 팀을 선택하거나 다른 이름을 써 주세요.',
            409,
          );
        if (Number(db.prepare('SELECT count(*) n FROM teams').get()!.n) >= 200)
          throw new InputError('시연 팀 등록 한도에 도달했어요.', 409);
        const id = randomUUID();
        db.prepare('INSERT INTO teams(id,name,nameKey,pitch,created) VALUES(?,?,?,?,?)').run(
          id,
          name,
          key,
          pitch,
          Date.now(),
        );
        return json(res, 201, { id });
      }
      if (path === '/api/questions' && req.method === 'POST') {
        const value = await readBody(req);
        const teamId = clean(value.teamId, 60);
        const category = clean(value.category, 10);
        const title = clean(value.title, 100);
        const body = clean(value.body, 1000);
        if (!(categories as readonly string[]).includes(category))
          throw new InputError('질문 분야를 선택해 주세요.', 400);
        if (!db.prepare('SELECT id FROM teams WHERE id=?').get(teamId))
          throw new InputError('먼저 팀을 등록하거나 목록에서 팀을 선택해 주세요.', 400);
        if (Number(db.prepare('SELECT count(*) n FROM questions').get()!.n) >= 1000)
          throw new InputError('시연 질문 한도에 도달했어요.', 409);
        const id = randomUUID();
        db.prepare(
          'INSERT INTO questions(id,teamId,category,title,body,created) VALUES(?,?,?,?,?,?)',
        ).run(id, teamId, category, title, body, Date.now());
        return json(res, 201, { id });
      }
      return json(res, 404, { error: '요청을 찾을 수 없어요.' });
    } catch (error) {
      const expected = error instanceof InputError;
      if (!expected) console.error('DESK_API_ERROR');
      return json(res, expected ? error.status : 500, {
        error: expected ? error.message : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
      });
    }
  };
  const seed = () => {
    const samples = [
      [
        '작은숲 (가상)',
        '동네의 남는 식재료를 연결하는 지도',
        '기술',
        '지도 API 없이 시연할 방법이 있을까요?',
        '외부 키 없이 준비할 수 있는 지도 대안을 찾고 있어요.',
      ],
      [
        '밤샘클럽 (가상)',
        '팀원의 집중 시간을 맞추는 협업 타이머',
        '운영',
        '중간 발표는 어떤 순서로 진행하나요?',
        '발표 순서와 준비 시간을 어디서 확인하면 될까요?',
      ],
      [
        '파란점 (가상)',
        '처음 온 참가자를 위한 행사 길잡이',
        '규칙',
        '기존 오픈소스 활용 범위를 알고 싶어요',
        '사용한 라이브러리와 기존 코드의 출처를 어떤 형식으로 제출하면 될까요?',
      ],
    ];
    db.exec('BEGIN');
    try {
      samples.forEach(([name, pitch, category, title, body], index) => {
        const id = `demo-team-${index + 1}`;
        db.prepare(
          'INSERT OR IGNORE INTO teams(id,name,nameKey,pitch,created,sample) VALUES(?,?,?,?,?,1)',
        ).run(
          id,
          name,
          name.normalize('NFKC').toLowerCase(),
          pitch,
          Date.now() - (3 - index) * 60000,
        );
        if (db.prepare('SELECT id FROM teams WHERE id=? AND sample=1').get(id))
          db.prepare(
            'INSERT OR IGNORE INTO questions(id,teamId,category,title,body,created,sample) VALUES(?,?,?,?,?,?,1)',
          ).run(
            `demo-question-${index + 1}`,
            id,
            category,
            title,
            body,
            Date.now() - (3 - index) * 60000,
          );
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return { handle, seed, close: () => db.close() };
}
