import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Snapshot, TuiFrame } from '../../shared/protocol.ts';

async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(name);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-connected', 'true');
}
async function post(page: Page, path: string, value: unknown = {}) {
  return page.evaluate(
    async ({ path, value }) => {
      const result = await fetch('/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      return { status: result.status, body: await result.json() };
    },
    { path, value },
  );
}
async function screen(page: Page): Promise<TuiFrame> {
  return page.evaluate(async () => (await fetch('/api/tui/snapshot')).json());
}
async function state(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => (await fetch('/api/me')).json());
}
async function enter(page: Page, text: string) {
  await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-controller', 'true');
  const input = page.getByLabel('Antigravity 터미널 입력');
  await input.focus();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
  await expect.poll(async () => !!(await state(page)).stage.turn).toBe(true);
}

test('native subagent invocation opens a shared pane and completion closes it after three seconds', async ({
  page,
  browser,
}, info) => {
  const workspace = resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeFile(
    resolve(workspace, 'subagent-log-check.mjs'),
    'console.log("SUBAGENT_LOG_BEFORE");\n',
  );
  await join(page, 'Subagent 검증');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  const viewerContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const viewer = await viewerContext.newPage();
  await join(viewer, 'Subagent 관객');
  await page.evaluate(() => {
    const evidence = { maximum: 0, outputs: [] as string[], paneIds: [] as string[] };
    Object.assign(window, { subagentEvidence: evidence });
    const source = new EventSource('/api/events');
    source.addEventListener('state', (event) => {
      const panes = JSON.parse(event.data).stage.panes.filter(
        (pane: { kind: string }) => pane.kind === 'subagent',
      );
      evidence.maximum = Math.max(evidence.maximum, panes.length);
      for (const pane of panes) {
        if (!evidence.paneIds.includes(pane.id)) evidence.paneIds.push(pane.id);
        if (pane.subagent?.output) evidence.outputs.push(pane.subagent.output);
      }
    });
  });
  try {
    await enter(
      page,
      'Use invoke_subagent with Type self to delegate exactly one task (do not define a custom agent): use view_file to read /workspace/subagent-log-check.mjs, then replace_file_content to change SUBAGENT_LOG_BEFORE to SUBAGENT_TUI_REAL. Send exactly one short interim progress report with send_message BEFORE running the command. Next run exactly node /opt/pado/present.mjs exec subagent-log-check --quiet node subagent-log-check.mjs with run_command (the helper runs in the credential-free app container). Finally return the actual result and three concrete keyboard accessibility checks in Korean as the final response, NOT via another send_message call. Use clear toolSummary descriptions. Do not inspect credentials or private runtime files. The parent must wait for the final child response, not the interim message, before summarizing. Do not simulate delegation or call a second child. Do not create presentation panes; Pado automatically shows subagent panes.',
    );
    await expect(page.locator('.subagent-pane')).toBeVisible({ timeout: 120_000 });
    await expect(viewer.locator('.subagent-pane')).toBeVisible();
    const active = (await state(page)).stage.panes.find((pane) => pane.kind === 'subagent')!;
    expect(active.subagent?.state).toMatch(/starting|working/);
    expect(active.content).toBe('');
    await expect(page.locator('.subagent-pane .xterm')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await state(page)).stage.panes.find((pane) => pane.id === active.id)?.subagent?.closeAt,
        { timeout: 120_000, intervals: [100] },
      )
      .toBeTruthy();
    const completed = (await state(page)).stage.panes.find((pane) => pane.id === active.id)!;
    expect(completed.subagent!.closeAt! - completed.subagent!.finishedAt!).toBe(3000);
    expect(completed.subagent?.state).toMatch(/idle|ended/);
    await expect
      .poll(
        async () =>
          (await state(page)).stage.panes.find((pane) => pane.id === active.id)?.subagent?.output,
        { intervals: [100] },
      )
      .toContain('SUBAGENT_TUI_REAL');
    await page.screenshot({ path: info.outputPath('subagent-native-desktop.png') });
    await viewer.screenshot({ path: info.outputPath('subagent-native-mobile.png') });
    await expect(page.locator(`[data-pane-id="${active.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-pane-id="${active.id}"]`)).toHaveCount(0, { timeout: 5000 });
    await expect(viewer.locator(`[data-pane-id="${active.id}"]`)).toHaveCount(0, { timeout: 5000 });
    await expect.poll(async () => (await state(page)).stage.turn).toBeNull();
    const evidence = await page.evaluate(
      () =>
        (
          window as unknown as {
            subagentEvidence: { maximum: number; paneIds: string[]; outputs: string[] };
          }
        ).subagentEvidence,
    );
    expect(evidence.maximum).toBe(1);
    expect(evidence.paneIds).toEqual([active.id]);
    expect(evidence.outputs.some((output) => output.includes('SUBAGENT_TUI_REAL'))).toBe(true);
    const logs = evidence.outputs.join('\n');
    expect(logs).toContain('READ  subagent-log-check.mjs');
    expect(logs).toContain('EDIT  subagent-log-check.mjs');
    expect(logs).toContain('diff 발췌');
    expect(logs).toContain('RUN');
    expect(logs).toContain('종료 코드 0');
    expect(logs).toContain('MESSAGE');
    expect(logs).not.toMatch(/Created At:|\.system_generated|thinking|\/home\/node\//);
    expect(await readFile(resolve(workspace, 'subagent-log-check.mjs'), 'utf8')).toContain(
      'SUBAGENT_TUI_REAL',
    );
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    // Regression: continuing the existing child in a later user turn does not
    // change its spawnStepIndex. The live pane must still receive fresh output.
    const root = resolve(process.env.PADO_LIVE_DATA_DIR!, 'projects/default');
    const parent = JSON.parse(await readFile(resolve(root, 'conversation.json'), 'utf8')).id;
    const metadata = resolve(root, 'cli/brain', parent, '.system_generated/subagents');
    const childrenBefore = await readdir(metadata);
    expect(childrenBefore).toHaveLength(1);
    await writeFile(resolve(workspace, 'resumed-log-check.txt'), '후속 작업용 공개 테스트 파일\n');
    await page.evaluate(() => {
      const evidence = (
        window as unknown as {
          subagentEvidence: { maximum: number; outputs: string[]; paneIds: string[] };
        }
      ).subagentEvidence;
      evidence.maximum = 0;
      evidence.outputs = [];
      evidence.paneIds = [];
    });
    await enter(
      page,
      'Continue the SAME existing subagent using send_message, without invoke_subagent or creating a new agent. Ask it to use view_file on /workspace/resumed-log-check.txt with toolSummary RESUMED_READ, then list_dir on /workspace, and finally respond exactly RESUMED_CHILD_LOG_OK. No changes, shell commands or presentation panes. The parent must wait for the final child response before answering. Do not repeat any previous task output.',
    );
    await expect(page.locator('.subagent-pane')).toBeVisible({ timeout: 120_000 });
    const resumed = (await state(page)).stage.panes.find((pane) => pane.kind === 'subagent')!;
    await expect
      .poll(
        async () =>
          (await state(page)).stage.panes.find((pane) => pane.id === resumed.id)?.subagent?.output,
        { intervals: [100], timeout: 30_000 },
      )
      .toContain('READ  resumed-log-check.txt');
    await expect(page.locator('.subagent-pane .xterm-accessibility-tree')).toContainText(
      'resumed-log-check.txt',
    );
    await expect(viewer.locator('.subagent-pane .xterm-accessibility-tree')).toContainText(
      'resumed-log-check.txt',
    );
    await page.screenshot({ path: info.outputPath('subagent-resumed-desktop.png') });
    await viewer.screenshot({ path: info.outputPath('subagent-resumed-mobile.png') });
    await expect.poll(async () => (await state(page)).stage.turn).toBeNull();
    await expect(page.locator('.subagent-pane')).toHaveCount(0, { timeout: 5000 });
    const resumedEvidence = await page.evaluate(
      () =>
        (
          window as unknown as {
            subagentEvidence: { maximum: number; outputs: string[]; paneIds: string[] };
          }
        ).subagentEvidence,
    );
    expect(resumedEvidence.maximum).toBe(1);
    expect(resumedEvidence.paneIds).toEqual([resumed.id]);
    const resumedLogs = resumedEvidence.outputs.join('\n');
    expect(resumedLogs).toContain('RESUMED_READ');
    expect(resumedLogs).toContain('RESUMED_CHILD_LOG_OK');
    expect(resumedLogs).not.toContain('SUBAGENT_TUI_REAL');
    expect(await readdir(metadata)).toEqual(childrenBefore);
  } finally {
    await post(page, 'admin/stop');
    await viewerContext.close();
  }
});

