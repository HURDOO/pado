import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../shared/protocol.ts';

const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
const status = (page: Page) => page.getByRole('status', { name: '현재 발언권', exact: true });
const post = (page: Page, path: string) =>
  page.request.post('/api/' + path, {
    headers: { Origin: origin },
    data: {},
  });
async function join(page: Page, nickname: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(nickname);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(status(page)).toHaveText('발언권 비어 있음');
}

test('speaker and spectator see the server-owned nickname across handoff', async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const spectator = await context.newPage();
  try {
    await join(page, '파도지기');
    await join(spectator, '동아리친구');
    await page.getByRole('button', { name: '손들고 참여하기', exact: true }).click();
    for (const target of [page, spectator]) {
      await expect(status(target)).toContainText('발언 중');
      await expect(status(target).locator('.speaker-nickname')).toHaveText('파도지기');
    }
    await page.screenshot({ path: info.outputPath('speaker-desktop.png') });
    await spectator.screenshot({ path: info.outputPath('speaker-mobile.png') });
    expect((await post(page, 'release')).status()).toBe(200);
    for (const target of [page, spectator])
      await expect(status(target)).toHaveText('발언권 비어 있음');
    await spectator.getByRole('button', { name: '손들고 참여하기', exact: true }).click();
    for (const target of [page, spectator])
      await expect(status(target).locator('.speaker-nickname')).toHaveText('동아리친구');
    expect((await post(spectator, 'release')).status()).toBe(200);
    await expect(status(page)).toHaveText('발언권 비어 있음');
  } finally {
    await post(page, 'release');
    await post(spectator, 'release');
    await context.close();
  }
});

type MockWindow = Window & { speakerSources: EventTarget[] };
for (const width of [1440, 320]) {
  test(`speaker nickname follows turns, disconnects and project scope at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width < 600 ? 780 : 950 });
    const nickname = '아주긴닉네임으로함께참여하는동아리친구';
    const state: Snapshot = {
      me: { id: 'viewer', nickname: '관객', admin: false },
      adminAvailable: false,
      workspace: {
        activeId: 'default',
        switching: false,
        projects: [
          { id: 'default', name: '긴 프로젝트 이름도 닉네임과 함께 표시', slot: 0 },
          { id: 'other', name: '다른 프로젝트', slot: 1 },
        ],
      },
      stage: {
        revision: 1,
        title: 'Stage',
        runner: 'rehearsal',
        phase: 'idle',
        participants: [
          { id: 'owner', nickname, online: false },
          { id: 'viewer', nickname: '관객', online: true },
        ],
        speaker: { participantId: 'owner', expiresAt: Date.now() + 60000 },
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
    await page.addInitScript((state) => {
      const sources: EventTarget[] = [];
      Object.assign(window, { speakerSources: sources });
      window.EventSource = class extends EventTarget {
        onerror: ((event: Event) => void) | null = null;
        constructor() {
          super();
          sources.push(this);
          this.addEventListener('error', (event) => this.onerror?.(event));
          queueMicrotask(() =>
            this.dispatchEvent(new MessageEvent('state', { data: JSON.stringify(state) })),
          );
        }
        close() {
          sources.splice(sources.indexOf(this), 1);
        }
      } as unknown as typeof EventSource;
    }, state);
    const publish = () =>
      page.evaluate((state) => {
        for (const source of (window as unknown as MockWindow).speakerSources)
          source.dispatchEvent(new MessageEvent('state', { data: JSON.stringify(state) }));
      }, state);
    await page.goto('/');
    await expect(status(page).locator('.speaker-nickname')).toHaveText(nickname);
    await expect(status(page)).toHaveAttribute('title', '발언 중 · ' + nickname);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await status(page).evaluate((element) => {
        const r = element.getBoundingClientRect();
        return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= 48;
      }),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`speaker-long-${width}.png`) });
    state.stage.turn = { id: 'turn', participantId: 'owner', prompt: '', startedAt: Date.now() };
    state.stage.speaker = null;
    state.stage.phase = 'running';
    await publish();
    await expect(status(page)).toContainText('작업 중');
    await expect(status(page).locator('.speaker-nickname')).toHaveText(nickname);
    state.stage.phase = 'waiting';
    await publish();
    await expect(status(page)).toContainText('응답 대기');
    // A participant nickname is text, never HTML or a raw session ID.
    state.stage.participants[0].nickname = '<img src=x>';
    await publish();
    await expect(status(page).locator('.speaker-nickname')).toHaveText('<img src=x>');
    await expect(status(page).locator('img')).toHaveCount(0);
    await page.evaluate(() => {
      for (const source of (window as unknown as MockWindow).speakerSources)
        source.dispatchEvent(new Event('error'));
    });
    await expect(status(page)).toHaveText('상태 확인 중');
    state.workspace.viewedId = 'other';
    await publish();
    await expect(status(page)).toHaveText('읽기 전용');
    state.workspace.viewedId = 'default';
    state.stage.turn = null;
    state.stage.phase = 'idle';
    await publish();
    await expect(status(page)).toHaveText('발언권 비어 있음');
  });
}
