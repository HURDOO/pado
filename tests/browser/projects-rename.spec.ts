import { test, expect, type Page } from '@playwright/test';
const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
async function post(page: Page, path: string, data = {}) {
  return page.request.post('/api/' + path, { headers: { Origin: origin }, data });
}
test('only admins rename shared projects without moving or replacing their workspace', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('이름 변경');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  const original = await (await page.request.get('/api/me')).json();
  const active = original.workspace.projects.find(
    (project: { id: string }) => project.id === original.workspace.activeId,
  );
  const context = await browser.newContext({ baseURL: origin });
  const viewer = await context.newPage();
  try {
    await viewer.goto('/');
    await viewer.getByLabel('어떻게 불러 드릴까요?').fill('함께 보는 사람');
    await viewer.getByRole('button', { name: 'Stage 입장하기' }).click();
    expect(
      (await post(viewer, 'admin/projects/rename', { id: active.id, name: '무단 변경' })).status(),
    ).toBe(403);
    expect(
      (
        await post(page, 'admin/projects/rename', { id: active.id, name: '해커톤 데스크' })
      ).status(),
    ).toBe(200);
    await expect(viewer.getByRole('heading', { name: '해커톤 데스크' })).toBeVisible();
    expect((await (await page.request.get('/api/me')).json()).workspace.activeId).toBe(active.id);
    expect((await (await page.request.get('/api/me')).json()).stage.panes).toEqual(
      original.stage.panes,
    );
    expect(
      (await post(page, 'admin/projects/rename', { id: active.id, name: 'bad\nname' })).status(),
    ).toBe(400);
  } finally {
    await post(page, 'admin/projects/rename', { id: active.id, name: active.name });
    await context.close();
  }
});
