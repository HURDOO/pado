import { test, expect, type Page, type Browser, type TestInfo } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';

async function checkFocusedReviewPane(page: Page) {
  await join(page, 'Focus 회귀');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('checkbox', { name: '모션 줄이기' }).check();
  await page.keyboard.press('Escape');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  for (const event of [
    {
      type: 'pane.upsert',
      pane: { id: 'fake', kind: 'terminal', title: 'Fake', content: 'passed', status: 'done' },
    },
    { type: 'terminal.append', id: 'run', stream: 'stdout', text: 'FAKE_SUCCESS' },
    { type: 'terminal.exit', id: 'run', code: 0 },
  ])
    expect((await post(page, 'admin/present', event)).status()).toBe(400);
  await post(page, 'raise');
  await post(page, 'prompt', { prompt: '리허설 출력 스트림 검증' });
  await expect(page.getByTitle('방향을 골라 주세요')).toBeVisible();
  await page
    .frameLocator('iframe[title="방향을 골라 주세요"]')
    .getByRole('button', { name: /Ocean blue/ })
    .click();
  await expect(page.locator('[data-pane-id="run"] .xterm-accessibility-tree')).toContainText(
    'Pane identifiers are unique',
  );
  for (const index of [1, 2, 4])
    await post(page, 'admin/present', {
      type: 'pane.upsert',
      pane: {
        id: `focus-${index}`,
        kind: 'docs',
        title: `Focus ${index}`,
        content: '검토 대상',
        size: 1,
      },
    });
  await post(page, 'admin/present', { type: 'pane.focus', id: 'focus-4' });
  const visible = () =>
    page.locator('[data-pane-id="focus-4"]').evaluate((element) => {
      const pane = element.getBoundingClientRect();
      const grid = element.parentElement!.getBoundingClientRect();
      return pane.top >= grid.top - 1 && pane.top + 53 <= grid.bottom;
    });
  await expect.poll(visible).toBe(true);
  await expect(page.locator('[data-pane-id="run"] .xterm-accessibility-tree')).toContainText(
    'stdout and stderr are streamed',
  );
  // Assert the user-visible invariant, not an exact scroll offset while layout settles.
  // The former scrollIntoView on the background log hid this focused review header.
  await expect.poll(visible).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await (await page.request.get('/api/me')).json()).stage.phase)
    .toBe('idle');
  await post(page, 'admin/present', { type: 'pane.focus', id: 'run' });
  await post(page, 'admin/present', { type: 'pane.focus', id: 'focus-4' });
  await expect
    .poll(() =>
      page.locator('.mobile-tabs [aria-pressed="true"]').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const tabs = element.parentElement!.getBoundingClientRect();
        return bounds.left >= tabs.left - 1 && bounds.right <= tabs.right + 1;
      }),
    )
    .toBe(true);
  await expect(page.getByLabel('Focus 4 pane', { exact: true })).toBeVisible();
  await post(page, 'admin/reset');
}

