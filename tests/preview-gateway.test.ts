import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { Duplex } from 'node:stream';
import { paneSchema, runtimeRequestSchema } from '../shared/protocol.ts';
import {
  PreviewGateway,
  appRequestHeaders,
  appResponseCookies,
} from '../server/preview-gateway.ts';
import { StageError } from '../server/stage.ts';
import type { IncomingMessage } from 'node:http';

test('project app cookies never forward platform, unrelated or other-project sessions', () => {
  const req = {
    headers: {
      cookie:
        'pado_session=PRIVATE; PADO_SESSION=PRIVATE; pado_app_A_sid=one; pado_app_B_sid=two; raw=outside',
    },
  } as IncomingMessage;
  const target = { host: '127.0.0.1' as const, port: 3000, epoch: 'one' };
  assert.equal(appRequestHeaders(req, target, false, 'pado_app_A_').cookie, 'sid=one');
  assert.equal(appRequestHeaders(req, target, true, 'pado_app_B_').cookie, 'sid=two');
  assert.deepEqual(
    appResponseCookies(
      ['sid=value; Path=/; SameSite=Lax', 'pado_session=BAD', 'domain=BAD; Domain=localhost'],
      'pado_app_A_',
    ),
    ['pado_app_A_sid=value; Path=/; HttpOnly; SameSite=Strict'],
  );
});

test('server panes and runtime requests cannot select arbitrary hosts, ports or host paths', () => {
  const pane = { id: 'app', kind: 'browser', title: 'App', server: { port: 5173 } };
  assert.equal(paneSchema.parse(pane).server?.path, '/');
  for (const server of [
    { port: 22 },
    { port: 5173, url: 'http://host' },
    { port: 5173, path: '//host' },
    { port: 5173, path: '/\\host' },
    { port: 5173, path: '/bad\npath' },
  ]) {
    assert.equal(paneSchema.safeParse({ ...pane, server }).success, false);
  }
  assert.equal(paneSchema.safeParse({ ...pane, kind: 'file' }).success, false);
  assert.equal(paneSchema.safeParse({ ...pane, content: '<script>1</script>' }).success, false);
  const request = {
    requestId: '416b85f4-ff88-4c83-a62b-28975dfd58da',
    action: 'serve',
    id: 'app',
    port: 3000,
    command: ['node', 'server.mjs'],
  };
  assert.equal(runtimeRequestSchema.parse(request).cwd, '.');
  assert.equal(runtimeRequestSchema.parse(request).display, 'terminal');
  assert.equal(runtimeRequestSchema.parse({ ...request, display: 'none' }).display, 'none');
  assert.equal(
    runtimeRequestSchema.safeParse({ ...request, display: 'hidden-secrets' }).success,
    false,
  );
  for (const cwd of ['/tmp', '../app', 'app/../private', 'a\\b'])
    assert.equal(runtimeRequestSchema.safeParse({ ...request, cwd }).success, false);
  assert.equal(runtimeRequestSchema.safeParse({ ...request, command: undefined }).success, false);
  assert.equal(runtimeRequestSchema.safeParse({ ...request, command: ['node\0'] }).success, false);
});

async function fixture() {
  const sockets = new Set<Duplex>();
  const upstream = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/nested?ok=1' });
      res.end();
      return;
    }
    if (req.url === '/external') {
      res.writeHead(302, { Location: 'http://192.168.10.1/private' });
      res.end();
      return;
    }
    res.setHeader('Set-Cookie', [
      'pado_session=BAD; Path=/',
      'PADO_SESSION=BAD; Path=/',
      'app=OK; Path=/',
      'domain=BAD; Domain=localhost',
    ]);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: req.url, headers: req.headers }));
  });
  upstream.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('end', () => socket.destroy());
    const accept = createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('error', () => {});
    socket.write(Buffer.from([0x81, 2, 111, 107]));
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  const port = (upstream.address() as { port: number }).port;
  let active = true;
  let published = true;
  let authorized = true;
  let readOnly = false;
  const gateway = new PreviewGateway({
    origin: 'http://127.0.0.1:4173',
    bindHost: '127.0.0.1',
    basePort: 15880,
    parentOrigins: ['http://127.0.0.1:4173', 'http://localhost:4173'],
    authorize: (req) => {
      if (!authorized || !req.headers.cookie?.includes('pado_session=VALID'))
        throw new StageError('Unauthorized', 401);
    },
    published: () => published,
    readOnly: () => readOnly,
    target: () => (active ? { host: '127.0.0.1', port, epoch: 'epoch' } : undefined),
    state: () => ({ state: active ? 'running' : 'stopped', epoch: 'epoch' }),
  });
  await gateway.listen();
  const origin = gateway.origin(5173);
  const get = (path = '/', init: RequestInit = {}) =>
    fetch(origin + path, {
      ...init,
      // Each fixture reuses the fixed gateway ports; never reuse a socket from its predecessor.
      headers: {
        Connection: 'close',
        Cookie: 'pado_session=VALID; app=hello; pado_session=SHADOW',
        ...init.headers,
      },
      redirect: 'manual',
    });
  return {
    gateway,
    origin,
    port,
    get,
    readOnly: (value = true) => {
      readOnly = value;
      gateway.sweep();
    },
    stop: () => {
      active = false;
      gateway.sweep();
    },
    hide: () => {
      published = false;
      gateway.sweep();
    },
    expire: () => {
      authorized = false;
      gateway.sweep();
    },
    close: async () => {
      await gateway.close();
      for (const socket of sockets) socket.destroy();
      upstream.closeAllConnections();
      await new Promise<void>((done) => upstream.close(() => done()));
    },
  };
}