test('real native TUI, shared viewing, slash menus, reconnect, input permissions and mobile typing', async ({
  page,
  browser,
}, info) => {
  await join(page, 'TUI 조작자');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  const viewerContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:14736',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const viewer = await viewerContext.newPage();
  await join(viewer, 'TUI 관객');
  try {
    expect(await page.locator('#prompt').count()).toBe(0);
    expect((await post(viewer, 'tui/input', { data: 'FORBIDDEN\r' })).status).toBe(403);
    expect((await post(viewer, 'tui/resize', { cols: 60, rows: 20 })).status).toBe(403);
    expect((await post(page, 'prompt', { prompt: 'old chat' })).status).toBe(400);
    await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute(
      'data-controller',
      'true',
    );
    await page.getByLabel('Antigravity 터미널 입력').focus();
    await page.keyboard.insertText('/model');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await screen(viewer)).text).toMatch(/Switch Model/i);
    await page.screenshot({ path: info.outputPath('native-model-menu.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+u');
    await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
    await post(page, 'release');
    await enter(page, 'Reply exactly NATIVE_TUI_OK. Do not use tools or create panes.');
    await expect.poll(async () => (await screen(viewer)).text).toMatch(/\n\s*NATIVE_TUI_OK\s*\n/);
    await expect.poll(async () => (await state(page)).stage.turn).toBe(null);
    expect((await state(page)).stage.panes).toHaveLength(0);
    await page.screenshot({ path: info.outputPath('native-desktop.png') });
    await viewer.reload();
    await expect(viewer.getByLabel('Antigravity TUI 화면')).toHaveAttribute(
      'data-connected',
      'true',
    );
    await expect.poll(async () => (await screen(viewer)).text).toContain('NATIVE_TUI_OK');
    await viewer.screenshot({ path: info.outputPath('native-mobile-spectator.png') });
    await enter(viewer, '도구 없이 "한글 입력 성공"이라고만 답해 줘.');
    await expect.poll(async () => (await screen(page)).cols).toBeLessThan(60);
    await expect.poll(async () => (await screen(viewer)).text).toMatch(/\n\s*한글 입력 성공\s*\n/);
    await expect.poll(async () => (await state(viewer)).stage.turn).toBe(null);
    await viewer.screenshot({ path: info.outputPath('native-mobile-input.png') });
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
    await post(page, 'admin/stop');
    await viewerContext.close();
  }
});