async function checkTasksPane(page: Page, browser: Browser, info: TestInfo) {
  await join(page, '작업 검토');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: origin,
  });
  const mobile = await mobileContext.newPage();
  try {
    await join(mobile, '작업 관객');
    const content =
      '# 프로젝트 작업\n\n- [x] **팀 등록** 검증 완료\n- [-] 질문 작성\n- [ ] 운영자 답변\n- [~] 공개 배포\n\n```md\n- [>] 문법 예시\n```\n\n<script>window.tasksUnsafe=true</script>';
    const pane = {
      id: 'tasks-review',
      kind: 'tasks',
      title: '작업 목록',
      content,
      subtitle: 'demo/docs/TASKS.md',
      size: 3,
    };
    await post(page, 'admin/present', { type: 'pane.upsert', pane });
    await post(page, 'admin/present', { type: 'pane.focus', id: pane.id });
    for (const p of [page, mobile]) {
      const tasks = p.getByLabel('작업 목록 pane', { exact: true });
      await expect(tasks).toBeVisible();
      await expect(tasks.getByRole('heading', { name: '작업 현황', exact: true })).toBeVisible();
      await expect(tasks.locator('.task-item')).toHaveCount(4);
      await expect(tasks.getByText(/선택된 다음 작업 없음/)).toBeVisible();
      await expect(tasks.locator('.tasks-summary .task-next')).toHaveText('다음0');
      expect(
        await tasks
          .locator('.task-description')
          .first()
          .evaluate((element) => {
            const style = getComputedStyle(element);
            return { color: style.color, fontSize: style.fontSize };
          }),
      ).toEqual({ color: 'rgb(225, 231, 240)', fontSize: '14px' });
      await expect(tasks.getByRole('checkbox')).toHaveCount(0);
      await expect(
        tasks.getByText('<script>window.tasksUnsafe=true</script>', { exact: true }),
      ).toBeVisible();
      expect(await p.evaluate(() => 'tasksUnsafe' in window)).toBe(false);
    }
    await page.screenshot({ path: info.outputPath('tasks-desktop.png') });
    await mobile.screenshot({ path: info.outputPath('tasks-mobile.png') });
    await post(page, 'admin/present', {
      type: 'pane.upsert',
      pane: { ...pane, content: content.replace('- [ ] 운영자 답변', '- [>] 운영자 답변') },
    });
    await expect(mobile.locator('.tasks-summary .task-next')).toHaveText('다음1');
    await expect(mobile.getByText(/선택된 다음 작업 없음/)).toHaveCount(0);
    expect((await (await page.request.get('/api/me')).json()).stage.panes).toHaveLength(1);
    await mobile.reload();
    await expect(mobile.locator('.tasks-summary .task-next')).toHaveText('다음1');
    await expect(mobile.getByRole('button', { name: '작업 목록 닫기' })).toHaveCount(0);
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await post(page, 'admin/present', {
      type: 'pane.upsert',
      pane: { ...pane, content: '- [>] A\n- [>] B' },
    });
    await expect(mobile.getByRole('alert')).toContainText('다음 작업이 여러 개');
    await post(page, 'admin/present', {
      type: 'pane.upsert',
      pane: { ...pane, content: '# 아직 계획 없음' },
    });
    await expect(mobile.getByText('아직 표시할 작업 항목이 없습니다.')).toBeVisible();
  } finally {
    await mobileContext.close();
    await post(page, 'admin/reset');
  }
}

test('short viewports keep participation controls reachable and motion settings persist', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await join(page, '작은 화면 확인');
  for (const viewport of [
    { width: 390, height: 400 },
    { width: 844, height: 390 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.empty-shapes')).not.toBeVisible();
    const button = page.getByRole('button', { name: '손들고 참여하기' });
    await expect(button).toBeEnabled();
    expect(
      await button.evaluate((element) => {
        const duration = getComputedStyle(element, '::after').animationDuration;
        return Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000);
      }),
    ).toBeLessThanOrEqual(0.01);
    // Viewport/media-query layout can settle between two separate boundingBox calls.
    await expect
      .poll(() =>
        button.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const pane = element.closest('.pane')!.getBoundingClientRect();
          return bounds.bottom <= pane.bottom && bounds.top >= pane.top;
        }),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    await button.click();
    await expect(page.getByLabel('아이디어', { exact: true })).toBeFocused();
    expect(
      Number.parseInt((await page.locator('.countdown').textContent())!, 10),
    ).toBeLessThanOrEqual(30);
    await page.getByLabel('아이디어', { exact: true }).fill('작은 화면에서도 아이디어 작성');
    await page.getByRole('button', { name: '다음 분께 양보' }).click();
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`compact-${viewport.width}x${viewport.height}.png`),
    });
  }
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('checkbox', { name: '모션 줄이기' }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'true');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '모션 줄이기' })).toBeChecked();
});

