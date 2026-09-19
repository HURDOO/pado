import { test, expect } from '@playwright/test';
import { createServer, request, type IncomingMessage } from 'node:http';
import { PreviewGateway } from '../../server/preview-gateway.ts';
import { paneSchema, previewPorts } from '../../shared/protocol.ts';
import { publicPreviewOrigin } from '../../shared/preview-origin.ts';
import { StageError } from '../../server/stage.ts';

test('browser redeems a fragment ticket inside a separate HTTPS origin with host-only cookies', async ({
  page,
  context,
}) => {
  const parent = 'https://pado.example.test';
  const preview = publicPreviewOrigin(parent, 0, 3000);
  const received: IncomingMessage['headers'][] = [];
  let alive = true;
  const upstream = createServer((req, res) => {
    received.push(req.headers);
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><h1>App isolation verified</h1>');
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  const gateway = new PreviewGateway({
    origin: parent,
    bindHost: '127.0.0.1',
    basePort: 16080,
    parentOrigins: [parent],
    publicOrigins: new Map(
      previewPorts.map((port) => [port, publicPreviewOrigin(parent, 0, port)]),
    ),
    cookiePrefix: 'pado_app_browser_',
    authorize: () => {
      if (!alive) throw new StageError('Expired', 401);
    },
    published: () => true,
    target: () => ({
      host: '127.0.0.1',
      port: (upstream.address() as { port: number }).port,
      epoch: 'proof',
    }),
    state: () => ({ state: 'running', epoch: 'proof' }),
  });
  await gateway.listen();
  const entry = gateway.entry(
    paneSchema.parse({
      id: 'app',
      kind: 'browser',
      title: 'App',
      server: { port: 3000, path: '/' },
    }),
    { headers: {} } as IncomingMessage,
  );
  // The browser sees genuine HTTPS origins; only transport is mapped locally for this test.
  // Real edge certificate/transport validation is a separate deployment check.
  await context.route('https://**.example.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === parent) {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie':
            '__Host-pado_session=PARENT_ONLY; Secure; HttpOnly; SameSite=Strict; Path=/',
        },
        body: `<!doctype html><iframe title="App" sandbox="allow-scripts allow-forms allow-same-origin" src="${entry}"></iframe>`,
      });
      return;
    }
    if (url.origin !== preview) {
      await route.abort();
      return;
    }
    const headers = await route.request().allHeaders();
    headers.host = url.host;
    const response = await new Promise<{
      status: number;
      headers: Record<string, string>;
      body: Buffer;
    }>((done, fail) => {
      const req = request(
        'http://127.0.0.1:16080' + url.pathname + url.search,
        { method: route.request().method(), headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            done({
              status: res.statusCode!,
              headers: Object.fromEntries(
                Object.entries(res.headers)
                  .filter(([name]) => !['connection', 'transfer-encoding'].includes(name))
                  .map(([name, value]) => [
                    name,
                    Array.isArray(value) ? value.join('\n') : value || '',
                  ]),
              ),
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on('error', fail);
      req.end(route.request().postDataBuffer());
    });
    await route.fulfill(response);
  });
  try {
    await page.goto(parent);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'App isolation verified' })).toBeVisible();
    expect(received.length).toBeGreaterThan(0);
    expect(received.every((headers) => !headers.cookie?.includes('pado'))).toBe(true);
    const cookies = await context.cookies(preview);
    expect(cookies.find((cookie) => cookie.name === '__Host-pado_preview')).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
      domain: new URL(preview).hostname,
    });
    expect(cookies.some((cookie) => cookie.name === '__Host-pado_session')).toBe(false);
    const isolated = await frame.locator('h1').evaluate(() => {
      let parentBlocked = false;
      try {
        void window.parent.document.body;
      } catch {
        parentBlocked = true;
      }
      return { parentBlocked, hash: location.hash, cookie: document.cookie };
    });
    expect(isolated).toEqual({ parentBlocked: true, hash: '', cookie: '' });
    alive = false;
    gateway.sweep();
    await frame.locator('h1').evaluate(() => location.reload());
    await expect(frame.locator('body')).not.toContainText('App isolation verified');
  } finally {
    await gateway.close();
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
  }
});