test('native hooks drive real generated input, command output and admin stop/reset', async ({
  page,
}, info) => {
  await join(page, 'TUI 생성형 연결');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  try {
    await enter(
      page,
      `Run this Pado native-TUI integration test using the presentation helper. Publish input pane id native-choice, title 원본 TUI 선택, with one button named 파랑 선택 that calls window.pado.submit({color:'blue'}). Use --file and wait native-choice for the actual answer. Only after receiving it write /workspace/native-proof.json with exactly the answer object. Close native-choice. Then create native-check.mjs to read that JSON and print NATIVE_CHECK_BLUE if color equals blue, and execute it through node /opt/pado/present.mjs run native-check node native-check.mjs. Finish with a brief Korean result in this TUI.`,
    );
    await page
      .frameLocator('iframe[title="원본 TUI 선택"]')
      .getByRole('button', { name: '파랑 선택', exact: true })
      .click();
    await expect
      .poll(
        async () => (await state(page)).stage.panes.find((p) => p.id === 'native-check')?.content,
      )
      .toContain('NATIVE_CHECK_BLUE');
    await expect.poll(async () => (await state(page)).stage.turn).toBe(null);
    expect(
      JSON.parse(
        await readFile(
          resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace/native-proof.json'),
          'utf8',
        ),
      ),
    ).toEqual({ color: 'blue' });
    await page.screenshot({ path: info.outputPath('native-generative-workspace.png') });
    await enter(
      page,
      'Create native-slow.mjs containing console.log("NATIVE_LONG_READY"); setTimeout(() => console.log("SHOULD_NOT_FINISH"),60000); then run it using node /opt/pado/present.mjs run native-slow node native-slow.mjs and wait.',
    );
    await expect
      .poll(
        async () => (await state(page)).stage.panes.find((p) => p.id === 'native-slow')?.content,
      )
      .toContain('NATIVE_LONG_READY');
    expect((await post(page, 'admin/stop')).status).toBe(200);
    expect((await screen(page)).status).toBe('stopped');
    expect((await state(page)).stage.turn).toBe(null);
    expect((await state(page)).stage.panes.find((p) => p.id === 'native-slow')?.status).toBe(
      'error',
    );
    const oldEpoch = (await screen(page)).epoch;
    expect((await post(page, 'admin/reset')).status).toBe(200);
    expect((await screen(page)).epoch).not.toBe(oldEpoch);
    await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
    expect((await state(page)).stage.panes).toHaveLength(0);
  } finally {
    await post(page, 'admin/stop');
  }
});
