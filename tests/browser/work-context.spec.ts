import { test, expect, type Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Snapshot } from '../../shared/protocol.ts';

const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
async function post(page: Page, path: string, data = {}) {
  const request = () => page.request.post('/api/' + path, { headers: { Origin: origin }, data });
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
async function state(page: Page): Promise<Snapshot> {
  return (await page.request.get('/api/me')).json();
}
async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(name);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
}

test('Markdown criteria stay beside work, update without taking focus and become a Review with preserved sources', async ({
  page,
  browser,
}, info) => {
  await join(page, '기준 검토자');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const viewerContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const viewer = await viewerContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await join(viewer, '기준 관객');
    await post(page, 'raise');
    await post(page, 'prompt', { prompt: '작업 기준에서 검토까지 리허설' });
    await expect.poll(async () => (await state(page)).stage.phase).toBe('waiting');
    const pane = page.getByLabel('작업 기준 pane', { exact: true });
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('heading', { name: '이번 작업' })).toBeVisible();
    await expect(pane.getByRole('table')).toHaveCount(0);
    await expect(pane.getByText('작업 중 · 적용하는 기준')).toBeVisible();
    const event = {
      type: 'pane.upsert',
      pane: {
        id: 'work-context',
        kind: 'context',
        title: '작업 기준',
        content:
          '## 사용자 요청\n\n- 답변 기능을 추가합니다. 출처: 이번 요청.\n\n## 참고하는 합의·계약\n\n- 답변은 공개합니다. 출처: `docs/POLICY.md`.\n\n## 에이전트의 가정\n\n- 질문당 답변 하나로 해석했습니다. **사용자 미확인.**\n\n<script>window.contextUnsafe = true</script>',
      },
    };
    await viewer
      .getByRole('navigation')
      .getByRole('button', { name: 'Agent', exact: true })
      .click();
    const focusVersion = (await state(page)).stage.focusVersion;
    expect((await post(viewer, 'admin/present', event)).status()).toBe(403);
    expect((await post(page, 'admin/present', event)).status()).toBe(200);
    expect((await state(page)).stage.focusVersion).toBe(focusVersion);
    await expect(
      viewer.getByRole('navigation').getByRole('button', { name: 'Agent', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(pane.getByText('사용자 미확인.', { exact: true })).toBeVisible();
    expect(
      await pane
        .locator('.markdown li')
        .first()
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, fontSize: style.fontSize };
        }),
    ).toEqual({ color: 'rgb(224, 230, 239)', fontSize: '14px' });
    expect(await page.evaluate(() => 'contextUnsafe' in window)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: info.outputPath('context-desktop.png') });
    await viewer
      .getByRole('navigation')
      .getByRole('button', { name: /작업 기준/ })
      .click();
    const mobilePane = viewer.getByLabel('작업 기준 pane', { exact: true });
    await expect(mobilePane).toBeVisible();
    await expect(mobilePane.getByText('docs/POLICY.md', { exact: true })).toBeVisible();
    await viewer.screenshot({
      animations: 'disabled',
      path: info.outputPath('context-mobile.png'),
    });
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
    ]) {
      await viewer.setViewportSize(viewport);
      expect(await viewer.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
    const published = (await state(page)).stage.panes.find((item) => item.kind === 'context')!;
    expect(
      (await post(page, 'admin/present', { type: 'pane.upsert', pane: published })).status(),
    ).toBe(400);

    // This resumes the actual fixed runner, which publishes updated criteria, a real command and Review.
    expect(
      (await post(page, 'input', { paneId: 'direction', values: { theme: 'Midnight' } })).status(),
    ).toBe(200);
    await expect.poll(async () => (await state(page)).stage.phase).toBe('idle');
    const result = (await state(page)).stage.panes.find((item) => item.id === 'work-context')!;
    expect(result.kind).toBe('review');
    expect(result.workContext?.state).toBe('finished');
    expect(result.workContext?.content).toContain('Midnight');
    expect(result.workContext?.content).toContain('참가자의 Input 선택');
    expect(result.review?.checks[0].run?.code).toBe(0);
    for (const p of [page, viewer]) {
      const review = p.getByLabel('작업 검토 pane', { exact: true });
      await expect(review).toBeVisible();
      await review.getByText('이 작업의 기준 다시 보기', { exact: true }).click();
      await expect(review.getByText('이번에 결정한 내용', { exact: true })).toBeVisible();
      await expect(
        review.locator('.review-context').getByText('Midnight', { exact: true }),
      ).toBeVisible();
      await expect(review.getByLabel('검증 현황')).toHaveText('통과 1실패 0미검증 0');
    }
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('context-review-desktop.png'),
    });
    await viewer.screenshot({
      animations: 'disabled',
      path: info.outputPath('context-review-mobile.png'),
    });
    await viewer.reload();
    await expect(viewer.getByLabel('작업 검토 pane', { exact: true })).toBeVisible();
    expect(
      (await state(viewer)).stage.panes.find((item) => item.id === 'work-context')?.workContext,
    ).toEqual(result.workContext);

    // New work starts with new criteria. Stopping it must never fabricate a successful Review.
    await post(page, 'raise');
    await post(page, 'prompt', { prompt: '중단하는 다음 작업' });
    await expect.poll(async () => (await state(page)).stage.phase).toBe('waiting');
    const next = (await state(page)).stage.panes.find((item) => item.kind === 'context')!;
    expect(next.workContext?.turnId).not.toBe(result.workContext?.turnId);
    expect(next.content).not.toContain('Midnight');
    await post(page, 'admin/stop');
    await post(page, 'admin/present', { type: 'pane.focus', id: 'work-context' });
    await expect(viewer.getByText('작업 중단 · 마지막 기준')).toBeVisible();
    expect((await state(page)).stage.panes.some((item) => item.kind === 'review')).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await post(page, 'admin/reset');
    await viewerContext.close();
  }
});
