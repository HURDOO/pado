import { expect, test, type Page } from '@playwright/test';
import type { Pane, Snapshot } from '../../shared/protocol.ts';

type MockWindow = Window & { demoGuideSources: EventTarget[] };
const guide = (page: Page) => page.getByRole('complementary', { name: '데모 안내' });

async function fixture(page: Page) {
  const state: Snapshot = {
    me: { id: 'viewer', nickname: '체험자', admin: false },
    adminAvailable: false,
    workspace: {
      activeId: 'default',
      projects: [
        { id: 'default', name: '참여 프로젝트', slot: 0 },
        { id: 'other', name: '둘러볼 프로젝트', slot: 1 },
      ],
      switching: false,
    },
    stage: {
      revision: 1,
      title: '데모',
      runner: 'rehearsal',
      phase: 'idle',
      participants: [{ id: 'viewer', nickname: '체험자', online: true }],
      speaker: null,
      turn: null,
      panes: [],
      focusId: 'agent',
      focusVersion: 1,
      messages: [],
      activity: null,
      serverTime: Date.now(),
    },
  };
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET')
      mutations.push(request.url());
  });
  await page.route('**/api/me', (route) => route.fulfill({ json: state }));
  await page.addInitScript(() => {
    const sources: EventTarget[] = [];
    Object.assign(window, { demoGuideSources: sources });
    window.EventSource = class extends EventTarget {
      onerror: ((event: Event) => void) | null = null;
      constructor() {
        super();
        sources.push(this);
        this.addEventListener('error', (event) => this.onerror?.(event));
        void fetch('/api/me').then(async (response) => {
          this.dispatchEvent(
            new MessageEvent('state', { data: JSON.stringify(await response.json()) }),
          );
        });
      }
      close() {
        sources.splice(sources.indexOf(this), 1);
      }
    } as unknown as typeof EventSource;
  });
  const publish = () =>
    page.evaluate((state) => {
      for (const source of (window as unknown as MockWindow).demoGuideSources)
        source.dispatchEvent(new MessageEvent('state', { data: JSON.stringify(state) }));
    }, state);
  await page.goto('/');
  await expect(guide(page)).toHaveAttribute('data-step', 'start');
  return { state, publish, mutations };
}

function pane(kind: Pane['kind']): Pane {
  return {
    id: kind,
    kind,
    title: kind,
    content: kind === 'browser' ? '<p>실행 화면</p>' : '<p>필요한 정보를 입력해 주세요.</p>',
    subtitle: '',
    size: 1,
    status: 'active',
    ...(kind === 'review'
      ? { review: { summary: '확인할 변경', changes: [], checks: [], limitations: ['검증 전'] } }
      : {}),
  };
}

