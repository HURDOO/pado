import { test, expect, type Page } from '@playwright/test';
const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
async function post(page: Page, path: string, data = {}) {
  return page.request.post('/api/' + path, { headers: { Origin: origin }, data });
}
async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill(name);
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
}
const choice = {
  id: 'direction',
  kind: 'input',
  title: '질문 목록 비교',
  size: 3,
  decision: {
    question: '질문을 어떻게 보여줄까요?',
    context: '핵심 차이를 보고 골라 주세요.',
    options: [
      {
        id: 'cards',
        title: '카드형',
        summary: '본문과 상태가 잘 보입니다.',
        tradeoff: '한 번에 보이는 질문은 줄어듭니다.',
        preview:
          '<article style="padding:16px;border:1px solid #4169a1;border-radius:12px"><b>노트북 연결이 안 돼요</b><p>장비 · 파도팀</p><span style="background:#315b88;padding:4px 8px">접수됨</span></article><script>parent.comparisonUnsafe=true</script>',
      },
      {
        id: 'list',
        title: '목록형',
        summary: '여러 질문을 빠르게 훑어봅니다.',
        tradeoff: '본문은 펼쳐서 읽어야 합니다.',
        preview:
          '<div style="padding:12px;border-bottom:1px solid #4169a1">노트북 연결이 안 돼요 <small>파도팀</small></div><div style="padding:12px;border-bottom:1px solid #4169a1">발표 순서가 궁금해요 <small>달팀</small></div>',
      },
    ],
  },
};
const review = {
  id: 'handoff',
  kind: 'review',
  title: '변경과 검증',
  size: 3,
  review: {
    summary: '선택한 목록형 배치를 적용했습니다.',
    changes: [
      {
        title: '모바일 목록 개선',
        detail: '질문과 접수 상태를 한 줄에 표시합니다.',
        files: ['src/App.tsx', 'src/App.css'],
      },
    ],
    checks: [
      {
        id: 'inspect',
        label: '목록형 반영 확인',
        status: 'passed',
        evidence: '소스의 행 배치 확인. 실제 기기 조작을 뜻하지 않습니다.',
      },
      {
        id: 'failed',
        label: '키보드 포커스',
        status: 'failed',
        evidence: 'Tab 이동 시 상세 버튼을 건너뜁니다.',
      },
      {
        id: 'phone',
        label: '실제 Android',
        status: 'unverified',
        evidence: '물리 기기로 확인하지 못했습니다.',
        reproduction: { port: 3000, path: '/questions' },
      },
      {
        id: 'unknown',
        label: '없는 실행 결과',
        status: 'passed',
        runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        evidence: '잘못된 runId는 통과가 될 수 없습니다.',
      },
    ],
    limitations: ['키보드 이동 수정과 실제 기기 확인이 남아 있습니다.'],
  },
};
test('visual choice is shared, isolated, confirmed once and resumes the actual waiting runner', async ({
  page,
  browser,
}, info) => {
  await join(page, '선택자');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const viewer = await context.newPage();
  try {
    await join(viewer, '관객');
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await page.getByLabel('아이디어', { exact: true }).fill('선택 흐름 검증');
    await page.getByRole('button', { name: '프롬프트 보내기' }).click();
    await expect
      .poll(async () => (await (await page.request.get('/api/me')).json()).stage.phase)
      .toBe('waiting');
    expect(
      (await post(page, 'admin/present', { type: 'pane.upsert', pane: choice })).status(),
    ).toBe(200);
    for (const p of [page, viewer]) {
      await expect(p.getByLabel('질문 목록 비교 pane', { exact: true })).toBeVisible();
      await expect(p.getByRole('radio')).toHaveCount(2);
      expect(await p.evaluate(() => 'comparisonUnsafe' in window)).toBe(false);
      await expect(p.getByTitle('카드형 미리보기')).toHaveAttribute('sandbox', '');
    }
    await expect(viewer.getByRole('radio').first()).toBeDisabled();
    expect(
      (await post(viewer, 'input', { paneId: choice.id, values: { optionId: 'list' } })).status(),
    ).toBe(403);
    expect(
      (await post(page, 'input', { paneId: choice.id, values: { optionId: 'forged' } })).status(),
    ).toBe(400);
    await expect(page.getByRole('button', { name: '이 안으로 진행' })).toBeDisabled();
    await page.getByRole('radio', { name: /목록형/ }).check();
    expect((await (await page.request.get('/api/me')).json()).stage.phase).toBe('waiting');
    await page.getByLabel('추가 요청', { exact: false }).fill('상태는 파란색으로');
    await page.screenshot({ path: info.outputPath('decision-desktop.png') });
    await viewer.screenshot({ path: info.outputPath('decision-mobile-viewer.png') });
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.getByRole('button', { name: '이 안으로 진행' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath('decision-mobile.png') });
    const request = page.waitForRequest((request) => request.url().endsWith('/api/input'));
    await page.getByRole('button', { name: '이 안으로 진행' }).click();
    expect((await request).postDataJSON().values).toEqual({
      optionId: 'list',
      note: '상태는 파란색으로',
    });
    await expect(page.getByLabel('질문 목록 비교 pane', { exact: true })).toHaveCount(0);
    expect(
      (await post(page, 'input', { paneId: choice.id, values: { optionId: 'cards' } })).status(),
    ).toBe(403);
    await expect
      .poll(async () => (await (await page.request.get('/api/me')).json()).stage.phase)
      .toBe('idle');
  } finally {
    await post(page, 'admin/reset');
    await context.close();
  }
});
test('Review keeps evidence provenance, failures and unverified work visible on desktop/mobile and restores unchanged', async ({
  page,
}, info) => {
  await join(page, '검토자');
  await post(page, 'admin/login', { password: 'pado-test-only-password' });
  await post(page, 'admin/reset');
  try {
    expect(
      (await post(page, 'admin/present', { type: 'pane.upsert', pane: review })).status(),
    ).toBe(200);
    const pane = page.getByLabel('변경과 검증 pane', { exact: true });
    await expect(pane.getByLabel('검증 현황')).toHaveText('통과 1실패 1미검증 2');
    await expect(pane.getByText('에이전트 보고 · 자동 실행 근거 없음')).toHaveCount(2);
    await expect(pane.getByText('실행 근거를 확인하지 못함')).toBeVisible();
    await pane.getByText('관련 파일 2개').click();
    await expect(pane.getByText('src/App.tsx', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('review-desktop.png') });
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(pane).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await pane.getByText('검증 근거 / 확인 방법').nth(1).click();
      await expect(pane.getByText('Tab 이동 시 상세 버튼을 건너뜁니다.')).toBeVisible();
      await pane.getByText('검증 근거 / 확인 방법').nth(1).click();
    }
    await page.screenshot({ path: info.outputPath('review-mobile.png') });
    await pane.getByRole('button', { name: '재현 화면 보기' }).click();
    await expect(
      pane.getByText('내 화면에서 열기 · 조작은 실제 앱 데이터에 반영될 수 있어요'),
    ).toBeVisible();
    await expect(pane.getByText('미리보기를 연결하지 못했어요')).toBeVisible();
    await post(page, 'admin/present', { type: 'pane.close', id: review.id });
    await post(page, 'admin/present', { type: 'pane.show', id: review.id });
    await page.reload();
    await expect(
      page.getByLabel('변경과 검증 pane', { exact: true }).getByLabel('검증 현황'),
    ).toHaveText('통과 1실패 1미검증 2');
  } finally {
    await post(page, 'admin/reset');
  }
});
