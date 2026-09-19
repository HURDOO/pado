import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../shared/protocol.ts';

type MockSource = EventTarget & { url: string };
type MockWindow = Window & { tuiKeySources: MockSource[] };
async function fixture(page: Page) {
  const state: Snapshot = {
    me: { id: 'owner', nickname: '키보드 검증', admin: false },
    adminAvailable: false,
    workspace: {
      activeId: 'default',
      projects: [{ id: 'default', name: '기본 프로젝트', slot: 0 }],
      switching: false,
    },
    stage: {
      revision: 1,
      title: '터미널 키 검증',
      runner: 'antigravity',
      phase: 'running',
      participants: [{ id: 'owner', nickname: '키보드 검증', online: true }],
      speaker: null,
      turn: { id: 'turn', participantId: 'owner', prompt: '', startedAt: Date.now() },
      panes: [],
      focusId: 'agent',
      focusVersion: 1,
      messages: [],
      activity: null,
      serverTime: Date.now(),
    },
  };
  const sent: string[] = [];
  await page.route('**/api/me', (route) => route.fulfill({ json: state }));
  await page.route('**/api/tui/input', (route) => {
    sent.push(route.request().postDataJSON().data);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/tui/resize', (route) => route.fulfill({ json: { ok: true } }));
  await page.addInitScript((state) => {
    const sources: MockSource[] = [];
    Object.assign(window, { tuiKeySources: sources });
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
                      epoch: 'keys',
                      seq: 0,
                      cols: 40,
                      rows: 20,
                      status: 'ready',
                      data: 'Terminal ready\r\n> ',
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
  await page.goto('/');
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-connected', 'true');
  const publish = async () =>
    page.evaluate((state) => {
      for (const source of (window as unknown as MockWindow).tuiKeySources)
        if (source.url === '/api/events')
          source.dispatchEvent(new MessageEvent('state', { data: JSON.stringify(state) }));
    }, state);
  return { state, sent, publish };
}

for (const mobile of [false, true]) {
  test(`Ctrl and Alt helper keys send one-shot terminal chords on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    if (mobile) await page.setViewportSize({ width: 320, height: 780 });
    const { state, sent, publish } = await fixture(page);
    const keys = page.getByLabel('터미널 보조 키');
    const ctrl = keys.getByRole('button', { name: 'Ctrl', exact: true });
    const alt = keys.getByRole('button', { name: 'Alt', exact: true });
    await expect(keys.getByRole('button')).toHaveCount(12);
    const type = async (text: string, expected: string) => {
      const count = sent.length;
      await page.getByLabel('Antigravity 터미널 입력').focus();
      await page.keyboard.insertText(text);
      await expect.poll(() => sent.slice(count)).toEqual([expected]);
      await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
      await expect(alt).toHaveAttribute('aria-pressed', 'false');
    };
    await ctrl.click();
    await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
    expect(sent).toEqual([]);
    await type('c', '\x03');
    await type('c', 'c');
    await alt.click();
    await type('j', '\x1bj');
    await ctrl.click();
    await alt.click();
    await expect(page.locator('.tui-status')).toContainText('Ctrl + Alt · 다음 키에 적용');
    await page.screenshot({
      path: info.outputPath(`tui-modifiers-${mobile ? 'mobile' : 'desktop'}.png`),
    });
    await type('k', '\x1b\x0b');
    await ctrl.click();
    await keys.getByRole('button', { name: '←', exact: true }).click();
    await expect.poll(() => sent.at(-1)).toBe('\x1b[1;5D');
    await alt.click();
    await keys.getByRole('button', { name: '→', exact: true }).click();
    await expect.poll(() => sent.at(-1)).toBe('\x1b[1;3C');
    await ctrl.click();
    await ctrl.click();
    await type('x', 'x');
    await ctrl.click();
    await type('한글 입력', '한글 입력');
    await alt.click();
    state.stage.turn!.participantId = 'other';
    await publish();
    await expect(keys).toHaveCount(0);
    state.stage.turn!.participantId = 'owner';
    await publish();
    await expect(alt).toHaveAttribute('aria-pressed', 'false');
    await type('j', 'j');
    expect(
      await keys.getByRole('button').evaluateAll((buttons) =>
        buttons.every((button) => {
          const bounds = button.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
        }),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('wheel, touch swipe and page keys scroll the native alternate-screen viewport', async ({
  page,
}) => {
  const { sent } = await fixture(page);
  await page.evaluate(() => {
    const source = (window as unknown as MockWindow).tuiKeySources.find((item) =>
      item.url.startsWith('/api/tui/events'),
    );
    source?.dispatchEvent(
      new MessageEvent('terminal', {
        data: JSON.stringify({
          kind: 'data',
          epoch: 'keys',
          seq: 1,
          cols: 40,
          rows: 20,
          status: 'ready',
          data: '\x1b[?1049h\x1b[2J\x1b[HAlternate screen',
        }),
      }),
    );
  });
  const terminal = page.getByLabel('Antigravity TUI 화면');
  await terminal.hover();
  await page.mouse.wheel(0, -120);
  await expect.poll(() => sent.at(-1)).toBe('\x1b[5~');
  await page.mouse.wheel(0, 120);
  await expect.poll(() => sent.at(-1)).toBe('\x1b[6~');

  const keys = page.getByLabel('터미널 보조 키');
  await keys.getByRole('button', { name: 'PgUp', exact: true }).click();
  await expect.poll(() => sent.at(-1)).toBe('\x1b[5~');
  await keys.getByRole('button', { name: 'PgDn', exact: true }).click();
  await expect.poll(() => sent.at(-1)).toBe('\x1b[6~');

  const beforeSwipe = sent.length;
  await terminal.evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 7,
        pointerType: 'touch',
        clientY: 200,
      }),
    );
    element.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 7,
        pointerType: 'touch',
        clientY: 120,
      }),
    );
  });
  await expect.poll(() => sent.slice(beforeSwipe)).toEqual(['\x1b[6~']);
});

test('compact workspace keeps native participation over the terminal and hides unavailable actions', async ({
  page,
}, info) => {
  const { state, publish } = await fixture(page);
  state.stage.turn = null;
  state.stage.phase = 'idle';
  state.stage.panes = [
    {
      id: 'preview',
      kind: 'browser',
      title: '실행 결과',
      subtitle: '중복된 설명은 제목줄에 두지 않음',
      content: '<h1>실제 화면을 위한 공간</h1>',
      size: 2,
      status: 'done',
    },
  ];
  await publish();
  const raise = page.getByRole('button', { name: '손들고 참여하기', exact: true });
  const terminal = page.getByLabel('Antigravity TUI 화면', { exact: true });
  await expect(
    page.locator('.stage-heading, .stage-footer, .pane-subtitle, .pane-kind, .composer'),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '기본 프로젝트', level: 1 })).toBeVisible();
  await expect(page.locator('.tui-status')).toContainText('관람 중 · 입력 잠김');
  for (const viewport of [
    { width: 1646, height: 838 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(raise).toBeVisible();
    expect((await page.locator('.topbar').boundingBox())!.height).toBeLessThanOrEqual(48);
    expect(
      (await page.locator('.agent-pane .pane-header').boundingBox())!.height,
    ).toBeLessThanOrEqual(38);
    await expect
      .poll(() =>
        raise.evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          const viewport = button
            .closest('.tui-surface')!
            .querySelector('.tui-viewport')!
            .getBoundingClientRect();
          return (
            bounds.top >= viewport.top &&
            bounds.bottom <= viewport.bottom &&
            bounds.left >= viewport.left &&
            bounds.right <= viewport.right
          );
        }),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`compact-native-${viewport.width}x${viewport.height}.png`),
      animations: 'disabled',
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  // Wait for the guide to expand after leaving the short landscape viewport.
  await expect(page.getByRole('button', { name: '데모 안내 닫기' })).toBeVisible();
  const initialHeight = (await terminal.boundingBox())!.height;
  state.stage.speaker = { participantId: 'other', expiresAt: Date.now() + 60_000 };
  await publish();
  await expect(raise).toHaveCount(0);
  expect((await terminal.boundingBox())!.height).toBe(initialHeight);
  state.stage.speaker = null;
  state.stage.turn = {
    id: 'other-turn',
    participantId: 'other',
    prompt: '',
    startedAt: Date.now(),
  };
  state.stage.phase = 'running';
  await publish();
  await expect(raise).toHaveCount(0);
  await expect(page.locator('.tui-status')).toContainText('관람 중 · 입력 잠김');
  state.stage.turn = null;
  state.stage.phase = 'idle';
  state.workspace.switching = true;
  await publish();
  await expect(raise).toHaveCount(0);
  state.workspace.switching = false;
  await publish();
  await expect(raise).toBeVisible();
  await page.evaluate(async () => {
    const source = (window as unknown as MockWindow).tuiKeySources.find(
      (source) => source.url === '/api/events',
    );
    await (source as MockSource & { onerror: () => Promise<void> }).onerror();
  });
  await expect(raise).toHaveCount(0);
  await publish();
  await expect(raise).toBeVisible();

  let releaseRequest: (() => void) | undefined;
  await page.route('**/api/raise', async (route) => {
    await new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await route.fulfill({ json: { ok: true } });
  });
  try {
    await raise.click();
    await expect(raise).toHaveCount(0);
    await expect.poll(() => !!releaseRequest).toBe(true);
    state.stage.speaker = { participantId: 'owner', expiresAt: Date.now() + 60_000 };
    await publish();
    releaseRequest!();
    await expect(page.locator('.native-speaker-controls')).toBeVisible();
    await expect(page.locator('.countdown')).toContainText('초');
    await expect(terminal).toHaveAttribute('data-controller', 'true');
    await expect(page.getByLabel('Antigravity 터미널 입력')).toBeFocused();
    await expect(raise).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('compact-native-speaking.png'),
      animations: 'disabled',
    });
    await page.route('**/api/release', (route) => route.fulfill({ json: { ok: true } }));
    await page.getByRole('button', { name: '다음 분께 양보', exact: true }).click();
    state.stage.speaker = null;
    await publish();
    await expect(raise).toBeVisible();
    await expect(page.locator('.native-speaker-controls')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Workspace pane 전환' })
      .getByRole('button', { name: '실행 결과' })
      .click();
    await expect(raise).toBeHidden();
    await page
      .getByRole('navigation', { name: 'Workspace pane 전환' })
      .getByRole('button', { name: 'Agent', exact: true })
      .click();
    await expect(raise).toBeVisible();
  } finally {
    releaseRequest?.();
  }
});
