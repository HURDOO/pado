import { expect, test, type Page } from '@playwright/test';
import type { Pane, Snapshot } from '../../shared/protocol.ts';

type MockWindow = Window & { padoSubagentSources: (EventTarget & { url: string })[] };

function snapshot(runner: Snapshot['stage']['runner']): Snapshot {
  return {
    me: { id: 'viewer', nickname: '작업 관객', admin: false },
    adminAvailable: true,
    workspace: {
      activeId: 'default',
      projects: [{ id: 'default', name: '기존 프로젝트', slot: 0 }],
      switching: false,
    },
    stage: {
      revision: 1,
      title: '함께 만드는 workspace',
      runner,
      phase: 'running',
      participants: [{ id: 'viewer', nickname: '작업 관객', online: true }],
      speaker: null,
      turn: { id: 'turn', participantId: 'other', prompt: '', startedAt: Date.now() },
      panes: [],
      focusId: 'agent',
      focusVersion: 1,
      messages: [],
      activity: { phase: 'delegating', subagents: [] },
      serverTime: Date.now(),
    },
  };
}

function subagent(index = 1): Pane {
  return {
    id: `subagent-${index}`,
    kind: 'subagent',
    title: `구현 에이전트 ${index}`,
    subtitle: '맡은 작업을 진행하고 있어요.',
    // Only the server-filtered subagent output may become terminal content.
    content: '<script>window.subagentUnsafe=true</script>private prompt /host/private/file',
    status: 'active',
    size: 1,
    subagent: Object.assign(
      { state: 'working' as const, startedAt: Date.now() - 8000 },
      {
        output:
          '┌─ READ  src/App.tsx:10–45\n│ 모바일 버튼 구조 확인\n└─ ✓ 파일 읽기 완료\n\n┌─ EDIT  src/App.tsx\n│ @@ -12 +12 @@\n│ -old button\n│ +new button\n└─ ✓ 수정 도구 완료 · diff 발췌\n\n┌─ RUN  pnpm test\n│ Tests: 12 passed\n└─ ✓ 종료 코드 0\n\n◆ RESPONSE\n모바일 버튼 수정과 검증을 마쳤습니다.',
      },
    ),
  };
}

async function openStage(page: Page, initial: Snapshot) {
  await page.route('**/api/me', (route) => route.fulfill({ json: initial }));
  await page.addInitScript((initial) => {
    const sources: (EventTarget & { url: string })[] = [];
    Object.assign(window, { padoSubagentSources: sources });
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
                  ? initial
                  : {
                      kind: 'reset',
                      epoch: 'subagent-test',
                      seq: 0,
                      cols: 80,
                      rows: 24,
                      status: 'ready',
                      data: 'Antigravity is working',
                    },
              ),
            }),
          ),
        );
      }
      close() {
        const index = sources.indexOf(this);
        if (index >= 0) sources.splice(index, 1);
      }
    } as unknown as typeof EventSource;
  }, initial);
  await page.goto('/');
  await expect(page.locator('.connection')).toHaveText('연결됨');
}

async function publish(page: Page, value: Snapshot) {
  await page.evaluate((value) => {
    for (const source of (window as unknown as MockWindow).padoSubagentSources)
      if (source.url === '/api/events')
        source.dispatchEvent(new MessageEvent('state', { data: JSON.stringify(value) }));
  }, value);
}