test('local generated form submit handlers work while actual form navigation stays blocked', async ({
  page,
}) => {
  await join(page, '폼 격리 확인');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const requests: string[] = [];
  await page.context().route('https://untrusted.example/**', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await post(page, 'admin/present', {
    type: 'pane.upsert',
    pane: {
      id: 'forms',
      kind: 'browser',
      title: '폼 확인',
      content: `<form id="local"><label>새 아이디어<input name="idea" required></label><button>추가</button></form><p id="result"></p><form action="https://untrusted.example/collect"><input name="value" value="test-only"><button>외부 전송</button></form><script>document.querySelector('#local').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#result').textContent=event.target.elements.idea.value});</script>`,
    },
  });
  const frame = page.frameLocator('iframe[title="폼 확인"]');
  await frame.getByLabel('새 아이디어').fill('폼으로 추가한 아이디어');
  await frame.getByRole('button', { name: '추가', exact: true }).click();
  await expect(frame.locator('#result')).toHaveText('폼으로 추가한 아이디어');
  const blocked = page.waitForEvent('console', (message) => message.text().includes('form-action'));
  await frame.getByRole('button', { name: '외부 전송' }).click();
  await blocked;
  expect(requests).toEqual([]);
  await expect(frame.locator('#result')).toHaveText('폼으로 추가한 아이디어');
  await post(page, 'admin/reset');
});

test('admin split resizing previews while dragging and commits once to the shared stage', async ({
  page,
}) => {
  await join(page, '크기 확인');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  for (const id of ['left', 'right'])
    await post(page, 'admin/present', {
      type: 'pane.upsert',
      pane: { id, kind: 'docs', title: id, content: '# Resize', size: 1 },
    });
  const handle = page.getByRole('separator', { name: 'left 크기 조절' });
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 5 });
  await expect(handle).toHaveAttribute('aria-valuenow', '1.5');
  const sharedSize = async () =>
    (await (await page.request.get(`${origin}/api/me`)).json()).stage.panes.find(
      (pane: { id: string }) => pane.id === 'left',
    ).size;
  expect(await sharedSize()).toBe(1);
  await page.mouse.up();
  await expect.poll(sharedSize).toBe(1.5);
  await page.setViewportSize({ width: 1100, height: 850 });
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(handle).toHaveAttribute('aria-valuenow', '1.75');
  await post(page, 'admin/reset');
});

