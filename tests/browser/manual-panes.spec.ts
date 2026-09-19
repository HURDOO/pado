import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../shared/protocol.ts';

const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
const post = (page: Page, path: string, data = {}) =>
  page.request.post(`/api/${path}`, { headers: { Origin: origin }, data });
test('pane menu restores shared artifacts and the server enforces the speaker lease', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('수동 pane 검증');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(page.getByRole('button', { name: 'pane 추가', exact: true })).toBeVisible();
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  await post(page, 'admin/present', {
    type: 'pane.upsert',
    pane: {
      id: 'manual-doc',
      kind: 'docs',
      title: '프로젝트 안내',
      content: '# 함께 볼 문서\n공유된 내용입니다.',
    },
  });
  await post(page, 'admin/present', { type: 'pane.close', id: 'manual-doc' });
  await post(page, 'admin/logout');
  expect(
    (await post(page, 'panes/add', { kind: 'saved', id: 'manual-doc', admin: true })).status(),
  ).toBe(403);
  await page.getByRole('button', { name: 'pane 추가', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'pane 추가 메뉴' });
  await expect(menu.getByRole('button', { name: /프로젝트 안내/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'pane 추가', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '손들고 참여하기', exact: true }).click();
  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'pane 추가', exact: true }).click();
    await expect(menu.getByRole('button', { name: /프로젝트 안내/ })).toBeEnabled();
    await expect(menu.getByRole('button', { name: /Terminal/ })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`add-pane-${viewport.width}.png`) });
    await menu.getByRole('button', { name: /프로젝트 안내/ }).click();
    const pane = page.getByLabel('프로젝트 안내 pane', { exact: true });
    await expect(pane).toBeVisible();
    await expect(pane).toContainText('함께 볼 문서');
    await pane.getByRole('button', { name: '프로젝트 안내 닫기', exact: true }).click();
    await expect(pane).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(
    (await post(page, 'panes/present', { type: 'agent.message', text: 'forged' })).status(),
  ).toBe(400);
  expect(
    (
      await post(page, 'panes/add', { kind: 'browser', server: { port: 1234, path: '/' } })
    ).status(),
  ).toBe(400);
  await post(page, 'release');
  expect((await post(page, 'panes/add', { kind: 'saved', id: 'manual-doc' })).status()).toBe(403);
  expect(
    (await post(page, 'panes/present', { type: 'pane.close', id: 'manual-doc' })).status(),
  ).toBe(403);
});