for (const runner of ['rehearsal', 'antigravity'] as const) {
  for (const mobile of [false, true]) {
    test(`subagent panes follow shared lifecycle in ${runner} on ${mobile ? 'mobile' : 'desktop'}`, async ({
      page,
    }, info) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const state = snapshot(runner);
      await openStage(page, state);
      await expect(page.locator('.subagent-pane')).toHaveCount(0);
      const agent = subagent();
      state.stage.panes = [agent];
      state.stage.focusId = agent.id;
      state.stage.focusVersion++;
      state.stage.serverTime = Date.now();
      await publish(page, state);
      const pane = page.getByLabel(`${agent.title} pane`, { exact: true });
      await expect(pane).toBeVisible();
      await expect(pane.getByRole('status')).toHaveText('작업 중');
      await expect(pane.getByRole('log')).toBeVisible();
      await expect(pane.locator('.xterm')).toHaveCount(1);
      await expect(pane.locator('.xterm-accessibility-tree')).toContainText('READ');
      await expect(pane.locator('.xterm-accessibility-tree')).toContainText(
        '모바일 버튼 구조 확인',
      );
      await expect(pane).toContainText('읽기 전용 실행 로그');
      await expect(pane.locator('.subagent-avatar, .subagent-progress')).toHaveCount(0);
      await expect(pane).not.toContainText('private prompt');
      await expect(pane.locator('script, iframe, pre')).toHaveCount(0);
      expect(await page.evaluate(() => 'subagentUnsafe' in window)).toBe(false);
      await expect(page.locator('.workspace .pane')).toHaveCount(2);
      await expect(page.locator('.subagent-panel')).toHaveCount(0);
      if (mobile) {
        await expect(page.getByRole('button', { name: agent.title, exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await page
          .getByRole('navigation')
          .getByRole('button', { name: 'Agent', exact: true })
          .click();
        await expect(page.getByLabel('Agent pane', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: agent.title, exact: true }).click();
      } else {
        await expect(page.getByLabel('Agent pane', { exact: true })).toBeVisible();
      }
      await page.screenshot({
        animations: 'disabled',
        path: info.outputPath('subagent-working.png'),
      });

      const finishedAt = Date.now();
      await page.clock.install({ time: finishedAt });
      agent.status = 'done';
      agent.subtitle = '서브에이전트 실행이 종료됐어요.';
      agent.subagent = {
        ...agent.subagent!,
        state: 'ended',
        finishedAt,
        closeAt: finishedAt + 3000,
      };
      state.stage.serverTime = finishedAt;
      await publish(page, state);
      await expect(pane.getByRole('status')).toHaveText('실행 종료');
      await expect(pane.locator('.pane-tools .success')).toHaveCount(0);
      await expect(pane).toContainText('3초 후 pane이 닫혀요');
      await page.clock.fastForward(2000);
      await expect(pane).toBeAttached();
      await expect(pane).toContainText('1초 후 pane이 닫혀요');
      await page.clock.fastForward(1000);
      // Browser countdown/animation never deletes server-owned state on its own.
      await expect(pane).toBeAttached();
      state.stage.panes = [];
      state.stage.focusId = 'agent';
      state.stage.focusVersion++;
      state.stage.serverTime = finishedAt + 3000;
      await publish(page, state);
      await expect(pane).toHaveCount(0);
      await expect(page.getByLabel('Agent pane', { exact: true })).toBeVisible();
      await expect(page.locator('.workspace .pane')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    });
  }
}

test('subagent log appends real output and ignores terminal controls without sending input', async ({
  page,
}) => {
  const state = snapshot('antigravity');
  const agent = subagent();
  Object.assign(agent.subagent!, { output: '' });
  state.stage.panes = [agent];
  state.stage.focusId = agent.id;
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(request.url());
  });
  await openStage(page, state);
  const pane = page.getByLabel(`${agent.title} pane`, { exact: true });
  await expect(pane).toContainText('실행 로그를 기다리는 중');
  Object.assign(agent.subagent!, {
    output: '첫 번째 출력\n[tool] read_file\n',
  });
  await publish(page, state);
  const log = pane.locator('.xterm-accessibility-tree');
  await expect(log).toContainText('첫 번째 출력');
  await expect(pane.locator('.subagent-empty')).toHaveCount(0);
  // Keep text before CSI erase-display. OSC payloads must not reach clipboard,
  // window title, or hyperlink handling, and HTML stays literal terminal text.
  Object.assign(agent.subagent!, {
    output:
      '첫 번째 출력\n[tool] read_file\n\x1b[2J두 번째 출력\n' +
      '\x1b]0;spoofed-title\x07\x1b]52;c;c2VjcmV0\x07' +
      '\x1b]8;;https://unsafe.example\x07literal link\x1b]8;;\x07\n' +
      '<script>window.subagentUnsafe=true</script>\n',
  });
  await publish(page, state);
  await expect(log).toContainText('첫 번째 출력');
  await expect(log).toContainText('두 번째 출력');
  await expect(log).toContainText('literal link');
  await expect(log).not.toContainText('spoofed-title');
  await expect(log).not.toContainText('c2VjcmV0');
  await expect(log).not.toContainText('https://unsafe.example');
  await expect(pane.locator('a, script, iframe')).toHaveCount(0);
  expect(await page.evaluate(() => 'subagentUnsafe' in window)).toBe(false);
  await pane.getByRole('log').click();
  await page.keyboard.type('do not send this');
  await page.keyboard.press('Enter');
  expect(writes).toEqual([]);
  await expect(pane.locator('.xterm-helper-textarea')).toHaveAttribute('readonly', 'true');

  // A replaced/truncated transcript resets the view instead of retaining stale
  // output, and fitting a narrow viewport keeps the font readable.
  Object.assign(agent.subagent!, { output: '새로운 출력 스냅샷\n' });
  await publish(page, state);
  await expect(log).toContainText('새로운 출력 스냅샷');
  await expect(log).not.toContainText('첫 번째 출력');
  await page.setViewportSize({ width: 320, height: 667 });
  await expect
    .poll(() =>
      pane.locator('.xterm-screen').evaluate((element) => {
        const width = element.getBoundingClientRect().width;
        return width > 150 && width <= element.parentElement!.clientWidth + 1;
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('subagent response, resumed work and errors preserve motion preferences and server ownership', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = snapshot('rehearsal');
  const agent = subagent();
  state.stage.panes = [agent];
  await openStage(page, state);
  const pane = page.getByLabel(`${agent.title} pane`, { exact: true });
  const finishedAt = Date.now();
  await page.clock.install({ time: finishedAt });
  agent.status = 'done';
  agent.subtitle = '작업 응답을 마쳤어요.';
  agent.subagent = { ...agent.subagent!, state: 'idle', finishedAt, closeAt: finishedAt + 3000 };
  state.stage.serverTime = finishedAt;
  await publish(page, state);
  await expect(pane.getByRole('status')).toHaveText('응답 완료');
  await expect(pane.locator('.pane-tools .success')).toHaveCount(1);
  await page.clock.fastForward(2000);
  agent.status = 'active';
  agent.subagent = { state: 'working', startedAt: agent.subagent.startedAt };
  state.stage.serverTime = finishedAt + 2000;
  await publish(page, state);
  await page.clock.fastForward(2000);
  await expect(pane.getByRole('status')).toHaveText('작업 중');
  await expect(pane).toBeVisible();
  await expect(pane).not.toContainText('후 pane이 닫혀요');
  agent.status = 'error';
  agent.subtitle = '작업 상태를 확인해 주세요.';
  agent.subagent = {
    ...agent.subagent,
    state: 'error',
    finishedAt: finishedAt + 4000,
    closeAt: finishedAt + 7000,
  };
  state.stage.serverTime = finishedAt + 4000;
  await publish(page, state);
  await expect(pane.getByRole('status')).toHaveText('확인 필요');
  await page.clock.fastForward(3000);
  await expect(pane).toBeVisible();
  expect(await pane.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
});

test('six presentation panes and eight subagents keep desktop and mobile focus reachable', async ({
  page,
}, info) => {
  const state = snapshot('antigravity');
  state.stage.panes = [
    ...Array.from({ length: 6 }, (_, index): Pane => ({
      id: `docs-${index}`,
      kind: 'docs',
      title: `검토 ${index}`,
      content: '공개 검토 내용',
      subtitle: '',
      size: 1,
      status: 'done',
    })),
    ...Array.from({ length: 8 }, (_, index) => subagent(index + 1)),
  ];
  state.stage.focusId = 'subagent-8';
  await openStage(page, state);
  await expect(page.locator('.content-pane')).toHaveCount(14);
  await expect
    .poll(() =>
      page.getByLabel('구현 에이전트 8 pane').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const grid = element.parentElement!.getBoundingClientRect();
        return bounds.top >= grid.top - 2 && bounds.bottom <= grid.bottom + 2;
      }),
    )
    .toBe(true);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('subagent-many-desktop.png'),
  });
  await page.setViewportSize({ width: 320, height: 667 });
  state.stage.focusVersion++;
  await publish(page, state);
  await expect(page.getByLabel('구현 에이전트 8 pane')).toBeVisible();
  await expect
    .poll(() =>
      page.getByRole('button', { name: '구현 에이전트 8', exact: true }).evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const tabs = element.parentElement!.getBoundingClientRect();
        return bounds.left >= tabs.left - 1 && bounds.right <= tabs.right + 1;
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('subagent-many-mobile.png'),
  });
});
