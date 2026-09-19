import { test, expect, type Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
async function post(page: Page, path: string, data = {}, project?: string) {
  const request = () =>
    page.request.post('/api/' + path, {
      headers: { Origin: origin, ...(project ? { 'X-Pado-Project': project } : {}) },
      data,
    });
  const response = await request();
  if (path === 'admin/login' && response.status() === 429) {
    test.setTimeout(100_000);
    await delay(
      Math.min(60, Math.max(1, Number(response.headers()['retry-after']) || 60)) * 1000 + 100,
    );
    return request();
  }
  return response;
}
async function join(page: Page, nickname: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(nickname);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
}

test('native secret input stays private, rejects other viewers/routes/projects, and works on desktop/mobile', async ({
  page,
  browser,
}, info) => {
  await join(page, '시크릿 요청자');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const viewerContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const viewer = await viewerContext.newPage();
  const value = 'DEMO-ONLY-PRIVATE-VALUE-9a51';
  try {
    await join(viewer, '시크릿 관객');
    await post(page, 'raise');
    await post(page, 'prompt', { prompt: '시크릿 입력 검증' });
    await expect
      .poll(async () => (await (await page.request.get('/api/me')).json()).stage.phase)
      .toBe('waiting');
    expect(
      (
        await post(page, 'admin/present', {
          type: 'pane.upsert',
          pane: {
            id: 'direction',
            kind: 'input',
            title: '날씨 API 연결',
            size: 2,
            secret: {
              name: 'WEATHER_API_KEY',
              description: '날씨 조회 기능을 실행하는 데 필요합니다.',
            },
          },
        })
      ).status(),
    ).toBe(200);
    const pane = page.getByLabel('날씨 API 연결 pane', { exact: true });
    await expect(pane).toBeVisible();
    await expect(pane.locator('iframe')).toHaveCount(0);
    await expect(pane.getByLabel('WEATHER_API_KEY', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    await expect(pane.getByRole('button', { name: '저장하고 계속' })).toBeDisabled();
    await pane.getByLabel('WEATHER_API_KEY', { exact: true }).fill(value);
    await expect(viewer.getByText('요청자의 실행 환경 설정을 기다리고 있어요')).toBeVisible();
    await expect(
      viewer.getByLabel('날씨 API 연결 pane', { exact: true }).locator('input[type="password"]'),
    ).toHaveCount(0);
    expect((await post(viewer, 'input/secret', { paneId: 'direction', value })).status()).toBe(403);
    expect((await post(page, 'input', { paneId: 'direction', values: { value } })).status()).toBe(
      400,
    );
    expect(
      (await post(page, 'input/secret', { paneId: 'direction', value }, 'wrong-project')).status(),
    ).toBe(400); // Project IDs are validated before routing to a project session.
    for (const p of [page, viewer])
      expect(await (await p.request.get('/api/me')).text()).not.toContain(value);
    await page.screenshot({ path: info.outputPath('secret-desktop.png') });
    await viewer.screenshot({ path: info.outputPath('secret-mobile-viewer.png') });
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(pane.getByRole('button', { name: '저장하고 계속' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath('secret-mobile.png') });
    const response = page.waitForResponse((r) => r.url().endsWith('/api/input/secret'));
    await pane.getByRole('button', { name: '저장하고 계속' }).click();
    const submitted = await response;
    expect(submitted.status()).toBe(200);
    expect(await submitted.text()).not.toContain(value);
    await expect(pane).toHaveCount(0);
    expect(
      (await post(page, 'input/secret', { paneId: 'direction', value: 'duplicate' })).status(),
    ).toBe(403);
    for (const p of [page, viewer]) {
      expect(await (await p.request.get('/api/me')).text()).not.toContain(value);
      expect(
        await p.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
      ).not.toContain(value);
    }
  } finally {
    await post(page, 'admin/reset');
    await viewerContext.close();
  }
});