test('HTML previews are explicit, interactive and isolated from parent and network', async ({
  page,
}, info) => {
  await join(page, '미리보기 확인');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  await post(page, 'admin/present', {
    type: 'pane.upsert',
    pane: {
      id: 'preview',
      kind: 'browser',
      title: '아이디어 미리보기',
      content: `<style>body{background:#102034;color:white;font:16px system-ui;padding:24px}button{font:inherit;padding:10px}</style><h1>아이디어 보드</h1><button onclick="this.textContent='추가 완료'">추가하기</button><p id="parent"></p><p id="network"></p><script>try{parent.document.body;document.querySelector('#parent').textContent='exposed'}catch{document.querySelector('#parent').textContent='parent blocked'}fetch('https://untrusted.example/probe').then(()=>document.querySelector('#network').textContent='exposed').catch(()=>document.querySelector('#network').textContent='network blocked')</script>`,
    },
  });
  const frame = page.frameLocator('iframe[title="아이디어 미리보기"]');
  await frame.getByRole('button', { name: '추가하기' }).click();
  await expect(frame.getByRole('button', { name: '추가 완료' })).toBeVisible();
  await expect(frame.locator('#parent')).toHaveText('parent blocked');
  await expect(frame.locator('#network')).toHaveText('network blocked');
  await expect(page.getByTitle('아이디어 미리보기')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-forms',
  );
  await page.screenshot({ animations: 'disabled', path: info.outputPath('preview-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: 'disabled', path: info.outputPath('preview-mobile.png') });
  await post(page, 'admin/reset');
});

test('Markdown stays readable without rendering executable HTML or unsafe links', async ({
  page,
  browser,
}, info) => {
  await join(page, '문서 확인');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  await post(page, 'admin/present', {
    type: 'pane.upsert',
    pane: {
      id: 'readable-docs',
      kind: 'docs',
      title: '구현 계획',
      status: 'done',
      content:
        '# 함께 만드는 아이디어 보드\n\n### 이번 작업\n\n1. **키보드로도** 아이디어를 추가합니다.\n2. 결과는 `index.html`에서 확인합니다.\n\n| 항목 | 횟수 |\n| :--- | ---: |\n| **로그인** | 2 |\n| <img src=x onerror="window.UNSAFE=true"> | 1 |\n\n```html\n<script>window.UNSAFE=true</script>\n```\n\n[위험 링크](javascript:alert(1))\n<img src=x onerror="window.UNSAFE=true">\n\n> 공개할 내용만 이 공간에 표시합니다.',
    },
  });
  const pane = page.getByLabel('구현 계획 pane');
  await expect(pane.getByRole('heading', { name: '이번 작업' })).toBeVisible();
  await expect(pane.locator('strong').filter({ hasText: '키보드로도' })).toBeVisible();
  await expect(pane.getByRole('listitem')).toHaveCount(2);
  await expect(pane.getByRole('columnheader')).toHaveCount(2);
  await expect(pane.getByRole('cell', { name: '로그인', exact: true })).toBeVisible();
  await expect(pane.locator('script, img, a')).toHaveCount(0);
  expect(await page.evaluate(() => 'UNSAFE' in window)).toBe(false);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('markdown-desktop.png') });
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const mobile = await context.newPage();
  await join(mobile, '문서 모바일');
  await expect(mobile.getByLabel('구현 계획 pane')).toBeVisible();
  await expect(mobile.getByRole('table')).toBeVisible();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await mobile.screenshot({ animations: 'disabled', path: info.outputPath('markdown-mobile.png') });
  await context.close();
  await post(page, 'admin/reset');
});

test('an expired session returns to entry instead of reconnecting forever', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const Native = window.EventSource;
    Object.assign(window, { padoTestSources: [] });
    window.EventSource = class extends Native {
      constructor(url: string | URL, config?: EventSourceInit) {
        super(url, config);
        (window as unknown as { padoTestSources: EventSource[] }).padoTestSources.push(this);
      }
    };
  });
  await join(page, '재접속 확인');
  await context.addCookies([
    {
      name: 'pado_session',
      value: 'expired-test-token',
      url: origin,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await page.evaluate(() =>
    (window as unknown as { padoTestSources: EventSource[] }).padoTestSources
      .at(-1)
      ?.dispatchEvent(new Event('error')),
  );
  await expect(page.getByRole('button', { name: 'Stage 입장하기' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('세션이 종료');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('다시 입장');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(page.locator('.connection')).toHaveText('연결됨');
});
async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(name);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(page.locator('.connection')).toHaveText('연결됨');
}
async function post(page: Page, path: string, value = {}) {
  const request = () =>
    page.request.post(`${origin}/api/${path}`, { headers: { Origin: origin }, data: value });
  const result = await request();
  // Preserve the real production authentication rate limit. Long suites respect its backoff.
  if (path === 'admin/login' && result.status() === 429) {
    test.setTimeout(100_000);
    await delay(
      Math.min(60, Math.max(1, Number(result.headers()['retry-after']) || 60)) * 1000 + 100,
    );
    return request();
  }
  return result;
}
test('two spectators share lease, isolated input, live output and completed result; mobile focus works', async ({
  browser,
  page,
}, info) => {
  // Plain HTTP over LAN/WireGuard does not expose secure-context-only randomUUID.
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: origin,
  });
  const mobile = await mobileContext.newPage();
  await page.goto('/');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('entry-desktop.png') });
  await join(page, '민서');
  await join(mobile, '지우');
  const raiseButton = page.getByRole('button', { name: '손들고 참여하기' });
  expect(
    await raiseButton.evaluate((element) => getComputedStyle(element, '::after').animationName),
  ).toBe('raise-button-glow');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('stage-desktop.png') });
  await mobile.screenshot({ animations: 'disabled', path: info.outputPath('stage-mobile.png') });
  await raiseButton.click();
  await expect(mobile.getByRole('button', { name: '손들고 참여하기' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '데모 안내' })).toContainText(
    '원하는 변화와 직접 고르고 싶은 부분을 설명해 보세요',
  );
  await expect(mobile.getByRole('complementary', { name: '데모 안내' })).toContainText(
    '다른 참가자가 요청을 준비하고 있어요',
  );
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('demo-guide-desktop.png'),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '이렇게 요청해 보세요' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('demo-guide-mobile.png'),
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  const forged = await post(mobile, 'prompt', { prompt: 'not my turn' });
  expect(forged.status()).toBe(403);
  await page.getByLabel('아이디어', { exact: true }).fill('해커톤 아이디어 보드를 만들어 줘');
  await page.getByRole('button', { name: '프롬프트 보내기' }).click();
  await expect(page.getByTitle('방향을 골라 주세요')).toBeVisible();
  await expect(mobile.getByText('발언자의 선택을 기다리고 있어요')).toBeVisible();
  expect(
    (await post(mobile, 'input', { paneId: 'direction', values: { theme: 'Midnight' } })).status(),
  ).toBe(403);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('input-desktop.png') });
  await mobile.screenshot({ animations: 'disabled', path: info.outputPath('input-mobile.png') });
  const inputFrame = page.frameLocator('iframe[title="방향을 골라 주세요"]');
  const sandbox = await page.getByTitle('방향을 골라 주세요').getAttribute('sandbox');
  expect(sandbox).toBe('allow-scripts allow-forms');
  await inputFrame.getByRole('button', { name: /Ocean blue/ }).click();
  await expect(page.locator('[data-pane-id="run"] .xterm-accessibility-tree')).toContainText(
    'Pane identifiers are unique',
  );
  expect((await (await page.request.get(`${origin}/api/me`)).json()).stage.phase).toBe('running');
  await expect(page.locator('[data-pane-id="run"] .xterm-accessibility-tree')).toContainText(
    '3 checks passed · exit 0',
  );
  await expect(page.getByLabel('stage-result.json pane')).toBeVisible();
  await expect(mobile.getByLabel('작업 검토 pane', { exact: true })).toBeVisible();
  await mobile
    .getByRole('navigation')
    .getByRole('button', { name: /stage-result.json/ })
    .click();
  await expect(mobile.getByLabel('stage-result.json pane')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('result-desktop.png') });
  await mobile.screenshot({ animations: 'disabled', path: info.outputPath('result-mobile.png') });
  const terminal = page.locator('[data-pane-id="run"]');
  await expect(terminal.getByLabel('실행 명령', { exact: true })).toHaveText(
    '❯node scripts/rehearsal.mjs',
  );
  await expect(terminal.locator('.terminal-result')).toContainText('종료 코드 0');
  await expect(terminal.locator('.terminal-output')).toHaveAttribute(
    'data-run-id',
    /^[a-f0-9-]{36}$/,
  );
  await mobile
    .getByRole('navigation')
    .getByRole('button', { name: /리허설 실행 확인/ })
    .click();
  await expect(mobile.locator('[data-pane-id="run"] .terminal-result')).toContainText('읽기 전용');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('terminal-desktop.png') });
  await mobile.screenshot({ animations: 'disabled', path: info.outputPath('terminal-mobile.png') });
  await mobile.getByRole('navigation').getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(mobile.getByRole('button', { name: '손들고 참여하기' })).toBeEnabled();
  await mobile.reload();
  await expect(mobile.getByLabel('작업 검토 pane', { exact: true })).toBeVisible();
  await mobile.setViewportSize({ width: 320, height: 667 });
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await mobileContext.close();
});
test('concurrent hand requests have one winner and generated HTML cannot access parent or fetch', async ({
  page,
  browser,
}) => {
  await join(page, '보안 확인');
  expect((await post(page, 'admin/login', { password: 'pado-test-only-password' })).status()).toBe(
    200,
  );
  await post(page, 'admin/reset');
  const otherContext = await browser.newContext({ baseURL: origin });
  const other = await otherContext.newPage();
  await join(other, '두 번째 참가자');
  const results = await Promise.all([post(page, 'raise'), post(other, 'raise')]);
  expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
  await post(page, 'admin/reset');
  await post(page, 'admin/present', {
    type: 'pane.upsert',
    pane: {
      id: 'boundary-check',
      kind: 'input',
      title: '격리 확인',
      content: `<p id="parent">checking</p><p id="network">checking</p><script>try{parent.document.body;document.querySelector('#parent').textContent='parent exposed'}catch{document.querySelector('#parent').textContent='parent blocked'}fetch('https://untrusted.example/probe').then(()=>document.querySelector('#network').textContent='network exposed').catch(()=>document.querySelector('#network').textContent='network blocked')</script>`,
    },
  });
  const iframe = page.frameLocator('iframe[title="격리 확인"]');
  await expect(iframe.locator('#parent')).toHaveText('parent blocked');
  await expect(iframe.locator('#network')).toHaveText('network blocked');
  await post(page, 'admin/reset');
  await otherContext.close();
});
test('admin boundaries, pane controls and reset', async ({ page }, info) => {
  await join(page, '진행자');
  expect((await post(page, 'admin/reset')).status()).toBe(403);
  const csrf = await page.request.post(`${origin}/api/raise`, {
    headers: { Origin: 'https://untrusted.example' },
    data: {},
  });
  expect(csrf.status()).toBe(403);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('관리자 비밀번호').fill('pado-test-only-password');
  const loginResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/admin/login'),
  );
  await page.getByRole('button', { name: '관리자 모드 시작' }).click();
  const login = await loginResponse;
  if (login.status() === 429) {
    test.setTimeout(100_000);
    await delay(
      Math.min(60, Math.max(1, Number(login.headers()['retry-after']) || 60)) * 1000 + 100,
    );
    await page.getByRole('button', { name: '관리자 모드 시작' }).click();
  }
  await expect(page.locator('.admin-toolbar')).toBeVisible();
  await post(page, 'admin/reset');
  await page.getByRole('button', { name: '안내 열기' }).click();
  await expect(page.getByLabel('Stage 안내 pane')).toBeVisible();
  await page.getByRole('button', { name: 'Stage 안내 확대', exact: true }).click();
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '1.5');
  await page.getByRole('separator').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '1.75');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('admin-desktop.png') });
  await page.getByRole('button', { name: 'Stage 안내 닫기' }).click();
  await expect(page.getByLabel('Stage 안내 pane')).toHaveCount(0);
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await page.getByRole('button', { name: '발언권 회수', exact: true }).click();
  await expect(page.getByRole('button', { name: '손들고 참여하기' })).toBeEnabled();
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await page.getByLabel('아이디어', { exact: true }).fill('중단 테스트');
  await page.getByRole('button', { name: '프롬프트 보내기' }).click();
  await expect(page.getByTitle('방향을 골라 주세요')).toBeVisible();
  await page.getByRole('button', { name: '작업 중단', exact: true }).click();
  await expect(page.getByRole('button', { name: '손들고 참여하기' })).toBeEnabled();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(
    page.getByText('새로운 아이디어를 기다리고 있어요.', { exact: false }),
  ).toBeVisible();
});

