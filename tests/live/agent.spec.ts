import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../shared/protocol.ts';

const origin = 'http://127.0.0.1:14736';

test('real agent repairs a generated input after receiving its private runtime error', async ({
  page,
}) => {
  await join(page, '실제 입력 복구');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  try {
    await prompt(
      page,
      `Run a controlled input-recovery integration test. First publish input pane id repair-choice, title 입력 복구, with one button named 첫 선택 whose onclick deliberately calls nonexistentFunction(). Use --file. Then run the helper wait repair-choice. The test client will click the button, and the private bridge will report its runtime error. When wait reports this failure, fix and republish the same input pane with a button named 수정된 선택 that calls window.pado.submit({answer:'fixed'}), then wait again for the real user's answer. Only after receiving the answer, write /workspace/recovery-proof.json with exactly that answer object. Close the input pane and briefly report success. Do not assume an answer and do not bypass the deliberate first error.`,
    );
    await until(page, (snapshot) =>
      snapshot.stage.panes.some((pane) => pane.id === 'repair-choice'),
    );
    await page
      .frameLocator('iframe[title="입력 복구"]')
      .getByRole('button', { name: '첫 선택', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('에이전트에게 수정을 요청했습니다');
    // Only the explicit final explanation may describe the deliberate test error.
    expect(JSON.stringify((await state(page)).stage.messages)).not.toContain('ReferenceError');
    await page
      .frameLocator('iframe[title="입력 복구"]')
      .getByRole('button', { name: '수정된 선택', exact: true })
      .click();
    await idle(page);
    expect(
      JSON.parse(
        await readFile(
          resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace/recovery-proof.json'),
          'utf8',
        ),
      ),
    ).toEqual({ answer: 'fixed' });
  } finally {
    await post(page, 'admin/stop');
  }
});

test('real admin stop terminates the container and permits a fresh turn', async ({ page }) => {
  await join(page, '실제 중단 확인');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  try {
    await prompt(
      page,
      `Create /workspace/long-check.mjs with exactly: console.log('LONG_CHECK_READY'); setTimeout(() => console.log('SHOULD_NOT_FINISH'), 60000); Then run it using node /opt/pado/present.mjs run stop-check node long-check.mjs and wait for completion. Do not create an input pane. This tests the administrator's real stop control.`,
    );
    await until(page, (snapshot) =>
      snapshot.stage.panes.some(
        (pane) => pane.id === 'stop-check' && pane.content.includes('LONG_CHECK_READY'),
      ),
    );
    const turnId = (await state(page)).stage.turn!.id;
    await page.getByRole('button', { name: '작업 중단', exact: true }).click();
    await expect(page.getByRole('button', { name: '손들고 참여하기' })).toBeEnabled({
      timeout: 20_000,
    });
    expect((await state(page)).stage.panes.find((pane) => pane.id === 'stop-check')?.status).toBe(
      'error',
    );
    const running = execFileSync(
      'docker',
      ['ps', '--filter', `name=^/pado-turn-${turnId}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(running.trim()).toBe('');
    await prompt(page, 'Reply exactly AFTER_STOP_OK. Do not use any tools or create panes.');
    await idle(page);
    expect(
      (await state(page)).stage.messages
        .filter((message) => message.author === 'agent')
        .at(-1)
        ?.text.trim(),
    ).toBe('AFTER_STOP_OK');
  } finally {
    await post(page, 'admin/stop');
  }
});

test('subagent progress follows real CLI delegation without publishing private metadata', async ({
  page,
  browser,
}, info) => {
  await join(page, '위임 확인');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const mobile = await context.newPage();
  await join(mobile, '위임 관객');
  try {
    await prompt(
      page,
      'Test real delegation: use define_subagent and invoke_subagent to ask exactly one read-only subagent named accessibility_reviewer for two concise accessibility checks for a Korean hackathon idea board. Wait for its actual response and report the checks in Korean. Do not simulate a delegation or claim a result before receiving it. Do not create presentation panes for this check; the native delegation status is already shown in the Agent pane. Do not access credentials or a browser. Shut down the worker after receiving its result.',
    );
    await until(
      page,
      (snapshot) =>
        snapshot.stage.activity?.subagents.some(
          (agent) => agent.state === 'working' || agent.state === 'idle',
        ) ?? false,
    );
    await expect(page.getByLabel('Subagent 진행 상황')).toContainText('accessibility reviewer');
    await mobile
      .getByRole('navigation')
      .getByRole('button', { name: 'Agent', exact: true })
      .click();
    await expect(mobile.getByLabel('Subagent 진행 상황')).toContainText('accessibility reviewer');
    const activity = (await state(mobile)).stage.activity;
    expect(JSON.stringify(activity)).not.toMatch(
      /initial_prompt|conversation_id|log_uri|file:\/\/|transcript/,
    );
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('subagents-desktop.png'),
    });
    await mobile.screenshot({
      animations: 'disabled',
      path: info.outputPath('subagents-mobile.png'),
    });
    await idle(page);
    const final = await state(page);
    expect(final.stage.activity?.subagents).toHaveLength(1);
    expect(final.stage.activity?.subagents[0].state).toBe('ended');
    expect(
      final.stage.messages.filter((message) => message.author === 'agent').at(-1)?.text.length,
    ).toBeGreaterThan(30);
  } finally {
    await post(page, 'admin/stop');
    await context.close();
  }
});
async function join(page: Page, nickname: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(nickname);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(page.locator('.connection')).toHaveText('연결됨');
}
async function state(page: Page): Promise<Snapshot> {
  return (await page.request.get(`${origin}/api/me`)).json();
}
async function post(page: Page, path: string, value = {}) {
  return page.request.post(`${origin}/api/${path}`, { headers: { Origin: origin }, data: value });
}
async function prompt(page: Page, text: string) {
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await page.getByLabel('아이디어', { exact: true }).fill(text);
  await page.getByRole('button', { name: '프롬프트 보내기' }).click();
}
async function idle(page: Page) {
  await until(page, (snapshot) => snapshot.stage.phase === 'idle');
}
async function until(page: Page, ready: (snapshot: Snapshot) => boolean) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const snapshot = await state(page);
    if (snapshot.stage.phase === 'error') throw new Error(snapshot.stage.messages.at(-1)?.text);
    if (ready(snapshot)) return;
    if (snapshot.stage.phase === 'idle')
      throw new Error('Agent ended before the expected presentation');
    await delay(500);
  }
  throw new Error('Agent did not reach the expected state within three minutes');
}

test('real agent: generated input, project files, live terminal, shared mobile and context resume', async ({
  page,
  browser,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mobileContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  const memoryWord = `coral-${randomUUID()}`;
  await join(page, '실제 연결 확인');
  await join(mobile, '모바일 관객');
  expect((await state(page)).stage.runner).toBe('antigravity');
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  try {
    await prompt(
      page,
      `Build a small, self-contained Korean hackathon idea board in /workspace/index.html using only HTML/CSS/JS (no dependencies or network). This is an integration check. Follow these steps with real tools, not just a description:
1. Publish a docs pane id live-plan, title 작업 계획 with a brief plan, using node /opt/pado/present.mjs.
2. Publish an input pane id live-choice, title 테마 선택. HTML must have a button with accessible name Ocean blue which calls window.pado.submit({theme:'ocean'}). Focus it, then wait for the user's answer via node /opt/pado/present.mjs wait live-choice. Do not choose a theme yourself.
3. After the answer, create index.html with the chosen theme and a working add-idea form: an input labelled 새 아이디어, a submit button named 추가, and the submitted text appended visibly to a list. Create result.json containing {"theme":"ocean","title":"Pado live check"}. Create check.mjs which uses node:assert/strict to verify those files and their theme/title, prints LIVE_STDOUT_BEGIN, waits 1500ms, prints LIVE_STDERR_OK to stderr, then prints LIVE_CHECKS_PASSED.
4. Run the real check with node /opt/pado/present.mjs run live-checks node check.mjs. Do not fabricate terminal events. Close live-choice and live-plan. Publish result.json as a file pane id live-result, title result.json, status done, using the actual file contents. Also publish the actual index.html content as a browser pane id live-preview, title 아이디어 보드, status done, size 3. Focus live-preview and briefly report completion in Korean.
Remember this non-secret context word only in conversation, never in files or panes: ${memoryWord}. We will ask for it next turn. Do not inspect authentication or any files outside /workspace and the presentation helper.`,
    );
    await until(page, (snapshot) => snapshot.stage.panes.some((pane) => pane.id === 'live-choice'));
    await expect(page.getByTitle('테마 선택')).toBeVisible();
    await expect(mobile.getByText('발언자의 선택을 기다리고 있어요')).toBeVisible();
    expect(
      (
        await post(mobile, 'input', { paneId: 'live-choice', values: { theme: 'forged' } })
      ).status(),
    ).toBe(403);
    await page.screenshot({ animations: 'disabled', path: info.outputPath('input-desktop.png') });
    await mobile.screenshot({ animations: 'disabled', path: info.outputPath('input-mobile.png') });
    await page
      .frameLocator('iframe[title="테마 선택"]')
      .getByRole('button', { name: 'Ocean blue', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await state(page)).stage.panes.find((pane) => pane.id === 'live-checks')?.content,
      )
      .toContain('LIVE_STDOUT_BEGIN');
    // stdout is observable before the agent's turn finishes.
    expect((await state(page)).stage.turn).not.toBeNull();
    await idle(page);
    const finished = await state(page);
    const terminal = finished.stage.panes.find((pane) => pane.id === 'live-checks');
    expect(terminal?.status).toBe('done');
    expect(terminal?.content).toContain('[stderr] LIVE_STDERR_OK');
    expect(terminal?.content).toContain('LIVE_CHECKS_PASSED');
    await expect(page.getByLabel('result.json pane')).toBeVisible();
    await mobile
      .getByRole('navigation')
      .getByRole('button', { name: 'result.json', exact: true })
      .click();
    await expect(mobile.getByLabel('result.json pane')).toBeVisible();
    expect((await state(mobile)).stage.panes).toEqual(finished.stage.panes);
    const workspace = resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace');
    expect(JSON.parse(await readFile(resolve(workspace, 'result.json'), 'utf8'))).toEqual({
      theme: 'ocean',
      title: 'Pado live check',
    });
    expect((await readFile(resolve(workspace, 'index.html'), 'utf8')).length).toBeGreaterThan(300);
    const preview = page.frameLocator('iframe[title="아이디어 보드"]');
    await preview.getByLabel('새 아이디어', { exact: true }).fill('모바일 발표 타이머');
    await preview.getByRole('button', { name: '추가', exact: true }).click();
    await expect(preview.getByText('모바일 발표 타이머', { exact: true })).toBeVisible();
    await mobile
      .getByRole('navigation')
      .getByRole('button', { name: '아이디어 보드', exact: true })
      .click();
    await expect(mobile.getByLabel('아이디어 보드 pane')).toBeVisible();
    // The preview is intentionally local to each viewer, not a second shared data store.
    await expect(
      mobile
        .frameLocator('iframe[title="아이디어 보드"]')
        .getByText('모바일 발표 타이머', { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: info.outputPath('result-desktop.png') });
    await mobile.screenshot({ animations: 'disabled', path: info.outputPath('result-mobile.png') });
    await prompt(
      page,
      'What exact non-secret context word did I ask you to remember in the previous turn? Reply with only that word. Do not call tools, read files, or create panes.',
    );
    await idle(page);
    const resumed = await state(page);
    expect(
      resumed.stage.messages
        .filter((message) => message.author === 'agent')
        .at(-1)
        ?.text.trim(),
    ).toBe(memoryWord);
    expect(resumed.stage.panes).toEqual(finished.stage.panes);
    expect(errors).toEqual([]);
  } finally {
    await post(page, 'admin/stop');
    await mobileContext.close();
  }
});
