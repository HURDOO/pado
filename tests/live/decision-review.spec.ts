import { test, expect, type Page } from '@playwright/test';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Snapshot, TuiFrame } from '../../shared/protocol.ts';

const state = (page: Page): Promise<Snapshot> =>
  page.evaluate(async () => (await fetch('/api/me')).json());
const screen = (page: Page): Promise<TuiFrame> =>
  page.evaluate(async () => (await fetch('/api/tui/snapshot')).json());
async function post(page: Page, path: string, value = {}) {
  const result = await page.evaluate(
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
  expect(result.status).toBe(200);
  return result.body;
}
test('native agent waits for a visual choice, implements it, and hands off actual passed/failed/unverified evidence', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(600000);
  const workspace = resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace/decision-app');
  await mkdir(workspace, { recursive: true });
  await cp('tests/fixtures/decision-app', workspace, { recursive: true });
  const original = await readFile(resolve(workspace, 'server.mjs'), 'utf8');
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('비교 검증');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  const context = await browser.newContext({
    baseURL: process.env.PADO_ORIGIN || `http://127.0.0.1:${process.env.PADO_LIVE_PORT || '14736'}`,
    viewport: { width: 390, height: 844 },
  });
  const mobile = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await page.getByLabel('Antigravity 터미널 입력').focus();
    await page.keyboard.insertText(
      'decision-app에 질문 보드 서버와 테스트가 준비되어 있어. 모바일 목록을 카드형과 컴팩트 목록형 두 안으로 시각적으로 비교해서 내가 고르게 해줘. 선택 확인 전에는 앱 파일을 수정하거나 실행하지 마. 선택 후에는 settings.json의 layout을 cards 또는 list로 저장해 적용하고, 기존 server.mjs와 테스트는 수정하지 마. node --test layout.test.mjs 와 node --test keyboard.test.mjs 를 앱 컨테이너에서 각각 실제 실행해줘. 두 번째는 아직 상세 버튼이 없어 실패하는 게 맞고, 이번에는 고치지 마. 그 뒤 node server.mjs로 3000 포트에 실제 앱을 띄워줘. 마지막에는 변경점, 두 명령의 실제 성공/실패 근거, 아직 해보지 않은 실제 Android 검증을 함께 검토할 수 있게 보여줘. 미검증 Android 항목에는 실행 앱 / 재현 화면도 연결해줘. 준비 로그는 정리하고 사용자 선택과 검토에 집중해.',
    );
    await page.keyboard.press('Enter');
    await expect
      .poll(
        async () =>
          (await state(page)).stage.panes.some((pane) => pane.kind === 'input' && pane.decision),
        { timeout: 180000 },
      )
      .toBe(true);
    const decisionPane = (await state(page)).stage.panes.find((pane) => pane.decision)!;
    expect((await state(page)).stage.phase).toBe('waiting');
    expect(
      await stat(resolve(workspace, 'settings.json')).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(await readFile(resolve(workspace, 'server.mjs'), 'utf8')).toBe(original);
    expect((await state(page)).stage.panes.some((pane) => pane.kind === 'browser')).toBe(false);
    await mobile.goto('/');
    await mobile.getByLabel('어떻게 불러 드릴까요?').fill('모바일 관객');
    await mobile.getByRole('button', { name: 'Stage 입장하기' }).click();
    await expect(mobile.getByRole('radio').first()).toBeDisabled();
    await page.screenshot({ path: info.outputPath('native-comparison-desktop.png') });
    await mobile.screenshot({ path: info.outputPath('native-comparison-mobile.png') });
    const option = decisionPane.decision!.options.find((option) =>
      /list|목록|리스트/i.test(option.id + option.title),
    )!;
    expect(option).toBeTruthy();
    await page.locator(`input[type="radio"][value="${option.id}"]`).check();
    await page
      .getByLabel('추가 요청', { exact: false })
      .fill('접수 상태가 잘 보이는 목록형으로 진행해줘.');
    await page.getByRole('button', { name: '이 안으로 진행' }).click();
    await expect.poll(async () => (await state(page)).stage.turn, { timeout: 300000 }).toBe(null);
    const result = (await state(page)).stage;
    expect(result.phase).toBe('idle');
    expect(result.panes.filter((pane) => pane.kind === 'input')).toHaveLength(0);
    expect(
      result.panes.filter((pane) => pane.kind === 'terminal' && pane.status === 'active'),
    ).toHaveLength(0);
    const review = result.panes.find((pane) => pane.kind === 'review')!;
    expect(review).toBeTruthy();
    expect(
      review.review!.checks.some((check) => check.status === 'passed' && check.run?.code === 0),
    ).toBe(true);
    expect(
      review.review!.checks.some((check) => check.status === 'failed' && check.run?.code !== 0),
    ).toBe(true);
    const unverified = review.review!.checks.find(
      (check) => check.status === 'unverified' && check.reproduction,
    )!;
    expect(unverified).toBeTruthy();
    expect(JSON.parse(await readFile(resolve(workspace, 'settings.json'), 'utf8')).layout).toBe(
      'list',
    );
    expect(await readFile(resolve(workspace, 'server.mjs'), 'utf8')).toBe(original);
    const app = result.panes.find((pane) => pane.kind === 'browser' && pane.server)!;
    expect(app).toBeTruthy();
    await expect(
      page.frameLocator(`iframe[title="${app.title}"]`).getByRole('heading', { name: '질문 보드' }),
    ).toBeVisible();
    await expect(
      page.frameLocator(`iframe[title="${app.title}"]`).locator('[data-layout="list"]'),
    ).toHaveText('목록형');
    await post(page, 'admin/present', { type: 'pane.focus', id: review.id });
    await post(page, 'admin/present', { type: 'pane.close', id: app.id });
    const reviewElement = page.locator(`[data-pane-id="${review.id}"]`);
    await expect
      .poll(async () => {
        const bounds = await reviewElement.boundingBox();
        const agent = await page.getByLabel('Agent pane', { exact: true }).boundingBox();
        return !!bounds && !!agent && bounds.width > agent.width;
      })
      .toBe(true);
    await reviewElement.getByRole('button', { name: '재현 화면 보기' }).first().click();
    await expect(
      reviewElement.frameLocator('iframe').getByRole('heading', { name: '질문 보드' }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath('native-review-desktop.png') });
    await expect(mobile.locator(`[data-pane-id="${review.id}"]`)).toBeVisible();
    await mobile.screenshot({ path: info.outputPath('native-review-mobile.png') });
    expect(errors).toEqual([]);
  } finally {
    await post(page, 'admin/reset');
    await context.close();
  }
});
