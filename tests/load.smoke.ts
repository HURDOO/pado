import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Snapshot } from '../shared/protocol.ts';

// Local production-build load check. No AI requests or external network access.
const origin = 'http://127.0.0.1:14737';
const password = randomBytes(24).toString('base64url');
const server = spawn('pnpm', ['exec', 'tsx', 'server/index.ts', '--production'], {
  env: {
    ...process.env,
    PADO_BIND_HOST: '127.0.0.1',
    PADO_PORT: '14737',
    PADO_ORIGIN: origin,
    PADO_RUNNER: 'rehearsal',
    PADO_ADMIN_PASSWORD: password,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let startupError = false;
let listening = false;
let streamFailed = false;
server.stdout.on('data', (chunk) => {
  if (chunk.toString().includes(`Pado → ${origin}`)) listening = true;
});
server.once('error', () => {
  startupError = true;
});
server.stderr.on('data', (chunk) => {
  if (chunk.toString().includes('EADDRINUSE')) startupError = true;
});
const clients: {
  cookie: string;
  snapshot?: Snapshot;
  controller: AbortController;
  reading?: Promise<void>;
}[] = [];
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (startupError || streamFailed || server.exitCode !== null)
      throw new Error('Dedicated load-test server could not start');
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function post(cookie: string, path: string, data: unknown = {}) {
  return fetch(`${origin}/api/${path}`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
try {
  await until(async () => {
    try {
      return listening && (await fetch(`${origin}/api/health`)).ok;
    } catch {
      return false;
    }
  }, 'server start');
  const entry = await fetch(origin);
  assert.equal(entry.status, 200);
  assert.equal(entry.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(entry.headers.get('x-frame-options'), 'DENY');
  assert.equal(entry.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(entry.headers.get('cache-control'), 'no-cache');
  const entryHtml = await entry.text();
  const asset = entryHtml.match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
  assert(asset, 'Production entry must reference the built application');
  const script = await fetch(origin + asset);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('cache-control') ?? '', /immutable/);
  for (const path of ['/.env', '/server/index.ts', '/agent/settings.json']) {
    const response = await fetch(origin + path);
    assert.equal(await response.text(), entryHtml, 'Private paths may only receive the SPA entry');
  }
  assert.equal((await fetch(origin + '/%2e%2e%2f.env')).status, 404);
  assert.equal(
    (
      await fetch(origin + '/api/join', {
        method: 'POST',
        headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Rejected origin' }),
      })
    ).status,
    403,
  );
  for (let index = 0; index < 18; index++) {
    const joined = await post('', 'join', { nickname: `관객 ${index + 1}` });
    assert.equal(joined.status, 200);
    assert.match(joined.headers.get('set-cookie') ?? '', /HttpOnly; SameSite=Strict; Path=\//);
    clients.push({
      cookie: joined.headers.get('set-cookie')!.split(';')[0],
      controller: new AbortController(),
    });
  }
  const admin = clients[0];
  assert.equal((await post(admin.cookie, 'admin/login', { password })).status, 200);
  for (const client of clients) {
    client.reading = (async () => {
      const response = await fetch(`${origin}/api/events`, {
        headers: { Cookie: client.cookie },
        signal: client.controller.signal,
      });
      assert.equal(response.status, 200);
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const packet = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = packet.split('\n').find((line) => line.startsWith('data: '));
          if (data) client.snapshot = JSON.parse(data.slice(6));
        }
      }
    })().catch(() => {
      if (!client.controller.signal.aborted) streamFailed = true;
    });
  }
  await until(
    () =>
      clients.every(
        (client) => client.snapshot?.stage.participants.filter((p) => p.online).length === 18,
      ),
    '18 concurrent spectators',
  );
  assert.equal(clients.filter((client) => client.snapshot?.me.admin).length, 1);
  const race = await Promise.all(clients.map((client) => post(client.cookie, 'raise')));
  assert.equal(race.filter((response) => response.status === 200).length, 1);
  assert.equal(race.filter((response) => response.status === 409).length, 17);
  await post(admin.cookie, 'admin/reset');
  await post(admin.cookie, 'admin/present', {
    type: 'pane.upsert',
    pane: { id: 'load-output', kind: 'docs', title: '동기화 부하 검증' },
  });
  let content = '';
  for (let index = 0; index < 40; index++) {
    content = (content + `출력 ${index}\n` + '파도'.repeat(1000)).slice(-60_000);
    const result = await post(admin.cookie, 'admin/present', {
      type: 'pane.upsert',
      pane: {
        id: 'load-output',
        kind: 'docs',
        title: '동기화 부하 검증',
        content,
        status: index === 39 ? 'done' : 'active',
      },
    });
    assert.equal(result.status, 200);
  }
  await until(
    () => clients.every((client) => client.snapshot?.stage.panes[0]?.status === 'done'),
    'final output fan-out',
  );
  const expected = clients[0].snapshot!.stage.panes;
  for (const client of clients) {
    assert.deepEqual(client.snapshot!.stage.panes, expected);
    assert.equal(client.snapshot!.stage.panes[0].content.length, 60_000);
  }
  assert.equal((await post(clients[1].cookie, 'admin/reset')).status, 403);
  console.log(
    'Production check passed: built assets, private-file boundaries, security headers and Origin checks. Load check passed: 18 SSE clients, one lease winner, personalized admin state, 40 output bursts, identical bounded final snapshots.',
  );
} finally {
  for (const client of clients) client.controller.abort();
  await Promise.allSettled(clients.map((client) => client.reading));
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* Own process already exited. */
    }
  }
}
