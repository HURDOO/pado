import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi, type Board } from './api.ts';

async function fixture(file = ':memory:') {
  const api = createApi(file);
  const server = createServer(api.handle);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = async (path: string, value?: unknown) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/${path}`,
      value === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value),
          },
    );
    return { status: response.status, data: await response.json() };
  };
  return {
    request,
    api,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      api.close();
    },
  };
}
test('team → question → shared readback, Unicode and literal HTML stay data', async () => {
  const f = await fixture();
  try {
    const team = await f.request('teams', {
      name: ' 작은 팀 ',
      pitch: '<script>alert(1)</script>',
    });
    assert.equal(team.status, 201);
    assert.equal(
      (
        await f.request('questions', {
          teamId: team.data.id,
          category: '기술',
          title: '도와주세요',
          body: '한글 질문입니다.',
        })
      ).status,
      201,
    );
    const board: Board = (await f.request('board')).data;
    assert.equal(board.teams[0].name, '작은 팀');
    assert.equal(board.teams[0].pitch, '<script>alert(1)</script>');
    assert.equal(board.questions[0].teamName, '작은 팀');
    assert.equal(board.questions[0].sample, 0);
  } finally {
    await f.close();
  }
});
test('duplicate normalized team names return 409 without changing previous data', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('teams', { name: 'Ａ Team', pitch: 'original' })).status, 201);
    assert.equal(
      (await f.request('teams', { name: ' a   team ', pitch: 'replacement' })).status,
      409,
    );
    assert.equal((await f.request('board')).data.teams[0].pitch, 'original');
  } finally {
    await f.close();
  }
});
test('reject empty, malformed, oversized, missing team and invalid category', async () => {
  const f = await fixture();
  try {
    for (const body of [
      null,
      [],
      { name: '  ', pitch: 'x' },
      { name: 'x'.repeat(41), pitch: 'x' },
      { name: 'ok', pitch: '' },
    ])
      assert.equal((await f.request('teams', body)).status, 400);
    const team = await f.request('teams', { name: 'valid', pitch: 'valid' });
    const base = { teamId: team.data.id, category: '기술', title: 'valid', body: 'valid' };
    for (const patch of [
      { teamId: 'absent' },
      { category: 'unknown' },
      { body: '' },
      { title: 'x'.repeat(101) },
      { body: 'x'.repeat(1001) },
    ])
      assert.equal((await f.request('questions', { ...base, ...patch })).status, 400);
    assert.deepEqual((await f.request('board')).data.questions, []);
    assert.equal((await f.request('missing')).status, 404);
  } finally {
    await f.close();
  }
});
test('SQLite survives close/reopen; seed is explicit and idempotent', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'desk-test-')), 'desk.sqlite');
  const first = await fixture(file);
  const team = await first.request('teams', { name: 'persistent', pitch: 'keep' });
  await first.request('questions', {
    teamId: team.data.id,
    category: '운영',
    title: 'keep question',
    body: 'keep body',
  });
  await first.close();
  const second = await fixture(file);
  try {
    assert.equal((await second.request('board')).data.questions[0].title, 'keep question');
    second.api.seed();
    second.api.seed();
    const board: Board = (await second.request('board')).data;
    assert.equal(board.teams.length, 4);
    assert.equal(board.questions.length, 4);
    assert.equal(board.teams.filter((team) => team.sample).length, 3);
    assert.equal(board.teams.find((team) => team.name === 'persistent')?.pitch, 'keep');
  } finally {
    await second.close();
  }
});
