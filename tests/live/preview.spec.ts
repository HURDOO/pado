import { test, expect, type Page } from '@playwright/test';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Snapshot, TuiFrame } from '../../shared/protocol.ts';

async function post(page: Page, path: string, value: unknown = {}) {
  return page.evaluate(
    async ({ path, value }) => {
      const response = await fetch('/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, value },
  );
}
async function state(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => (await fetch('/api/me')).json());
}
async function screen(page: Page): Promise<TuiFrame> {
  return page.evaluate(async () => (await fetch('/api/tui/snapshot')).json());
}
async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(name);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-connected', 'true');
}
async function enter(page: Page, prompt: string) {
  await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-controller', 'true');
  await page.getByLabel('Antigravity 터미널 입력').focus();
  await page.keyboard.insertText(prompt);
  await page.keyboard.press('Enter');
  await expect.poll(async () => !!(await state(page)).stage.turn).toBe(true);
}

test('native agent starts real React/Node/SQLite app; shared state, mobile, HMR, restart and isolation work', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(600000);
  const workspace = resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace/live-qa');
  await mkdir(workspace, { recursive: true });
  await cp('examples/live-qa', workspace, {
    recursive: true,
    filter: (source) => !source.includes('node_modules') && !source.includes('/data'),
  });
  await join(page, '앱 서버 검증');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  const mobileContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:14736',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  mobile.on('pageerror', (error) => errors.push(error.message));
  const sockets: { url: string; frames: string[] }[] = [];
  page.on('websocket', (socket) => {
    const record = { url: socket.url(), frames: [] as string[] };
    sockets.push(record);
    socket.on('framereceived', (event) => record.frames.push(event.payload.toString()));
  });
  try {
    await enter(
      page,
      'Run this exact integration check. The prepared real React/Node/SQLite project already exists at /workspace/live-qa. Do not rewrite it or create a static HTML preview. In order, execute: node /opt/pado/present.mjs exec qa-install --cwd live-qa npm install --no-audit --no-fund ; node /opt/pado/present.mjs exec qa-tests --cwd live-qa npm test ; node /opt/pado/present.mjs serve qa-app 3000 --cwd live-qa npm run dev . These are THREE separate allowed helper calls, not shell chaining. After actual success keep qa-tests-logs at size 1 so I can inspect the real test evidence; close qa-install-logs and qa-app-logs, resize qa-app to 3, publish pane.focus qa-app and finish. No plan pane needed.',
    );
    const frame = page.frameLocator('iframe[title="실행 중인 앱"]');
    await expect(frame.getByRole('heading', { name: '모임 질문 보드' })).toBeVisible({
      timeout: 240000,
    });
    await expect.poll(async () => (await state(page)).stage.turn).toBe(null);
    await expect
      .poll(async () => {
        const browser = await page.getByLabel('실행 중인 앱 pane', { exact: true }).boundingBox();
        const agent = await page.getByLabel('Agent pane', { exact: true }).boundingBox();
        return !!browser && !!agent && browser.width > agent.width;
      })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await state(page)).stage.panes.find((pane) => pane.id === 'qa-tests-logs')?.content,
      )
      .toContain('pass 1');
    await expect
      .poll(() =>
        sockets.some((socket) => socket.frames.some((frame) => frame.includes('connected'))),
      )
      .toBe(true);
    await frame.getByLabel('어떤 점이 궁금한가요?').fill('다음 모임에서도 이 질문이 남나요?');
    await frame.getByLabel('이름 (선택)').fill('데스크톱');
    await frame.getByRole('button', { name: '질문 올리기' }).click();
    await expect(
      frame.getByText('다음 모임에서도 이 질문이 남나요?', { exact: true }),
    ).toBeVisible();
    await join(mobile, '모바일 참가자');
    const mobileFrame = mobile.frameLocator('iframe[title="실행 중인 앱"]');
    await expect(
      mobileFrame.getByText('다음 모임에서도 이 질문이 남나요?', { exact: true }),
    ).toBeVisible();
    await mobileFrame.getByRole('button', { name: '공감 0', exact: true }).click();
    await expect(frame.getByRole('button', { name: '공감 1', exact: true })).toBeVisible();
    await frame.getByLabel('어떤 점이 궁금한가요?').fill('HMR 중에도 유지되는 작성 중 질문');
    const cssFile = resolve(workspace, 'style.css');
    await writeFile(
      cssFile,
      (await readFile(cssFile, 'utf8')) + '\nh1 { color: rgb(177, 222, 123); }\n',
    );
    await expect(frame.getByRole('heading', { name: '모임 질문 보드' })).toHaveCSS(
      'color',
      'rgb(177, 222, 123)',
    );
    await expect(frame.getByLabel('어떤 점이 궁금한가요?')).toHaveValue(
      'HMR 중에도 유지되는 작성 중 질문',
    );
    // Vite 8 can send CSS module updates as js-update, with /style.css as the path.
    await expect
      .poll(() =>
        sockets.some(
          (socket) =>
            new URL(socket.url).port === '14836' &&
            socket.frames.some((frame) => {
              const message = JSON.parse(frame);
              return (
                message.type === 'update' &&
                message.updates.some((update: { path: string }) =>
                  update.path.includes('/style.css'),
                )
              );
            }),
        ),
      )
      .toBe(true);
    const app = page.frames().find((frame) => frame.url().startsWith('http://127.0.0.1:14836/'))!;
    expect(
      await app.evaluate(() => {
        try {
          void parent.document.body;
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    expect(await app.evaluate(() => document.cookie.includes('pado_session'))).toBe(false);
    expect(
      await app.evaluate(async () => {
        try {
          await fetch('http://127.0.0.1:14736/api/me');
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    const infoResponse = await page.request.get('/api/preview/qa-app');
    const url = (await infoResponse.json()).url;
    expect((await fetch(url)).status).toBe(401);
    await page.screenshot({ path: info.outputPath('live-app-desktop.png') });
    await mobile.screenshot({ path: info.outputPath('live-app-mobile.png') });
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const mobileApp = mobile
      .frames()
      .find((frame) => frame.url().startsWith('http://127.0.0.1:14836/'))!;
    expect(await mobileApp.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '실행 중인 앱 새로고침', exact: true }).click();
    await expect(
      frame.getByText('다음 모임에서도 이 질문이 남나요?', { exact: true }),
    ).toBeVisible();
    await enter(
      page,
      'Restart only the prepared app using node /opt/pado/present.mjs serve qa-app 3000 --cwd live-qa npm run dev . Do not alter any files, do not reinstall dependencies, do not delete data. After it succeeds focus qa-app and finish.',
    );
    await expect.poll(async () => (await state(page)).stage.turn).toBe(null);
    await expect(
      frame.getByText('다음 모임에서도 이 질문이 남나요?', { exact: true }),
    ).toBeVisible();
    await expect(frame.getByRole('button', { name: '공감 1', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    expect((await post(page, 'admin/stop')).status).toBe(200);
    await expect(page.getByText('앱 서버가 실행 중이 아니에요')).toBeVisible();
    expect((await page.request.get(url)).status()).toBe(503);
  } finally {
    await post(page, 'admin/stop');
    for (const pane of (await state(page)).stage.panes)
      await post(page, 'admin/present', { type: 'pane.close', id: pane.id });
    await mobileContext.close();
  }
});
