import { request as http } from 'node:http';
import { request as https } from 'node:https';
import assert from 'node:assert/strict';
const local = process.argv.includes('--local');
const origin = 'https://pado.hurdoo.kr';
function transport(url) {
  if (!local) return { url, request: https };
  const value = new URL(url);
  const match = value.hostname.match(/^pado-app-(\d+)-(3000|3001|5173|8080)\.hurdoo\.kr$/);
  const port = match
    ? 4273 + Number(match[1]) * 4 + [3000, 3001, 5173, 8080].indexOf(Number(match[2]))
    : 4173;
  assert.ok(value.hostname === 'pado.hurdoo.kr' || match);
  return { url: `http://127.0.0.1:${port}${value.pathname}${value.search}`, request: http };
}
async function call(url, { method = 'GET', headers = {}, body, stream = false } = {}) {
  const target = transport(url);
  return new Promise((done, fail) => {
    let settled = false;
    const req = target.request(
      target.url,
      {
        method,
        timeout: 15000,
        headers: {
          Host: new URL(url).host,
          Connection: 'close',
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        let data = '';
        const finish = () => {
          if (!settled) {
            settled = true;
            done({ status: res.statusCode, headers: res.headers, data });
          }
        };
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 2_000_000) req.destroy(new Error('Response exceeds check limit'));
          if (stream && data.includes('event: state\n')) {
            finish();
            req.destroy();
          }
        });
        res.on('end', finish);
        res.on('error', (error) => {
          if (!settled) fail(error);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Check timed out')));
    req.on('error', (error) => {
      if (!settled) fail(error);
    });
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
try {
  const health = await call(origin + '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.data), {
    ok: true,
    runner: 'antigravity',
    publicMode: true,
    production: true,
  });
  assert.equal((await call(origin + '/')).status, 200);
  const join = await call(origin + '/api/join', {
    method: 'POST',
    headers: { Origin: origin },
    body: { nickname: '배포 검증' },
  });
  assert.equal(join.status, 200);
  const cookie = join.headers['set-cookie'][0];
  assert.match(
    cookie,
    /^__Host-pado_session=.*HttpOnly; SameSite=Strict; Path=\/; Max-Age=21600; Secure$/,
  );
  const headers = { Cookie: cookie.split(';')[0], Origin: origin };
  const snapshot = JSON.parse(join.data);
  assert.equal(snapshot.publicMode, true);
  assert.equal(snapshot.me.admin, false);
  const sse = await call(origin + '/api/events', { headers, stream: true });
  assert.equal(sse.status, 200);
  assert.ok(sse.data.includes('event: state\n'));
  assert.equal(
    (
      await call(origin + '/api/tui/input', {
        method: 'POST',
        headers,
        body: { data: 'spectator-denial-check' },
      })
    ).status,
    403,
  );
  const projects = [];
  for (const project of snapshot.workspace.projects) {
    const projectHeaders = { ...headers, 'X-Pado-Project': project.id };
    const state = JSON.parse((await call(origin + '/api/me', { headers: projectHeaders })).data);
    const tui = JSON.parse(
      (await call(origin + '/api/tui/snapshot', { headers: projectHeaders })).data,
    );
    assert.equal(tui.status, 'ready');
    const previews = [];
    for (const pane of state.stage.panes.filter((pane) => pane.kind === 'browser' && pane.server)) {
      const api = origin + '/api/preview/' + encodeURIComponent(pane.id);
      const preview = JSON.parse((await call(api, { headers: projectHeaders })).data);
      if (preview.state !== 'running') {
        previews.push({ port: pane.server.port, state: preview.state });
        continue;
      }
      assert.equal((await call(preview.url)).status, 401);
      const grant = JSON.parse((await call(api + '?access=1', { headers: projectHeaders })).data);
      const entry = new URL(grant.url);
      assert.equal((await call(entry.origin + entry.pathname)).status, 200);
      const session = await call(entry.origin + '/__pado_preview/session', {
        method: 'POST',
        headers: { Origin: entry.origin },
        body: { ticket: entry.hash.slice(1) },
      });
      assert.equal(session.status, 200);
      const appCookie = session.headers['set-cookie'][0].split(';')[0];
      const app = await call(entry.origin + JSON.parse(session.data).path, {
        headers: { Cookie: appCookie },
      });
      assert.equal(app.status, 200);
      previews.push({ port: pane.server.port, state: 'authenticated-200' });
    }
    projects.push({ slot: project.slot, tui: tui.status, previews });
  }
  console.log(
    JSON.stringify({
      transport: local ? 'loopback' : 'verified-HTTPS',
      health: 'ok',
      secureSession: true,
      sse: true,
      spectatorRawTuiDenied: true,
      participantTui: snapshot.participantTui === true,
      projects,
    }),
  );
} catch {
  console.error(
    'Public deployment check failed; no session values or response bodies are printed.',
  );
  process.exitCode = 1;
}