test('generated input runtime errors are reported and a repaired pane is usable', async ({
  page,
}) => {
  await join(page, '입력 오류 확인');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await page.getByLabel('아이디어', { exact: true }).fill('입력 오류 복구');
  await page.getByRole('button', { name: '프롬프트 보내기' }).click();
  await expect(page.getByTitle('방향을 골라 주세요')).toBeVisible();
  const pane = {
    id: 'direction',
    kind: 'input',
    title: '복구 확인',
    content: '<button onclick="missingVariable()">선택하기</button>',
  };
  await post(page, 'admin/present', { type: 'pane.upsert', pane });
  await page
    .frameLocator('iframe[title="복구 확인"]')
    .getByRole('button', { name: '선택하기' })
    .click();
  await expect(page.getByRole('alert')).toContainText('에이전트에게 수정을 요청했습니다');
  await post(page, 'admin/present', {
    type: 'pane.upsert',
    pane: {
      ...pane,
      content: `<button onclick="window.pado.submit({theme:'Midnight'})">수정된 선택</button>`,
    },
  });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page
    .frameLocator('iframe[title="복구 확인"]')
    .getByRole('button', { name: '수정된 선택' })
    .click();
  await expect(page.getByLabel('stage-result.json pane')).toContainText('Midnight');
  await post(page, 'admin/reset');
});

