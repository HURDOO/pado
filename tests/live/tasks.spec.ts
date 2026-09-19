import { test, expect, type Page } from '@playwright/test';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Snapshot, TuiFrame } from '../../shared/protocol.ts';
import { taskSummary } from '../../shared/tasks.ts';

const state = (page: Page): Promise<Snapshot> =>
  page.evaluate(async () => (await fetch('/api/me')).json());
const screen = (page: Page): Promise<TuiFrame> =>
  page.evaluate(async () => (await fetch('/api/tui/snapshot')).json());
async function post(page: Page, path: string, value: unknown = {}) {
  const result = await page.evaluate(
    async ({ path, value }) => {
      const response = await fetch('/api/' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, value },
  );
  expect(result.status).toBe(200);
  return result.body;
}
async function enter(page: Page, prompt: string) {
  await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-controller', 'true');
  await page.getByLabel('Antigravity 터미널 입력').focus();
  await page.keyboard.insertText(prompt);
  await page.keyboard.press('Enter');
  await expect.poll(async () => !!(await state(page)).stage.turn).toBe(true);
  await expect.poll(async () => (await state(page)).stage.turn, { timeout: 180000 }).toBe(null);
}

test('native agent selects Tasks for work review, updates same pane and skips incidental work mention', async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const workspace = resolve(process.env.PADO_LIVE_DATA_DIR!, 'workspace/hackathon-ops');
  await mkdir(workspace, { recursive: true });
  for (const file of ['PROJECT_BRIEF.md', 'AGENTS.md', 'README.md', 'docs'])
    await cp(resolve('examples/hackathon-ops', file), resolve(workspace, file), {
      recursive: true,
    });
  const tasksFile = resolve(workspace, 'docs/TASKS.md');
  const original = await readFile(tasksFile, 'utf8');
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('작업 판단 검증');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  try {
    await enter(
      page,
      'hackathon-ops의 작업 목록을 보고 완료한 일과 남은 일, 보류한 일을 보여줘. 다음 작업이 지정되어 있는지도 확인해줘. 아직 문서를 수정하거나 구현하지 마.',
    );
    const first = (await state(page)).stage;
    const task = first.panes.find((pane) => pane.kind === 'tasks');
    expect(task).toBeTruthy();
    expect(first.panes.filter((pane) => pane.kind === 'tasks')).toHaveLength(1);
    expect(
      first.panes.filter((pane) => ['docs', 'file', 'terminal', 'input'].includes(pane.kind)),
    ).toHaveLength(0);
    expect(taskSummary(task!.content).counts).toEqual(taskSummary(original).counts);
    expect(await readFile(tasksFile, 'utf8')).toBe(original);
    expect(first.focusId).toBe(task!.id);
    await expect(page.locator('.tasks-next-note').first()).toContainText('선택된 다음 작업 없음');
    await page.screenshot({ path: info.outputPath('tasks-native-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(`[data-pane-id="${task!.id}"]`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath('tasks-native-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 950 });

    await enter(
      page,
      '운영자가 답변하고 참가자가 답변을 확인하는 작업을 다음 할 일로 지정해줘. 실제 작업 문서와 보고 있던 목록만 갱신하고 구현은 시작하지 마. 보류 항목은 유지해.',
    );
    const updated = (await state(page)).stage.panes.filter((pane) => pane.kind === 'tasks');
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(task!.id);
    expect(taskSummary(updated[0].content).counts.next).toBe(1);
    const saved = await readFile(tasksFile, 'utf8');
    expect(saved).toMatch(/\[>\].*운영자가 답변/);
    expect(taskSummary(updated[0].content).counts).toEqual(taskSummary(saved).counts);
    expect(taskSummary(saved).counts.paused).toBe(1);

    await enter(
      page,
      '작업 얘기는 잠깐 멈추고 17 + 25가 얼마야? 숫자만 답해줘. 기존 작업 문서는 수정하지 마.',
    );
    const final = (await state(page)).stage.panes;
    expect(final).toHaveLength(0);
    expect(await readFile(tasksFile, 'utf8')).toBe(saved);
    expect((await screen(page)).text).toContain('42');
  } finally {
    await post(page, 'admin/reset');
  }
});