for (const width of [1440, 390]) {
  test(`demo guidance follows actual stages, roles and dismissal without writing prompts at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 950 });
    const { state, publish, mutations } = await fixture(page);
    await expect(guide(page)).toContainText('손들고 체험을 시작해 보세요');
    await expect(page.locator('[data-pane-id]')).toHaveCount(0);

    state.stage.speaker = { participantId: 'viewer', expiresAt: Date.now() + 30_000 };
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'request');
    const prompt = page.getByLabel('아이디어', { exact: true });
    await expect(prompt).toHaveValue('');
    await expect(prompt).toBeFocused();
    await prompt.fill('내가 직접 적은 요청');
    state.stage.revision++;
    await publish();
    await expect(prompt).toHaveValue('내가 직접 적은 요청');
    await expect(prompt).toBeFocused();
    if (width < 600) {
      const composer = await page.locator('.composer').boundingBox();
      const card = await guide(page).boundingBox();
      expect(card!.y).toBeGreaterThanOrEqual(composer!.y + composer!.height);
    }
    await page.screenshot({ path: info.outputPath(`demo-guide-request-${width}.png`) });

    state.stage.speaker.participantId = 'other';
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'watching-request');
    await expect(prompt).toHaveCount(0);

    state.stage.speaker = null;
    state.stage.turn = { id: 'turn', participantId: 'viewer', prompt: '', startedAt: Date.now() };
    state.stage.phase = 'running';
    // An existing Browser is not proof that the active task has finished.
    state.stage.panes = [pane('browser')];
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'working');
    await expect(guide(page)).toContainText('AI가 작업하고 있어요');
    state.stage.turn.participantId = 'other';
    await publish();
    await expect(guide(page)).toContainText('지금은 함께 관람해요');
    state.stage.phase = 'error';
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'error');

    state.stage.phase = 'waiting';
    state.stage.panes.push(pane('input'));
    state.stage.focusId = 'input';
    state.stage.focusVersion++;
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'watching-input');
    await expect(guide(page)).toContainText('요청자의 응답을 기다리고 있어요');
    state.stage.turn.participantId = 'viewer';
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'input');
    await expect(guide(page)).toContainText('Input 화면에 요청한 정보를 입력해 주세요');
    await page.screenshot({ path: info.outputPath(`demo-guide-input-${width}.png`) });
    state.stage.turn.participantId = 'other';
    state.me.admin = true;
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'input');
    // Native waits need not have an Input pane.
    state.stage.panes = [];
    await publish();
    await expect(guide(page)).toContainText('Agent가 응답을 기다리고 있어요');
    state.me.admin = false;

    state.stage.turn = null;
    state.stage.phase = 'idle';
    state.stage.panes = [pane('browser'), pane('review')];
    state.stage.focusId = 'review';
    state.stage.focusVersion++;
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'result');
    await expect(guide(page)).toContainText('검증 내용을 살펴보세요');

    await page.getByRole('button', { name: '데모 안내 닫기' }).click();
    const reopen = page.getByRole('button', { name: '데모 안내 열기' });
    await expect(reopen).toBeFocused();
    state.stage.phase = 'error';
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'error');
    await expect(guide(page).getByRole('heading')).toHaveCount(0);
    await page.reload();
    await expect(reopen).toBeVisible();
    await reopen.click();
    await expect(guide(page)).toContainText('작업 상태를 확인해 주세요');
    await expect(page.getByRole('button', { name: '데모 안내 닫기' })).toBeFocused();

    await page.evaluate(() => {
      for (const source of (window as unknown as MockWindow).demoGuideSources)
        source.dispatchEvent(new Event('error'));
    });
    await expect(guide(page)).toHaveAttribute('data-step', 'connecting');
    state.workspace.switching = true;
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'switching');
    state.workspace.switching = false;
    state.workspace.viewedId = 'other';
    state.me.admin = true;
    await publish();
    await expect(guide(page)).toHaveAttribute('data-step', 'browsing');
    await expect(guide(page)).toContainText('읽기 전용');
    expect(mutations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('short screens and keyboard resizing keep the guide away from prompt controls', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, publish } = await fixture(page);
  state.stage.speaker = { participantId: 'viewer', expiresAt: Date.now() + 30_000 };
  await publish();
  const prompt = page.getByLabel('아이디어', { exact: true });
  await prompt.fill('작성 중인 내용');
  for (const viewport of [
    { width: 390, height: 400 },
    { width: 844, height: 390 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: '데모 안내 열기' })).toBeVisible();
    await expect(prompt).toBeFocused();
    await expect(prompt).toHaveValue('작성 중인 내용');
    const send = page.getByRole('button', { name: '프롬프트 보내기' });
    await expect
      .poll(() =>
        send.evaluate((element) => {
          const r = element.getBoundingClientRect();
          return (
            r.bottom <= innerHeight &&
            r.top >= 0 &&
            element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`demo-guide-compact-${viewport.width}.png`) });
  }
  await page.getByRole('button', { name: '데모 안내 열기' }).click();
  await expect(guide(page)).toContainText('이렇게 요청해 보세요');
  await page.getByRole('button', { name: '데모 안내 닫기' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '데모 안내 열기' })).toBeVisible();
});
