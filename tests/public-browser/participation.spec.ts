import { test, expect } from '@playwright/test';
test('trusted public desktop and mobile restore native CLI controls without bypassing leases', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByLabel('어떻게 불러 드릴까요?').fill('공개 참여 검증');
  await page.getByRole('button', { name: 'Stage 입장하기' }).click();
  const post = (path: string, data: object) =>
    page.request.post('/api/' + path, {
      headers: { Origin: 'http://127.0.0.1:16473' },
      data,
    });
  const state = await (await page.request.get('/api/me')).json();
  expect(state.publicMode).toBe(true);
  expect(state.participantTui).toBe(true);
  await expect
    .poll(
      async () => {
        const snapshot = await (await page.request.get('/api/tui/snapshot')).json();
        return snapshot.status === 'ready' && !/Signing in|not signed in/.test(snapshot.text || '');
      },
      { timeout: 25000 },
    )
    .toBe(true);
  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect((await post('tui/input', { data: 'spectator' })).status()).toBe(403);
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await expect(page.getByLabel('아이디어', { exact: true })).toHaveCount(0);
    const guide = page.getByRole('complementary', { name: '데모 안내' });
    await expect(guide).toContainText('원하는 변화와 직접 고르고 싶은 부분을 설명해 보세요');
    const keys = page.getByLabel('터미널 보조 키');
    await expect(keys).toBeVisible();
    await expect(keys.getByRole('button')).toHaveCount(12);
    const [keysBounds, guideBounds] = await Promise.all([keys.boundingBox(), guide.boundingBox()]);
    expect(keysBounds).not.toBeNull();
    expect(guideBounds).not.toBeNull();
    expect(
      guideBounds!.y >= keysBounds!.y + keysBounds!.height ||
        guideBounds!.y + guideBounds!.height <= keysBounds!.y,
    ).toBe(true);
    const marker = `NATIVE_INPUT_${viewport.width}`;
    await page.getByLabel('Antigravity 터미널 입력').focus();
    const sent = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/tui/input') &&
        response.request().postDataJSON()?.data.includes(marker),
    );
    await page.keyboard.insertText(marker);
    expect((await sent).status()).toBe(200);
    await expect
      .poll(async () => (await (await page.request.get('/api/tui/snapshot')).json()).text)
      .toContain(marker);
    // Exercise native slash-menu keys without submitting a model request or changing settings.
    expect((await post('tui/input', { data: '\x15/help\r' })).status()).toBe(200);
    await expect
      .poll(async () => (await (await page.request.get('/api/tui/snapshot')).json()).text)
      .toContain('Quick Reference');
    await keys.getByRole('button', { name: 'Esc', exact: true }).click();
    await expect
      .poll(async () => (await (await page.request.get('/api/tui/snapshot')).json()).text)
      .not.toContain('Quick Reference');
    expect((await post('prompt', { prompt: 'obsolete form' })).status()).toBe(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`public-${viewport.width}.png`) });
    await page.getByRole('button', { name: '다음 분께 양보' }).click();
    await expect(keys).toHaveCount(0);
    expect((await post('tui/input', { data: 'after release' })).status()).toBe(403);
  }
});
