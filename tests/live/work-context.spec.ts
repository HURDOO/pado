import { test, expect, type Page } from '@playwright/test';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Snapshot, TuiFrame } from '../../shared/protocol.ts';

const state = (page: Page): Promise<Snapshot> =>
  page.evaluate(async () => (await fetch('/api/me')).json());
const screen = (page: Page): Promise<TuiFrame> =>
  page.evaluate(async () => (await fetch('/api/tui/snapshot')).json());
async function post(page: Page, path: string, value = {}) {
  const status = await page.evaluate(
    async ({ path, value }) => {
      const response = await fetch('/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      return response.status;
    },
    { path, value },
  );
  expect(status).toBe(200);
}

test('native agent publishes sourced working criteria before implementation and hands them into a verified Review', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(480000);
  const workspace = resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace/context-app');
  await mkdir(workspace, { recursive: true });
  await cp('tests/fixtures/context-app', workspace, { recursive: true });
  const originalPolicy = await readFile(resolve(workspace, 'POLICY.md'), 'utf8');
  const originalTest = await readFile(resolve(workspace, 'policy.test.mjs'), 'utf8');
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('작업 기준 실연동');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  const mobileContext = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.PADO_LIVE_PORT || '14736'}`,
    viewport: { width: 390, height: 844 },
  });
  const mobile = await mobileContext.newPage();
  try {
    await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await page.getByLabel('Antigravity 터미널 입력').focus();
    await page.keyboard.insertText(
      'context-app의 답변 최대 개수를 정해서 반영하자. POLICY.md를 읽고 기존 공개 범위 계약을 유지해줘. 최대 개수는 2개와 3개 중 내가 먼저 고르게 해줘. 간단한 Input에서 maxReplies 필드로 2 또는 3을 받고 실제 선택 전에는 프로젝트 파일을 수정하지 마. 선택을 받으면 settings.json의 maxReplies만 숫자로 변경해. POLICY.md와 policy.test.mjs는 수정하지 마. 그 뒤 앱 컨테이너에서 node --test policy.test.mjs를 실행하고, 무엇을 바꿨고 무엇을 확인했는지 검토할 수 있게 해줘. 브라우저 앱 실행이나 설치는 필요 없어.',
    );
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await state(page)).stage.phase, { timeout: 180000 })
      .toBe('waiting');
    const waiting = (await state(page)).stage;
    const context = waiting.panes.find((pane) => pane.kind === 'context')!;
    expect(context).toBeTruthy();
    expect(context.content).toContain('POLICY.md');
    expect(context.content).toMatch(/공개/);
    expect(context.content).not.toMatch(/^\|/m);
    expect(context.workContext?.state).toBe('working');
    expect(JSON.parse(await readFile(resolve(workspace, 'settings.json'), 'utf8')).maxReplies).toBe(
      1,
    );
    await mobile.goto('/');
    await mobile.getByLabel('어떻게 불러 드릴까요?').fill('기준 관객');
    await mobile.getByRole('button', { name: 'Stage 입장하기' }).click();
    await post(page, 'admin/present', { type: 'pane.focus', id: context.id });
    await expect(mobile.locator(`[data-pane-id="${context.id}"]`)).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('native-context-desktop.png'),
    });
    await mobile.screenshot({
      animations: 'disabled',
      path: info.outputPath('native-context-mobile.png'),
    });
    const input = waiting.panes.find((pane) => pane.kind === 'input')!;
    expect(input).toBeTruthy();
    await post(page, 'input', { paneId: input.id, values: { maxReplies: '3' } });
    await expect.poll(async () => (await state(page)).stage.turn, { timeout: 240000 }).toBe(null);
    const result = (await state(page)).stage;
    expect(result.phase).toBe('idle');
    const review = result.panes.find((pane) => pane.kind === 'review')!;
    expect(review).toBeTruthy();
    expect(result.panes.filter((pane) => pane.kind === 'context')).toHaveLength(0);
    expect(review.workContext?.turnId).toBe(context.workContext?.turnId);
    expect(review.workContext?.state).toBe('finished');
    expect(review.workContext?.content).toContain('POLICY.md');
    expect(review.workContext?.content).not.toBe(context.content);
    expect(review.workContext?.content).toMatch(
      /(?:선택|결정|확정)[^\n]*3|3[^\n]*(?:선택|결정|확정)/,
    );
    expect(
      review.review?.checks.some((check) => check.run?.code === 0 && check.status === 'passed'),
    ).toBe(true);
    expect(JSON.parse(await readFile(resolve(workspace, 'settings.json'), 'utf8'))).toEqual({
      maxReplies: 3,
      visibility: 'public',
    });
    expect(await readFile(resolve(workspace, 'POLICY.md'), 'utf8')).toBe(originalPolicy);
    expect(await readFile(resolve(workspace, 'policy.test.mjs'), 'utf8')).toBe(originalTest);
    await post(page, 'admin/present', { type: 'pane.focus', id: review.id });
    for (const p of [page, mobile]) {
      const pane = p.locator(`[data-pane-id="${review.id}"]`);
      await pane.getByText('이 작업의 기준 다시 보기', { exact: true }).click();
      await expect(pane.locator('.review-context')).toContainText('POLICY.md');
      expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('native-context-review-desktop.png'),
    });
    await mobile.screenshot({
      animations: 'disabled',
      path: info.outputPath('native-context-review-mobile.png'),
    });
  } finally {
    await post(page, 'admin/reset');
    await mobileContext.close();
  }
});