test('gateway forwards real app paths and strips platform credentials, privileged response headers and external redirects', async () => {
  const f = await fixture();
  try {
    const response = await f.get('/api/questions?q=1', {
      headers: {
        Authorization: 'Bearer PRIVATE',
        Referer: 'http://private',
        'X-Forwarded-Host': 'private',
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.path, '/api/questions?q=1');
    assert.equal(body.headers.cookie, 'app=hello');
    assert.equal(body.headers.authorization, undefined);
    assert.equal(body.headers.referer, undefined);
    assert.equal(body.headers['x-forwarded-host'], undefined);
    assert.deepEqual(response.headers.getSetCookie(), ['app=OK; Path=/']);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('service-worker-allowed'), null);
    assert.match(
      response.headers.get('content-security-policy')!,
      /sandbox allow-scripts allow-forms allow-same-origin/,
    );
    assert.match(response.headers.get('content-security-policy')!, /worker-src 'none'/);
    assert.equal((await f.get('/redirect')).headers.get('location'), f.origin + '/nested?ok=1');
    assert.equal((await f.get('/external')).status, 502);
    assert.match(
      f.gateway.info(
        paneSchema.parse({
          id: 'app',
          kind: 'browser',
          title: 'App',
          server: { port: 5173, path: '/nested' },
        }),
        'localhost:4173',
      ).url,
      /^http:\/\/localhost:15882\/nested$/,
    );
  } finally {
    await f.close();
  }
});

test('gateway rejects unauthenticated, cross-origin, unpublished and stopped app access', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.origin, { headers: { Connection: 'close' } })).status, 401);
    const invalidHostStatus = await new Promise<number | undefined>((done, fail) => {
      const req = request(
        f.origin,
        { headers: { Host: 'evil.test:15882', Cookie: 'pado_session=VALID' } },
        (res) => {
          res.resume();
          done(res.statusCode);
        },
      );
      req.on('error', fail);
      req.end();
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal((await f.get('/', { headers: { Origin: 'http://127.0.0.1:4173' } })).status, 403);
    assert.equal((await f.get('/', { method: 'POST', body: '{}' })).status, 403);
    assert.equal(
      (await f.get('/', { method: 'POST', body: '{}', headers: { Origin: f.origin } })).status,
      200,
    );
    assert.equal((await f.get('//127.0.0.1:22/')).status, 400);
    f.stop();
    assert.equal((await f.get()).status, 503);
    f.hide();
    assert.equal((await f.get()).status, 403);
    f.expire();
    assert.equal((await f.get()).status, 401);
  } finally {
    await f.close();
  }
});

test('WebSocket upgrade passes through the gateway and is revoked when the session expires', async () => {
  const f = await fixture();
  try {
    const req = request(f.origin + '/hmr', {
      agent: false,
      headers: {
        Cookie: 'pado_session=VALID',
        Origin: f.origin,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    const upgrade = once(req, 'upgrade');
    req.end();
    const [response, socket, head] = await upgrade;
    assert.equal(response.statusCode, 101);
    const data = head.length ? head : (await once(socket, 'data'))[0];
    assert.equal(data.toString('utf8', 2), 'ok');
    const ended = once(socket, 'end');
    socket.resume();
    f.expire();
    await ended;
    socket.destroy();
  } finally {
    await f.close();
  }
});

test('inactive project apps allow reading but reject mutations and revoke existing WebSockets', async () => {
  const f = await fixture();
  const headers = {
    Cookie: 'pado_session=VALID',
    Origin: f.origin,
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
  };
  try {
    const req = request(f.origin + '/hmr', { agent: false, headers });
    const upgraded = once(req, 'upgrade');
    req.end();
    const [, socket] = await upgraded;
    const ended = once(socket, 'end');
    socket.resume();
    f.readOnly();
    await ended;
    socket.destroy();
    assert.equal((await f.get('/read')).status, 200);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      assert.equal(
        (await f.get('/write', { method, headers: { Origin: f.origin }, body: '{}' })).status,
        403,
      );
    const blocked = request(f.origin + '/hmr', { agent: false, headers });
    const response = once(blocked, 'response');
    blocked.end();
    const [denied] = await response;
    denied.resume();
    assert.equal(denied.statusCode, 403);
    f.readOnly(false);
    assert.equal(
      (await f.get('/write', { method: 'POST', headers: { Origin: f.origin }, body: '{}' })).status,
      200,
    );
  } finally {
    await f.close();
  }
});
