import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../shared/protocol.ts';
const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
const post = (page: Page, path: string, data = {}, project?: string) =>
  page.request.post('/api/' + path, {
    headers: { Origin: origin, ...(project ? { 'X-Pado-Project': project } : {}) },
    data,
  });
async function join(page: Page, nickname: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(nickname);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
}
const choose = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: '프로젝트 목록' })
    .getByRole('button', { name, exact: true })
    .click();

test('three personal views keep separate streams, stay pinned across designation, and reject all inactive writes even for admins', async ({
  page,
  browser,
}, info) => {
  await join(page, '멀티 프로젝트 진행자');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const before: Snapshot = await (await page.request.get('/api/me')).json();
  const initial = before.workspace.projects.find(
    (project) => project.id === before.workspace.activeId,
  )!;
  const names = ['읽기 전용 보드', '읽기 전용 블로그'];
  for (const name of names)
    expect((await post(page, 'admin/projects', { name })).status()).toBe(200);
  const created: Snapshot = await (await page.request.get('/api/me')).json();
  const [board, blog] = names.map((name) =>
    created.workspace.projects.find((project) => project.name === name)!,
  );
  for (const project of [initial, board, blog]) {
    expect((await post(page, 'admin/projects/select', { id: project.id })).status()).toBe(200);
    expect(
      (
        await post(
          page,
          'admin/present',
          {
            type: 'pane.upsert',
            pane: {
              id: 'project-doc',
              kind: 'docs',
              title: `${project.name} 문서`,
              content: `${project.name} 전용 내용`,
            },
          },
          project.id,
        )
      ).status(),
    ).toBe(200);
    if (project.id === board.id)
      await post(
        page,
        'admin/present',
        {
          type: 'pane.upsert',
          pane: {
            id: 'board',
            kind: 'browser',
            title: '읽기 화면',
            content:
              '<h1>저장된 보드</h1><button onclick="this.textContent=\'변경됨\'">보드 수정</button>',
          },
        },
        project.id,
      );
  }
  await post(page, 'admin/projects/select', { id: initial.id });
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 850 },
  });
  const viewer = await context.newPage();
  const secondTab = await context.newPage();
  try {
    await join(viewer, '두 탭의 같은 관객');
    await secondTab.goto('/');
    await choose(viewer, board.name);
    await choose(secondTab, blog.name);
    await expect(viewer.getByLabel(`${board.name} 문서 pane`, { exact: true })).toBeVisible();
    await expect(secondTab.getByLabel(`${blog.name} 문서 pane`, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: initial.name, level: 1 })).toBeVisible();
    const frame = viewer.frameLocator('iframe[title="읽기 화면"]');
    await expect(frame.getByRole('button', { name: '보드 수정', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: '손들고 참여하기' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: '참여 프로젝트로 지정' })).toHaveCount(0);
    expect((await post(viewer, 'admin/projects/select', { id: board.id })).status()).toBe(403);
    const inactiveWrites: [string, object][] = [
      ['raise', {}],
      ['release', {}],
      ['prompt', { prompt: '차단되어야 함' }],
      ['tui/input', { data: 'unsafe\r' }],
      ['tui/resize', { cols: 80, rows: 24 }],
      ['input', { paneId: 'form', values: { choice: 'fake' } }],
      ['input/secret', { paneId: 'form', value: 'test-only-never-written' }],
      ['input/error', { paneId: 'form', message: 'fake' }],
      ['panes/add', { kind: 'terminal' }],
      ['panes/present', { type: 'pane.close', id: 'project-doc' }],
      ['admin/present', { type: 'pane.close', id: 'project-doc' }],
      ['admin/stop', {}],
      ['admin/reset', {}],
      ['admin/revoke', {}],
      ['admin/app/resume', {}],
    ];
    for (const actor of [page, viewer])
      for (const [path, body] of inactiveWrites)
        expect(
          (await post(actor, path, body, board.id)).status(),
          `${path} must be server-read-only`,
        ).toBe(403);
    expect((await page.request.get('/api/me?project=unknown')).status()).toBe(400);
    const snapshot: Snapshot = await (
      await viewer.request.get(`/api/me?project=${blog.id}`)
    ).json();
    expect(snapshot.workspace).toMatchObject({ activeId: initial.id, viewedId: blog.id });
    expect(snapshot.stage.panes[0].content).toBe(`${blog.name} 전용 내용`);

    await post(page, 'raise', {}, initial.id);
    await choose(page, blog.name);
    await expect(page.getByRole('button', { name: '참여 프로젝트로 지정' })).toBeDisabled();
    expect((await post(page, 'admin/projects/select', { id: board.id })).status()).toBe(409);
    await post(page, 'prompt', { prompt: '분리된 화면 검증' }, initial.id);
    const running: Snapshot = await (await page.request.get('/api/me')).json();
    expect(running.stage.turn).not.toBeNull();
    await viewer.reload();
    await expect(viewer.getByRole('heading', { name: board.name, level: 1 })).toBeVisible();
    const afterBrowse: Snapshot = await (await page.request.get('/api/me')).json();
    expect(afterBrowse.stage.turn?.id).toBe(running.stage.turn!.id);
    await post(page, 'admin/stop', {}, initial.id);
    await post(page, 'admin/projects/select', { id: board.id });
    await expect(viewer.getByRole('button', { name: '손들고 참여하기' })).toBeVisible();
    await expect(frame.getByRole('button', { name: '보드 수정' })).toBeEnabled();
    await expect(secondTab.getByRole('heading', { name: blog.name, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: blog.name, level: 1 })).toBeVisible();
    await expect(page.locator('.admin-toolbar')).toHaveCount(0);
    await post(
      page,
      'admin/present',
      { type: 'agent.message', text: '보드에만 보이는 새 응답' },
      board.id,
    );
    await expect(viewer.locator('.conversation')).toContainText('보드에만 보이는 새 응답');
    await expect(secondTab.locator('.conversation')).not.toContainText('보드에만 보이는 새 응답');
    await page.screenshot({
      path: info.outputPath('inactive-admin-desktop.png'),
      animations: 'disabled',
    });
    await secondTab.setViewportSize({ width: 390, height: 844 });
    await secondTab.reload();
    await expect(secondTab.getByRole('heading', { name: blog.name, level: 1 })).toBeVisible();
    await expect(secondTab.getByLabel('프로젝트', { exact: true })).toBeEnabled();
    await expect(secondTab.getByRole('button', { name: '손들고 참여하기' })).toHaveCount(0);
    expect(await secondTab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await secondTab.screenshot({
      path: info.outputPath('inactive-viewer-mobile.png'),
      animations: 'disabled',
    });
    await secondTab.getByRole('button', { name: '참여 프로젝트로 돌아가기' }).click();
    await expect(secondTab.getByRole('heading', { name: board.name, level: 1 })).toBeVisible();
  } finally {
    await post(page, 'admin/stop');
    await post(page, 'admin/revoke');
    await post(page, 'admin/projects/select', { id: initial.id });
    await post(page, 'admin/reset');
    await context.close();
  }
});
