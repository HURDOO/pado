import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const origin = 'https://pado.hurdoo.kr';
const nativeInput = process.argv.includes('--native-input');
const browser = await chromium.launch();
await mkdir('.pado/deploy/verification', { recursive: true, mode: 0o700 });
try {
  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 390, height: 844 },
  ]) {
    // No ignoreHTTPSErrors: this checks the real Cloudflare certificate and routes.
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      const response = await page.goto(origin);
      expect(response.status()).toBe(200);
      await page.getByLabel('어떻게 불러 드릴까요?').fill('배포 화면 검증');
      await page.getByRole('button', { name: 'Stage 입장하기' }).click();
      await expect(page.locator('.topbar')).toBeVisible();
      const state = await (await page.request.get(origin + '/api/me')).json();
      if (nativeInput) {
        expect(state.publicMode).toBe(true);
        expect(state.participantTui).toBe(true);
        // Acquire a normal lease; never interrupt another participant or submit an AI request.
        await page
          .getByRole('button', { name: '손들고 참여하기', exact: true })
          .click({ timeout: 10000 });
        try {
          await expect(page.getByLabel('터미널 보조 키')).toBeVisible();
          await expect(page.getByLabel('아이디어', { exact: true })).toHaveCount(0);
          await page.getByLabel('Antigravity 터미널 입력').focus();
          const marker = `PADO_NATIVE_CHECK_${viewport.width}`;
          await page.keyboard.insertText(marker);
          await expect
            .poll(
              async () =>
                (await (await page.request.get(origin + '/api/tui/snapshot')).json()).text,
              { timeout: 10000 },
            )
            .toContain(marker);
          await page.screenshot({ path: `.pado/deploy/verification/native-${viewport.width}.png` });
        } finally {
          // Cleanup only while we still own this idle lease. Never clear someone else's input.
          const current = await (await page.request.get(origin + '/api/me')).json();
          if (!current.stage.turn && current.stage.speaker?.participantId === current.me.id) {
            await page.request.post(origin + '/api/tui/input', {
              headers: { Origin: origin },
              data: { data: '\x15' },
            });
            const released = await page.request.post(origin + '/api/release', {
              headers: { Origin: origin },
              data: {},
            });
            expect(released.status()).toBe(200);
            await expect(page.getByLabel('터미널 보조 키')).toHaveCount(0);
          }
        }
        const denied = await page.request.post(origin + '/api/tui/input', {
          headers: { Origin: origin },
          data: { data: 'spectator-denial-check' },
        });
        expect(denied.status()).toBe(403);
        console.log(
          JSON.stringify({
            viewport: viewport.width,
            verifiedTLS: true,
            nativeKeyboard: true,
            spectatorDenied: true,
          }),
        );
        continue;
      }
      const project = state.workspace.projects.find((project) => project.slot === 2);
      if (viewport.width < 600) await page.locator('#project-select').selectOption(project.id);
      else await page.getByRole('button', { name: project.name, exact: true }).click();
      const iframe = page.locator('.live-browser iframe');
      await expect(iframe).toBeVisible({ timeout: 20000 });
      const frame = await iframe.elementHandle().then((element) => element.contentFrame());
      await expect
        .poll(() => frame.url(), { timeout: 20000 })
        .toContain('https://pado-app-2-3000.hurdoo.kr/');
      await expect
        .poll(() => new URL(frame.url()).pathname, { timeout: 20000 })
        .not.toContain('__pado_preview');
      await frame.waitForLoadState('domcontentloaded');
      await expect
        .poll(async () => (await frame.locator('body').innerText()).trim().length)
        .toBeGreaterThan(40);
      expect(
        await frame.evaluate(() => {
          try {
            void parent.document;
            return false;
          } catch {
            return true;
          }
        }),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `.pado/deploy/verification/live-${viewport.width}.png` });
      console.log(
        JSON.stringify({
          viewport: viewport.width,
          verifiedTLS: true,
          nicknameJoin: true,
          authenticatedAppFrame: true,
          parentIsolated: true,
        }),
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
