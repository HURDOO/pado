import { test, expect, type Page } from '@playwright/test';
import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Snapshot, TuiFrame } from '../../shared/protocol.ts';

const state = (page: Page): Promise<Snapshot> =>
  page.evaluate(async () => (await fetch('/api/me')).json());
async function post(page: Page, path: string, data = {}) {
  const response = await page.request.post('/api/' + path, {
    headers: { Origin: new URL(page.url()).origin },
    data,
  });
  expect(response.status()).toBe(200);
}
async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(name);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
}
test('native waiting publishes real output before exit, keeps internal helper private and preserves mobile focus', async ({
  page,
  browser,
}, info) => {
  const workspace = resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace');
  await mkdir(workspace, { recursive: true });
  await cp('tests/fixtures/waiting-terminal', workspace, { recursive: true });
  await join(page, '명령 대기 검증');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  const mobileContext = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.PADO_LIVE_PORT || '14736'}`,
    viewport: { width: 320, height: 568 },
  });
  const mobile = await mobileContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  mobile.on('pageerror', (error) => errors.push(error.message));
  try {
    await join(mobile, '명령 관객');
    await expect
      .poll(async () =>
        ((await page.request.get('/api/tui/snapshot')).json() as Promise<TuiFrame>).then(
          (v) => v.text,
        ),
      )
      .toContain('for shortcuts');
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await page.getByLabel('Antigravity 터미널 입력').focus();
    await page.keyboard.insertText(
      '준비된 실행 두 개만 순서대로 확인해. 파일을 읽거나 수정하거나 서버를 열지 마. 첫째 내부 확인: node /opt/pado/present.mjs exec private-inspect --quiet node internal.mjs . 둘째 테스트: node /opt/pado/present.mjs exec wait-check node check.mjs . 각각 별도 run_command로 실행하고 Cwd는 /workspace, WaitMsBeforeAsync는 20000으로 설정해서 명령 결과를 기다려. 두 번째 명령에는 --quiet나 --show를 붙이지 마. 테스트가 끝나면 한 문장으로 결과만 알려줘. 다른 명령이나 pane 생성은 하지 마.',
    );
    await page.keyboard.press('Enter');
    await expect
      .poll(
        async () =>
          (await state(page)).stage.panes.find((p) => p.id === 'wait-check-logs')?.content,
        { timeout: 180000, intervals: [100, 200] },
      )
      .toContain('WAIT_CHECK_STARTED');
    const running = (await state(page)).stage;
    const pane = running.panes.find((p) => p.id === 'wait-check-logs')!;
    expect(pane.terminal?.finishedAt).toBeUndefined();
    expect(pane.status).toBe('active');
    expect(pane.content).not.toContain('WAIT_CHECK_TICK_4');
    expect(pane.terminal?.command).toEqual(['node', 'check.mjs']);
    expect(running.focusId).toBe('agent');
    expect(running.panes.some((p) => p.id === 'private-inspect-logs')).toBe(false);
    expect(JSON.stringify(running.panes)).not.toContain('PRIVATE_INTERNAL');
    await expect(page.getByLabel('앱 환경 명령 pane', { exact: true })).toBeVisible();
    await expect(
      mobile
        .getByRole('navigation', { name: 'Workspace pane 전환' })
        .getByRole('button', { name: 'Agent', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: info.outputPath('waiting-desktop.png'), animations: 'disabled' });
    await mobile
      .getByRole('navigation', { name: 'Workspace pane 전환' })
      .getByRole('button', { name: '앱 환경 명령', exact: true })
      .click();
    await expect(mobile.getByLabel('실행 명령')).toContainText('node check.mjs');
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await mobile.screenshot({
      path: info.outputPath('waiting-mobile.png'),
      animations: 'disabled',
    });
    await expect
      .poll(
        async () =>
          (await state(page)).stage.panes.find((p) => p.id === 'wait-check-logs')?.terminal?.code,
      )
      .toBe(0);
    await expect.poll(async () => (await state(page)).stage.turn).toBeNull();
    expect(
      (await state(page)).stage.panes.find((p) => p.id === 'wait-check-logs')?.content,
    ).toContain('WAIT_CHECK_PASSED');
    expect(errors).toEqual([]);
  } finally {
    await post(page, 'admin/stop');
    await mobileContext.close();
  }
});
