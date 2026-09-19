import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Snapshot, TuiFrame } from '../../shared/protocol.ts';

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
      return { status: response.status, data: await response.json() };
    },
    { path, value },
  );
  expect(result.status).toBe(200);
  return result.data as Snapshot;
}
async function enter(page: Page, prompt: string) {
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-controller', 'true');
  await page.getByLabel('Antigravity 터미널 입력').focus();
  await page.keyboard.insertText(prompt);
  await page.keyboard.press('Enter');
  await expect.poll(async () => !!(await state(page)).stage.turn).toBe(true);
  await expect.poll(async () => (await state(page)).stage.turn, { timeout: 180000 }).toBe(null);
}
async function fixture(path: string, label: string) {
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, `${label}-only.txt`), label);
  await writeFile(
    resolve(path, 'TASKS.md'),
    `# ${label} 작업\n\n- [x] 앱 준비\n- [>] 사용자 검토\n`,
  );
  await writeFile(
    resolve(path, 'server.mjs'),
    `import { createServer } from 'node:http';\ncreateServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Project ${label}</h1><p>Real isolated server</p>')}).listen(3000,'0.0.0.0');\n`,
  );
}
test('native projects separate mounts/conversations/origins and restore app and meaningful panes', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(600000);
  const root = process.env.PADO_LIVE_DATA_DIR!;
  const a = resolve(root, 'workspace');
  await fixture(a, 'A');
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('프로젝트 통합 검증');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.PADO_LIVE_PORT || '14736'}`,
    viewport: { width: 390, height: 844 },
  });
  const viewer = await context.newPage();
  await viewer.goto('/');
  await viewer.getByLabel('어떻게 불러 드릴까요?').fill('프로젝트 모바일');
  await viewer.getByRole('button', { name: 'Stage 입장하기' }).click();
  try {
    await enter(
      page,
      '대화 표식은 BLUE-TIDE-729야. 지금은 기억만 하고 파일에 적지 마. 준비된 /workspace/server.mjs는 수정하지 말고 node /opt/pado/present.mjs serve app 3000 --quiet node server.mjs 로 실행해줘. 실제 TASKS.md 작업 목록도 Tasks로 보여줘. Browser를 가장 크게 맨 앞에 두고 Tasks는 작게, 그 외 창은 필요 없어.',
    );
    const first = (await state(page)).stage;
    expect(first.panes.filter((pane) => pane.kind === 'browser')).toHaveLength(1);
    const taskId = first.panes.find((pane) => pane.kind === 'tasks')!.id;
    const browserId = first.panes.find((pane) => pane.kind === 'browser')!.id;
    expect(first.focusId).toBe(browserId);
    const app = page.frameLocator(`[data-pane-id="${browserId}"] iframe`);
    await expect(app.getByRole('heading', { name: 'Project A' })).toBeVisible();
    const aUrl = await page.locator(`[data-pane-id="${browserId}"] iframe`).getAttribute('src');
    const aConversation = JSON.parse(
      await readFile(resolve(root, 'projects/default/conversation.json'), 'utf8'),
    ).id;
    const created = await post(page, 'admin/projects', { name: 'Project B' });
    const bId = created.workspace.projects.find((project) => project.name === 'Project B')!.id;
    const b = resolve(root, 'projects', bId, 'workspace');
    await fixture(b, 'B');
    await post(page, 'admin/projects/select', { id: bId });
    await expect(viewer.getByRole('heading', { name: 'Project B' })).toBeVisible();
    expect((await state(page)).stage.panes).toHaveLength(0);
    await enter(
      page,
      '대화 표식은 GREEN-LEAF-416야. 지금은 기억만 하고 파일에 적지 마. /workspace/server.mjs는 수정하지 말고 node /opt/pado/present.mjs serve app 3000 --quiet node server.mjs 로 실행해줘. Browser만 보여줘.',
    );
    await expect(
      page.frameLocator('.browser-pane iframe').getByRole('heading', { name: 'Project B' }),
    ).toBeVisible();
    const bUrl = await page.locator('.browser-pane iframe').getAttribute('src');
    expect(new URL(aUrl!).origin).not.toBe(new URL(bUrl!).origin);
    const bConversation = JSON.parse(
      await readFile(resolve(root, 'projects', bId, 'conversation.json'), 'utf8'),
    ).id;
    expect(aConversation).not.toBe(bConversation);
    await expect(readFile(resolve(b, 'A-only.txt'))).rejects.toThrow();
    await expect(readFile(resolve(a, 'B-only.txt'))).rejects.toThrow();
    await post(page, 'admin/projects/select', { id: 'default' });
    await expect(app.getByRole('heading', { name: 'Project A' })).toBeVisible();
    await expect(
      viewer
        .frameLocator(`[data-pane-id="${browserId}"] iframe`)
        .getByRole('heading', { name: 'Project A' }),
    ).toBeVisible();
    await enter(
      page,
      '이 프로젝트의 이전 대화에서만 알려준 대화 표식을 recall.txt에 정확히 적어줘. 원본 TASKS.md는 수정하지 마. 작업 목록을 다시 읽어 같은 Tasks pane을 크게 맨 앞으로 보여줘. 앱을 변경하거나 다시 실행하지 마. 다른 창은 필요 없어.',
    );
    expect((await readFile(resolve(a, 'recall.txt'), 'utf8')).trim()).toBe('BLUE-TIDE-729');
    expect(
      JSON.parse(await readFile(resolve(root, 'projects/default/conversation.json'), 'utf8')).id,
    ).toBe(aConversation);
    const final = (await state(page)).stage;
    expect(final.panes).toHaveLength(1);
    expect(final.panes[0].id).toBe(taskId);
    expect(final.focusId).toBe(taskId);
    expect(final.panes[0].size).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: info.outputPath('projects-native-desktop.png') });
    await viewer.screenshot({ path: info.outputPath('projects-native-mobile.png') });
    // Hiding at turn start did not stop the app; an explicit show restores the same live result.
    await post(page, 'admin/present', { type: 'pane.show', id: browserId, size: 3 });
    await expect(app.getByRole('heading', { name: 'Project A' })).toBeVisible();
    expect(await readFile(resolve(a, 'A-only.txt'), 'utf8')).toBe('A');
    await expect(readFile(resolve(b, 'recall.txt'))).rejects.toThrow();
  } finally {
    await post(page, 'admin/stop');
    await context.close();
  }
});