// Keep this after the interactive admin-login test; helper logins respect Retry-After.
test('Tasks shows explicit states, shared updates and safe read-only mobile content', async ({
  page,
  browser,
}, info) => {
  await checkTasksPane(page, browser, info);
});

test('explicit focus brings a review pane into view and background terminal output does not steal it', async ({
  page,
}) => {
  await checkFocusedReviewPane(page);
});

test('spectators can scroll long generated choices without activating or submitting them', async ({
  page,
  browser,
}, info) => {
  await join(page, '읽기 전용 확인');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: origin,
  });
  const viewer = await context.newPage();
  try {
    await join(viewer, '관객 읽기');
    await post(page, 'admin/present', {
      type: 'pane.upsert',
      pane: {
        id: 'long-choice',
        kind: 'input',
        title: '긴 선택지',
        size: 2,
        content:
          '<h2>선택 안내</h2><p style="height:1100px">자세한 비교 내용</p><button onclick="document.body.dataset.clicked=\'true\';window.pado.submit({choice:\'no\'})">아래쪽 선택</button>',
      },
    });
    const iframe = viewer.frameLocator('iframe[title="긴 선택지"]');
    await expect(iframe.getByRole('button', { name: '아래쪽 선택' })).toBeDisabled();
    const bounds = (await viewer.getByTitle('긴 선택지').boundingBox())!;
    await viewer.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await viewer.mouse.wheel(0, 1400);
    await expect.poll(() => iframe.locator('body').evaluate(() => scrollY)).toBeGreaterThan(500);
    await iframe.getByRole('button', { name: '아래쪽 선택' }).dispatchEvent('click');
    expect(await iframe.locator('body').getAttribute('data-clicked')).toBe(null);
    expect(
      (
        await post(viewer, 'input', { paneId: 'long-choice', values: { choice: 'forged' } })
      ).status(),
    ).toBe(403);
    await viewer.screenshot({
      animations: 'disabled',
      path: info.outputPath('spectator-scroll-mobile.png'),
    });
  } finally {
    await context.close();
    await post(page, 'admin/reset');
  }
});

