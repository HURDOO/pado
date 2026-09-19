import { test, expect, type Page } from '@playwright/test';

const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
const post = (page: Page, path: string, data = {}) =>
  page.request.post('/api/' + path, { headers: { Origin: origin }, data });

async function join(page: Page, nickname: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(nickname);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
}

test('sidebar browsing is personal, designation is explicit, and long names work on mobile', async ({
  page,
  browser,
}, info) => {
  await join(page, '왼쪽 목록 진행자');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const original = await (await page.request.get('/api/me')).json();
  const active = original.workspace.projects.find(
    (project: { id: string }) => project.id === original.workspace.activeId,
  );
  const names = ['목록용 아이디어 보드', '긴프로젝트이름도빠짐없이읽고선택할수있는개발자블로그'];
  for (const name of names)
    expect((await post(page, 'admin/projects', { name })).status()).toBe(200);
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 800 },
  });
  const viewer = await context.newPage();
  let releaseSwitch: (() => void) | undefined;
  try {
    await join(viewer, '왼쪽 목록 관객');
    const projects = page.getByRole('navigation', { name: '프로젝트 목록' });
    const spectatorProjects = viewer.getByRole('navigation', { name: '프로젝트 목록' });
    await expect(projects.getByRole('button')).toHaveCount(original.workspace.projects.length + 2);
    for (const name of [active.name, ...names]) {
      await expect(projects.getByRole('button', { name, exact: true })).toBeVisible();
      await expect(spectatorProjects.getByRole('button', { name, exact: true })).toBeEnabled();
    }
    await expect(page.getByLabel('프로젝트', { exact: true })).toBeHidden();
    await expect(viewer.getByRole('button', { name: '새 프로젝트', exact: true })).toHaveCount(0);
    await page.route('**/api/admin/projects/select', async (route) => {
      await new Promise<void>((resolve) => {
        releaseSwitch = resolve;
      });
      await route.continue();
    });
    await projects.getByRole('button', { name: names[0], exact: true }).click();
    await expect(page.getByRole('heading', { name: names[0], level: 1 })).toBeVisible();
    await expect(viewer.getByRole('heading', { name: active.name, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '손들고 참여하기' })).toHaveCount(0);
    await page.getByRole('button', { name: '참여 프로젝트로 지정', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '참여 프로젝트로 지정', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: '새 프로젝트', exact: true })).toBeDisabled();
    await expect.poll(() => !!releaseSwitch).toBe(true);
    releaseSwitch!();
    await expect(viewer.getByRole('heading', { name: names[0], level: 1 })).toBeVisible();
    await page.unroute('**/api/admin/projects/select');
    await expect(projects.getByRole('button', { name: names[0], exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      spectatorProjects.getByRole('button', { name: names[0], exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      projects.getByRole('button', { name: active.name, exact: true }),
    ).not.toHaveAttribute('aria-current');

    await page.setViewportSize({ width: 1000, height: 720 });
    const longProject = projects.getByRole('button', { name: names[1], exact: true });
    expect(await longProject.evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(
      true,
    );
    await longProject.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: names[1], level: 1 })).toBeVisible();
    await expect(viewer.getByRole('heading', { name: names[0], level: 1 })).toBeVisible();
    await expect(longProject).toHaveAttribute('aria-current', 'page');
    await page.screenshot({
      path: info.outputPath('sidebar-long-name-desktop.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: '새 프로젝트', exact: true }).click();
    await expect(page.getByLabel('새 프로젝트 이름', { exact: true })).toBeFocused();
    await page.getByRole('button', { name: '취소', exact: true }).click();

    for (const width of [850, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(projects).toBeHidden();
      const select = page.getByLabel('프로젝트', { exact: true });
      await expect(select).toBeVisible();
      await expect(select).toBeEnabled();
      await select.selectOption(active.id);
      await expect(page.getByRole('heading', { name: active.name, level: 1 })).toBeVisible();
      await expect(viewer.getByRole('heading', { name: names[0], level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.screenshot({
        path: info.outputPath(`project-selector-${width}.png`),
        animations: 'disabled',
      });
    }
    await page.reload();
    await expect(page.getByLabel('프로젝트', { exact: true })).toHaveValue(active.id);
  } finally {
    releaseSwitch?.();
    await page.unroute('**/api/admin/projects/select');
    await post(page, 'admin/projects/select', { id: active.id });
    await context.close();
  }
});
