import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage } from 'node:http';
import { PreviewGateway } from '../server/preview-gateway.ts';
import { visitorAddress } from '../server/public-origin.ts';
import { publicPreviewOrigin, isIsolatedPreviewUrl } from '../shared/preview-origin.ts';
import { paneSchema, previewPorts } from '../shared/protocol.ts';
import { StageError } from '../server/stage.ts';

test('public preview origins are distinct, predictable and never share the parent origin', () => {
  const parent = 'https://pado.example.test';
  const origins = Array.from({ length: 12 }, (_, slot) =>
    previewPorts.map((port) => publicPreviewOrigin(parent, slot, port)),
  ).flat();
  assert.equal(new Set(origins).size, 48);
  assert.ok(origins.every((origin) => origin !== parent));
  assert.equal(publicPreviewOrigin(parent, 2, 5173), 'https://pado-app-2-5173.example.test');
  for (const value of [
    parent,
    'https://attacker.test',
    'https://pado-app-2-5173.example.test.attacker.test',
    'http://pado-app-2-5173.example.test',
  ])
    assert.equal(isIsolatedPreviewUrl(value, parent, 5173), false);
  assert.equal(isIsolatedPreviewUrl(origins[2] + '/nested', parent, 5173), true);
  assert.equal(isIsolatedPreviewUrl('http://127.0.0.1:4273/', 'http://127.0.0.1:4173', 3000), true);
});

test('visitor IP headers are trusted only from an explicitly enabled loopback proxy', () => {
  const req = (peer: string, forwarded: string) =>
    ({
      socket: { remoteAddress: peer },
      headers: { 'cf-connecting-ip': forwarded },
    }) as unknown as IncomingMessage;
  assert.equal(visitorAddress(req('127.0.0.1', '203.0.113.20'), true), '203.0.113.20');
  assert.equal(visitorAddress(req('192.168.1.2', '203.0.113.20'), true), '192.168.1.2');
  assert.equal(visitorAddress(req('127.0.0.1', '203.0.113.20'), false), '127.0.0.1');
  assert.equal(visitorAddress(req('127.0.0.1', '1.2.3.4, 5.6.7.8'), true), '127.0.0.1');
});

test('HTTPS preview tickets become scoped cookies without forwarding platform or Cloudflare credentials', async () => {
  const parent = 'https://pado.example.test';
  const origin = publicPreviewOrigin(parent, 0, 5173);
  let alive = true;
  let epoch = 'first';
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', ['__Host-pado_preview=evil; Secure; Path=/', 'sid=ok; Path=/']);
    if (req.url === '/redirect') res.writeHead(302, { Location: '/nested' });
    res.end(JSON.stringify({ path: req.url, headers: req.headers }));
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  const targetPort = (upstream.address() as { port: number }).port;
  const gateway = new PreviewGateway({
    origin: parent,
    bindHost: '127.0.0.1',
    basePort: 15980,
    parentOrigins: [parent],
    publicOrigins: new Map(
      previewPorts.map((port) => [port, publicPreviewOrigin(parent, 0, port)]),
    ),
    cookiePrefix: 'pado_app_test_',
    authorize: (req) => {
      if (!alive || req.headers.cookie !== '__Host-pado_session=PRIVATE')
        throw new StageError('Expired', 401);
    },
    published: () => true,
    target: () => ({ host: '127.0.0.1', port: targetPort, epoch }),
    state: () => ({ state: 'running', epoch }),
  });
  await gateway.listen();
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET', body?: string) =>
    new Promise<Response>((done, fail) => {
      const req = request(
        'http://127.0.0.1:15982' + path,
        {
          method,
          headers: { Host: new URL(origin).host, Connection: 'close', ...headers },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const responseHeaders = new Headers();
            for (let i = 0; i < res.rawHeaders.length; i += 2)
              responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
            done(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode,
                headers: responseHeaders,
              }),
            );
          });
          res.on('error', fail);
        },
      );
      req.on('error', fail);
      req.end(body);
    });
  const pane = paneSchema.parse({
    id: 'app',
    kind: 'browser',
    title: 'App',
    server: { port: 5173, path: '/nested?test=1' },
  });
  const mainRequest = {
    headers: { cookie: '__Host-pado_session=PRIVATE', host: new URL(parent).host },
  } as IncomingMessage;
  try {
    assert.equal((await get('/')).status, 401);
    assert.equal((await get('/', { Cookie: mainRequest.headers.cookie! })).status, 401);
    const entry = new URL(gateway.entry(pane, mainRequest));
    assert.equal(entry.origin, origin);
    assert.equal(entry.search, '');
    const bootstrap = await get(entry.pathname);
    assert.equal(bootstrap.status, 200);
    assert.match(
      bootstrap.headers.get('content-security-policy')!,
      /frame-ancestors https:\/\/pado.example.test/,
    );
    assert.ok(!(await bootstrap.text()).includes(entry.hash.slice(1)));
    const grant = JSON.stringify({ ticket: entry.hash.slice(1) });
    assert.equal(
      (
        await get(
          '/__pado_preview/session',
          { Origin: parent, 'Content-Type': 'application/json' },
          'POST',
          grant,
        )
      ).status,
      403,
    );
    const session = await get(
      '/__pado_preview/session',
      { Origin: origin, 'Content-Type': 'application/json' },
      'POST',
      grant,
    );
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { path: '/nested?test=1' });
    const setCookie = session.headers.get('set-cookie')!;
    assert.match(setCookie, /^__Host-pado_preview=.*; Secure; HttpOnly; SameSite=Strict; Path=\//);
    assert.ok(!setCookie.includes('Domain='));
    const cookie = setCookie.split(';')[0];
    assert.equal(
      (
        await get(
          '/__pado_preview/session',
          { Origin: origin, 'Content-Type': 'application/json' },
          'POST',
          grant,
        )
      ).status,
      401,
    );
    const response = await get('/nested', {
      Cookie: `${cookie}; pado_app_test_sid=one`,
      'Cf-Access-Jwt-Assertion': 'PRIVATE',
      'Cf-Connecting-IP': '203.0.113.1',
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.headers.cookie, 'sid=one');
    assert.equal(result.headers['cf-access-jwt-assertion'], undefined);
    assert.equal(result.headers['cf-connecting-ip'], undefined);
    assert.deepEqual(response.headers.getSetCookie(), [
      'pado_app_test_sid=ok; Path=/; HttpOnly; SameSite=Strict',
    ]);
    assert.equal(
      (await get('/redirect', { Cookie: cookie })).headers.get('location'),
      origin + '/nested',
    );
    assert.equal((await get('/', { Cookie: cookie, Origin: parent }, 'POST', '{}')).status, 403);
    epoch = 'second';
    assert.equal((await get('/', { Cookie: cookie })).status, 401);
    epoch = 'first';
    alive = false;
    gateway.sweep();
    assert.equal((await get('/', { Cookie: cookie })).status, 401);
  } finally {
    await gateway.close();
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
  }
});
