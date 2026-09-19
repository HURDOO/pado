import { test, expect, type Page } from '@playwright/test';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
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

test('native agent receives secret metadata only and runs a real app with the user supplied environment', async ({
  page,
}, info) => {
  const root = process.env.PADO_LIVE_DATA_DIR!;
  const workspace = resolve(root, 'workspace/secret-app');
  await mkdir(workspace, { recursive: true });
  await cp('tests/fixtures/secret-app', workspace, { recursive: true });
  const original = await readFile(resolve(workspace, 'server.mjs'), 'utf8');
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('시크릿 실행 검증');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await post(page, 'admin/login', { password: 'pado-live-test-only-password' });
  await post(page, 'admin/reset');
  try {
    await expect.poll(async () => (await screen(page)).text).toContain('for shortcuts');
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await page.getByLabel('Antigravity 터미널 입력').focus();
    await page.keyboard.insertText(
      'secret-app/server.mjs에 실행 환경을 검증할 작은 서버가 준비돼 있어. 파일을 수정하지 마. 먼저 presentation helper의 secrets 명령으로 설정된 변수 이름을 확인해줘. DEMO_API_KEY가 필요하니 native secret Input(id secret-live-key, title 시크릿 실행 연결, secret name DEMO_API_KEY)으로 입력받고 실제 응답을 wait로 기다려. 값 자체를 읽거나 출력하거나 파일에 복사하지 마. 설정되면 node /opt/pado/present.mjs serve secret-demo 3000 --cwd secret-app --secrets DEMO_API_KEY node server.mjs 로 실행하고 Browser를 보여줘. 입력 pane은 닫고 실행 성공 여부만 짧게 알려줘. 별도 위임은 하지 마.',
    );
    await page.keyboard.press('Enter');
    await expect
      .poll(async () =>
        (await state(page)).stage.panes.some((pane) => pane.secret?.name === 'DEMO_API_KEY'),
      )
      .toBe(true);
    const pane = (await state(page)).stage.panes.find(
      (pane) => pane.secret?.name === 'DEMO_API_KEY',
    )!;
    const secret = 'demo-only-' + randomUUID();
    await page.getByLabel('DEMO_API_KEY', { exact: true }).fill(secret);
    await page.screenshot({ path: info.outputPath('native-secret-input.png') });
    await page.getByRole('button', { name: '저장하고 계속' }).click();
    await expect
      .poll(async () =>
        (await state(page)).stage.panes.some((pane) => pane.kind === 'browser' && pane.server),
      )
      .toBe(true);
    await expect.poll(async () => (await state(page)).stage.turn).toBeNull();
    const result = await state(page);
    expect(result.stage.phase).toBe('idle');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(await screen(page))).not.toContain(secret);
    const app = result.stage.panes.find((pane) => pane.kind === 'browser' && pane.server)!;
    const frame = page.frameLocator(`iframe[title="${app.title}"]`);
    await expect(frame.getByRole('heading', { name: '실행 환경 연결 완료' })).toBeVisible();
    const signature = await frame
      .locator('body')
      .evaluate(async () => (await (await fetch('/proof')).json()).signature);
    expect(signature).toBe(
      createHmac('sha256', secret).update('pado-demo-challenge').digest('hex'),
    );
    const project = resolve(root, 'projects', result.workspace.activeId);
    expect(JSON.parse(await readFile(resolve(project, 'secrets.json'), 'utf8')).DEMO_API_KEY).toBe(
      secret,
    );
    const bridges = await readdir(resolve(project, 'tui'));
    const answers = await Promise.all(
      bridges.map(async (directory) => {
        try {
          return JSON.parse(
            await readFile(resolve(project, 'tui', directory, `${pane.id}.answer.json`), 'utf8'),
          );
        } catch {
          return null;
        }
      }),
    );
    expect(answers.filter(Boolean)).toEqual([{ name: 'DEMO_API_KEY', configured: 'true' }]);
    const savedCommand = await readFile(resolve(project, 'app.json'), 'utf8');
    expect(JSON.parse(savedCommand).secrets).toEqual(['DEMO_API_KEY']);
    expect(savedCommand).not.toContain(secret);
    expect(await readFile(resolve(workspace, 'server.mjs'), 'utf8')).toBe(original);
    await page.screenshot({ path: info.outputPath('native-secret-result.png') });
  } finally {
    await post(page, 'admin/stop');
  }
});
