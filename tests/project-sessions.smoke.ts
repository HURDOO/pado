// Explicit Docker smoke; no AI prompts. Uses only a newly created, isolated data directory.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { Projects } from '../server/projects.ts';
import { StageStore } from '../server/stage.ts';
import {
  presentationSchema,
  type PreviewInfo,
  type Snapshot,
  type TuiFrame,
} from '../shared/protocol.ts';

const exec = promisify(execFile);
const root = await mkdtemp(resolve('.pado/project-sessions-'));
const port = Number(process.env.PADO_SESSIONS_TEST_PORT || 14847);
const origin = `http://127.0.0.1:${port}`;
const projects = await new Projects(root).init();
await projects.rename('default', 'Session A');
await projects.create('Session B');
await projects.create('Session C');
const list = projects.list();
for (const project of list) {
  const paths = projects.paths(project.id);
  await mkdir(paths.workspace, { recursive: true });
  await writeFile(
    resolve(paths.workspace, 'server.mjs'),
    `import { createServer } from 'node:http';
let changes = 0;
createServer((req,res) => {
  if(req.method === 'POST') changes++;
  res.setHeader('Content-Type','text/html');
  res.end('<h1>${project.name}</h1><p>Changes: '+changes+'</p>');
}).listen(3000,'0.0.0.0');\n`,
  );
  await projects.saveApp(project.id, {
    requestId: randomUUID(),
    action: 'serve',
    id: 'app',
    port: 3000,
    display: 'none',
    cwd: '.',
    command: ['node', 'server.mjs'],
  });
  const stage = new StageStore('antigravity');
  stage.present(
    presentationSchema.parse({
      type: 'pane.upsert',
      pane: {
        id: 'app',
        kind: 'browser',
        title: project.name,
        server: { port: 3000, path: '/' },
      },
    }),
  );
  await projects.save(project.id, stage.checkpoint());
}
const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  env: {
    ...process.env,
    PADO_PORT: String(port),
    PADO_BIND_HOST: '127.0.0.1',
    PADO_ORIGIN: origin,
    PADO_PREVIEW_BASE_PORT: String(port + 100),
    PADO_DATA_DIR: root,
    PADO_RUNNER: 'antigravity',
    PADO_ADMIN_PASSWORD: 'project-sessions-test-only-password',
  },
  stdio: 'ignore',
});
const exited = new Promise<number | null>((ok) => server.once('exit', ok));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let cookie = '';
async function get<T>(path: string): Promise<T> {
  const res = await fetch(origin + '/api/' + path, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200, path);
  return (await res.json()) as T;
}
async function post(path: string, value = {}, project?: string, status = 200) {
  const res = await fetch(origin + '/api/' + path, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...(project ? { 'X-Pado-Project': project } : {}),
    },
    body: JSON.stringify(value),
  });
  assert.equal(res.status, status, path);
  if (res.headers.has('set-cookie')) cookie = res.headers.get('set-cookie')!.split(';')[0];
  return res.json();
}
const screen = (id: string) => get<TuiFrame>(`tui/snapshot?project=${id}`);
const preview = (id: string) => get<PreviewInfo>(`preview/app?project=${id}`);
const streamControllers: AbortController[] = [];
const streams: Promise<void>[] = [];
const frames = new Map<string, TuiFrame[]>();
const errors: string[] = [];
let owned: string[] = [];
try {
  await expect
    .poll(
      async () =>
        fetch(origin + '/api/health')
          .then((r) => r.status)
          .catch(() => 0),
      { timeout: 30000 },
    )
    .toBe(200);
  await post('join', { nickname: '세 세션 검증' });
  await post('admin/login', { password: 'project-sessions-test-only-password' });
  for (const project of list) {
    await expect
      .poll(async () => (await screen(project.id)).text, { timeout: 90000 })
      .toContain('for shortcuts');
    await expect
      .poll(async () => (await preview(project.id)).state, { timeout: 30000 })
      .toBe('running');
    const snapshot = await get<Snapshot>(`me?project=${project.id}`);
    assert.deepEqual(
      snapshot.stage.panes.map((pane) => pane.id),
      ['app'],
      'Warmup must not add log panes',
    );
    assert.equal(snapshot.stage.focusId, 'app');
  }
  const epochs = new Map(
    await Promise.all(list.map(async (p) => [p.id, (await screen(p.id)).epoch] as const)),
  );
  const appEpochs = new Map(
    await Promise.all(list.map(async (p) => [p.id, (await preview(p.id)).epoch] as const)),
  );
  assert.equal(new Set(epochs.values()).size, 3);
  assert.equal(new Set(appEpochs.values()).size, 3);
  for (const project of list) {
    const controller = new AbortController();
    streamControllers.push(controller);
    frames.set(project.id, []);
    streams.push(
      (async () => {
        const response = await fetch(origin + `/api/tui/events?project=${project.id}`, {
          headers: { Cookie: cookie },
          signal: controller.signal,
        });
        assert.equal(response.status, 200);
        let pending = '';
        for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
          pending += chunk;
          let end: number;
          while ((end = pending.indexOf('\n\n')) >= 0) {
            const event = pending.slice(0, end);
            pending = pending.slice(end + 2);
            if (event.startsWith('event: terminal\ndata: '))
              frames.get(project.id)!.push(JSON.parse(event.slice(22)) as TuiFrame);
          }
        }
      })().catch((error) => {
        if (!controller.signal.aborted) errors.push(String(error));
      }),
    );
  }
  for (const project of list) {
    await post('admin/projects/select', { id: project.id });
    await post('tui/input', { data: `DRAFT-${project.slot}-ONLY` }, project.id);
    await expect
      .poll(async () => (await screen(project.id)).text)
      .toContain(`DRAFT-${project.slot}-ONLY`);
    const app = await preview(project.id);
    const write = await fetch(app.url, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: new URL(app.url).origin },
    });
    assert.equal(write.status, 200);
    for (const other of list.filter((p) => p.id !== project.id)) {
      await post('tui/input', { data: 'REJECTED' }, other.id, 403);
      await post('tui/resize', { cols: 80, rows: 24 }, other.id, 403);
      await post('raise', {}, other.id, 403);
      const url = (await preview(other.id)).url;
      assert.equal((await fetch(url, { headers: { Cookie: cookie } })).status, 200);
      assert.equal(
        (
          await fetch(url, {
            method: 'POST',
            headers: { Cookie: cookie, Origin: new URL(url).origin },
          })
        ).status,
        403,
      );
    }
  }
  await post('admin/projects/select', { id: list[0].id });
  for (const project of list) {
    const terminal = await screen(project.id);
    assert.equal(terminal.epoch, epochs.get(project.id));
    assert.equal((await preview(project.id)).epoch, appEpochs.get(project.id));
    assert.match(terminal.text!, new RegExp(`DRAFT-${project.slot}-ONLY`));
    assert.doesNotMatch(terminal.text!, /REJECTED/);
    for (const other of list.filter((p) => p.id !== project.id))
      assert.ok(!terminal.text!.includes(`DRAFT-${other.slot}-ONLY`));
    assert.ok(frames.get(project.id)!.length > 1);
    assert.ok(frames.get(project.id)!.every((frame) => frame.epoch === epochs.get(project.id)));
  }
  const names = (await exec('docker', ['ps', '--format', '{{.Names}}'])).stdout.trim().split('\n');
  for (const name of names.filter((name) => /^pado-(tui|app)-/.test(name))) {
    const mounts = JSON.parse(
      (await exec('docker', ['inspect', '--format', '{{json .Mounts}}', name])).stdout,
    ) as { Source: string }[];
    if (mounts.some((mount) => mount.Source.startsWith(root + '/'))) owned.push(name);
  }
  assert.equal(owned.filter((name) => name.startsWith('pado-tui-')).length, 3);
  assert.equal(owned.filter((name) => name.startsWith('pado-app-')).length, 3);
  const stats = (
    await exec('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}',
      ...owned,
    ])
  ).stdout;
  console.log('Three stable native TUI sessions and app runtimes; resource sample:\n' + stats);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1646, height: 838 } });
  await context.addCookies([
    { name: 'pado_session', value: cookie.slice('pado_session='.length), url: origin },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .getByRole('navigation', { name: '프로젝트 목록' })
    .getByRole('button', { name: 'Session B', exact: true })
    .click();
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-controller', 'false');
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-connected', 'true');
  await expect(page.getByRole('button', { name: '손들고 참여하기' })).toHaveCount(0);
  await expect(page.locator('.admin-toolbar')).toHaveCount(0);
  await expect(
    page.frameLocator('.browser-pane iframe').getByRole('heading', { name: 'Session B' }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(root, 'inactive-native-desktop.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload();
  await expect(page.getByLabel('프로젝트', { exact: true })).toHaveValue(list[1].id);
  await page
    .getByRole('navigation', { name: 'Workspace pane 전환' })
    .getByRole('button', { name: 'Agent', exact: true })
    .click();
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-controller', 'false');
  await expect(page.getByLabel('Antigravity TUI 화면')).toBeInViewport();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(root, 'inactive-native-mobile.png') });
  await browser.close();
  browser = undefined;
  // Stop only A. B/C remain alive with unchanged terminal and runtime epochs.
  await post('admin/stop', {}, list[0].id);
  for (const project of list.slice(1)) {
    assert.equal((await screen(project.id)).epoch, epochs.get(project.id));
    assert.equal((await preview(project.id)).epoch, appEpochs.get(project.id));
    assert.equal((await preview(project.id)).state, 'running');
  }
  assert.equal((await get<Snapshot>('me')).workspace.activeId, list[0].id);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(root, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        projects: list,
        epochs: Object.fromEntries(epochs),
        appEpochs: Object.fromEntries(appEpochs),
        owned,
        stats,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: persistent sessions, per-project SSE, read-only UI/API/app gateway, isolated stop. ' +
      root,
  );
} finally {
  for (const controller of streamControllers) controller.abort();
  await Promise.all(streams);
  await browser?.close();
  server.kill('SIGTERM');
  await Promise.race([
    exited,
    delay(30000, undefined, { ref: false }).then(() => {
      throw new Error('Test server shutdown timed out');
    }),
  ]);
  if (owned.length) {
    const remaining = (await exec('docker', ['ps', '--format', '{{.Names}}'])).stdout
      .trim()
      .split('\n');
    assert.ok(
      owned.every((name) => !remaining.includes(name)),
      'All test-owned runtimes must stop at server shutdown',
    );
  }
}