test('project browsing preserves separate panes, designation rejects busy/stale actions, and views restore on mobile', async ({
  page,
  browser,
}, info) => {
  await join(page, '프로젝트 진행자');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: origin,
  });
  const viewer = await context.newPage();
  try {
    await join(viewer, '공유 관객');
    await post(page, 'admin/present', {
      type: 'pane.upsert',
      pane: { id: 'tasks', kind: 'tasks', title: 'A 작업', content: '- [x] 기존 프로젝트' },
    });
    const projects = page.getByRole('navigation', { name: '프로젝트 목록' });
    const initial = await (await page.request.get('/api/me')).json();
    const defaultName = initial.workspace.projects.find(
      (project: { id: string }) => project.id === 'default',
    ).name;
    await expect(projects.getByRole('button', { name: defaultName, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByLabel('프로젝트', { exact: true })).toBeHidden();
    await expect(viewer.getByLabel('A 작업 pane', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '새 프로젝트', exact: true }).click();
    await page.getByLabel('새 프로젝트 이름', { exact: true }).fill('분리된 실험');
    await page.getByRole('button', { name: '만들고 열기' }).click();
    await expect(page.getByRole('heading', { name: '분리된 실험' })).toBeVisible();
    await expect(viewer.getByLabel('A 작업 pane', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '참여 프로젝트로 지정' }).click();
    await expect(viewer.getByRole('heading', { name: '분리된 실험' })).toBeVisible();
    await expect(viewer.getByLabel('프로젝트', { exact: true })).toBeEnabled();
    await expect(viewer.locator('.content-pane')).toHaveCount(0);
    const current = await (await page.request.get('/api/me')).json();
    const otherId = current.workspace.activeId;
    expect(otherId).not.toBe('default');
    expect((await post(viewer, 'admin/projects/select', { id: 'default' })).status()).toBe(403);
    const stale = await page.request.post('/api/admin/present', {
      headers: { Origin: origin, 'X-Pado-Project': 'default' },
      data: { type: 'pane.close', id: 'tasks' },
    });
    expect(stale.status()).toBe(403);
    await post(page, 'admin/present', {
      type: 'pane.upsert',
      pane: { id: 'tasks', kind: 'tasks', title: 'B 작업', content: '- [>] 별도 작업', size: 3 },
    });
    await expect(
      projects.getByRole('button', { name: '분리된 실험', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await projects.getByRole('button', { name: defaultName, exact: true }).click();
    await page.getByRole('button', { name: '참여 프로젝트로 지정' }).click();
    await expect(viewer.getByLabel('A 작업 pane', { exact: true })).toBeVisible();
    await expect(viewer.getByLabel('B 작업 pane', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await expect(projects.getByRole('button', { name: '분리된 실험', exact: true })).toBeEnabled();
    expect((await post(page, 'admin/projects/select', { id: otherId })).status()).toBe(409);
    await projects.getByRole('button', { name: '분리된 실험', exact: true }).click();
    await expect(page.getByRole('button', { name: '참여 프로젝트로 지정' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '손들고 참여하기' })).toHaveCount(0);
    await projects.getByRole('button', { name: defaultName, exact: true }).click();
    await page.getByLabel('아이디어', { exact: true }).fill('새 turn');
    await page.getByRole('button', { name: '프롬프트 보내기' }).click();
    await expect(viewer.getByLabel('A 작업 pane', { exact: true })).toHaveCount(0);
    await expect(projects.getByRole('button', { name: '분리된 실험', exact: true })).toBeEnabled();
    await post(page, 'admin/stop');
    await post(page, 'admin/present', { type: 'pane.show', id: 'tasks', size: 3 });
    await expect(viewer.getByLabel('A 작업 pane', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('projects-desktop.png') });
    await viewer.screenshot({ path: info.outputPath('projects-mobile.png') });
    await projects.getByRole('button', { name: '분리된 실험', exact: true }).click();
    await expect(viewer.getByLabel('A 작업 pane', { exact: true })).toBeVisible();
    await viewer.getByLabel('프로젝트', { exact: true }).selectOption(otherId);
    await expect(viewer.getByLabel('B 작업 pane', { exact: true })).toBeVisible();
    await viewer.reload();
    await expect(viewer.getByLabel('B 작업 pane', { exact: true })).toBeVisible();
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await projects.getByRole('button', { name: defaultName, exact: true }).click();
    await expect(page.getByLabel('A 작업 pane', { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await post(page, 'admin/reset');
  }
});