for (const mobile of [false, true]) {
  test(`manual shell pane sends input, handles restart and locks on lease loss on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    if (mobile) await page.setViewportSize({ width: 320, height: 568 });
    const state: Snapshot = {
      me: { id: 'owner', nickname: '참가자', admin: false },
      adminAvailable: false,
      workspace: {
        activeId: 'default',
        projects: [{ id: 'default', name: '직접 조작', slot: 0 }],
        switching: false,
      },
      stage: {
        revision: 1,
        title: '직접 조작',
        runner: 'antigravity',
        phase: 'idle',
        participants: [],
        speaker: { participantId: 'owner', expiresAt: Date.now() + 60_000 },
        turn: null,
        panes: [],
        focusId: 'agent',
        focusVersion: 1,
        messages: [],
        activity: null,
        serverTime: Date.now(),
      },
    };
    await page.route('**/api/me', (route) => route.fulfill({ json: state }));
    await page.route('**/api/panes?*', (route) => route.fulfill({ json: { panes: [] } }));
    const commands: { path: string; body: Record<string, unknown> }[] = [];
    await page.route('**/api/shell/user-test/*', (route) => {
      commands.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      return route.fulfill({ json: { ok: true } });
    });
    await page.route('**/api/tui/resize', (route) => route.fulfill({ json: { ok: true } }));
    await page.addInitScript((state) => {
      const sources: (EventTarget & { url: string })[] = [];
      Object.assign(window, { manualSources: sources });
      window.EventSource = class extends EventTarget {
        url: string;
        constructor(url: string | URL) {
          super();
          this.url = String(url);
          sources.push(this);
          queueMicrotask(() =>
            this.dispatchEvent(
              new MessageEvent(this.url === '/api/events' ? 'state' : 'terminal', {
                data: JSON.stringify(
                  this.url === '/api/events'
                    ? state
                    : {
                        kind: 'reset',
                        epoch: 'bb5fcd49-468c-43c5-bd59-642c4a7e3e5e',
                        seq: 0,
                        cols: 40,
                        rows: 16,
                        status: 'ready',
                        data: '/workspace $ ',
                      },
                ),
              }),
            ),
          );
        }
        close() {
          sources.splice(sources.indexOf(this), 1);
        }
      } as unknown as typeof EventSource;
    }, state);
    const publish = () =>
      page.evaluate((state) => {
        const sources = (window as unknown as { manualSources: (EventTarget & { url: string })[] })
          .manualSources;
        sources
          .find((source) => source.url === '/api/events')
          ?.dispatchEvent(new MessageEvent('state', { data: JSON.stringify(state) }));
      }, state);
    await page.route('**/api/panes/add', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ kind: 'terminal' });
      state.stage.panes = [
        {
          id: 'user-test',
          kind: 'terminal',
          title: '터미널',
          content: '',
          subtitle: '',
          size: 2,
          status: 'active',
          manual: true,
          shell: true,
          terminal: { runId: 'c8239d75-a40f-4e1f-9602-7714fc033cb0', startedAt: Date.now() },
        },
      ];
      state.stage.focusId = 'user-test';
      state.stage.focusVersion++;
      await publish();
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'pane 추가', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'pane 추가 메뉴' });
    await expect(menu.getByRole('button', { name: /Terminal/ })).toBeEnabled();
    await page.screenshot({
      path: info.outputPath(`shell-menu-${mobile ? 'mobile' : 'desktop'}.png`),
    });
    await menu.getByRole('button', { name: /Terminal/ }).click();
    await expect(menu).toBeHidden();
    const pane = page.getByLabel('터미널 pane', { exact: true });
    await expect(pane).toBeVisible();
    await expect(pane.getByLabel('셸 터미널 화면')).toHaveAttribute('data-connected', 'true');
    await page.getByLabel('셸 터미널 입력').focus();
    await page.keyboard.insertText('pwd');
    await pane.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect
      .poll(() =>
        commands
          .filter((command) => command.path.endsWith('/input'))
          .map((command) => command.body.data)
          .join(''),
      )
      .toBe('pwd\r');
    await pane.getByRole('button', { name: 'Ctrl', exact: true }).click();
    await page.keyboard.insertText('c');
    await expect
      .poll(() => commands.filter((command) => command.path.endsWith('/input')).at(-1)?.body.data)
      .toBe('\x03');
    expect(
      commands
        .filter((command) => command.path.endsWith('/input'))
        .every((command) => command.body.epoch === 'bb5fcd49-468c-43c5-bd59-642c4a7e3e5e'),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`shell-input-${mobile ? 'mobile' : 'desktop'}.png`),
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    state.stage.speaker = null;
    await publish();
    await expect(pane.getByLabel('터미널 보조 키')).toHaveCount(0);
    await expect(pane.getByLabel('셸 터미널 화면')).toHaveAttribute('data-controller', 'false');
    await expect(pane.getByRole('button', { name: '터미널 닫기', exact: true })).toHaveCount(0);
    state.me.admin = true;
    await publish();
    await page.evaluate(() => {
      const sources = (window as unknown as { manualSources: (EventTarget & { url: string })[] })
        .manualSources;
      sources
        .find((source) => source.url.includes('/shell/'))
        ?.dispatchEvent(
          new MessageEvent('terminal', {
            data: JSON.stringify({
              kind: 'reset',
              epoch: 'bb5fcd49-468c-43c5-bd59-642c4a7e3e5e',
              seq: 0,
              cols: 40,
              rows: 16,
              status: 'stopped',
              data: 'exit\r\n',
            }),
          }),
        );
    });
    await pane.getByRole('button', { name: '터미널 다시 시작' }).click();
    await expect.poll(() => commands.some((command) => command.path.endsWith('/start'))).toBe(true);
  });
}
