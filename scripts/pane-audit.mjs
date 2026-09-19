import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

// Explicit manual audit runner. Only the dedicated test server is in scope, never the live stage.
const origin = 'http://127.0.0.1:14740';
const scenario = JSON.parse(await readFile(process.argv[2], 'utf8'));
const sourcePolicyHash = createHash('sha256')
  .update(await readFile('server/agent-instructions.ts'))
  .digest('hex');
if (!/^[a-zA-Z0-9_-]{1,60}$/.test(scenario.id)) throw new Error('Invalid audit ID');
const output = resolve('.pado/pane-audit-20260919/reports', `${Date.now()}-${scenario.id}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const desktop = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await desktop.newPage();
const viewer = await mobile.newPage();
const events = [];
const results = [];
const errors = [];
const abort = new AbortController();
let recording;
let started = Date.now();
let step = -1;
for (const p of [page, viewer]) p.on('pageerror', (error) => errors.push(error.message));
async function post(path, value = {}) {
  const response = await page.evaluate(
    async ({ path, value }) => {
      const r = await fetch('/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      return { status: r.status, body: await r.json() };
    },
    { path, value },
  );
  if (response.status !== 200)
    throw new Error(`${path}: ${response.status}: ${response.body.error}`);
  return response.body;
}
async function state() {
  return page.evaluate(async () => (await fetch('/api/me')).json());
}
async function screen() {
  return page.evaluate(async () => (await fetch('/api/tui/snapshot')).json());
}
async function join(p, nickname) {
  await p.goto(origin);
  await p.getByLabel('어떻게 불러 드릴까요?').fill(nickname);
  await p.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(p.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-connected', 'true');
}
async function shot(name) {
  await page.screenshot({ path: resolve(output, `${name}-desktop.png`) });
  await viewer.screenshot({ path: resolve(output, `${name}-mobile.png`) });
}
async function layout(p) {
  return p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    panes: [...document.querySelectorAll('.pane')].map((element) => {
      const r = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label'),
        focus: element.classList.contains('focused'),
        visible: r.width > 0 && r.height > 0,
        viewportArea:
          Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
          Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  }));
}
try {
  await join(page, 'Pane 검증');
  await post('admin/login', { password: 'pado-pane-audit-test-password' });
  if (scenario.reset !== false) await post('admin/reset');
  await join(viewer, '모바일 검증 관객');
  await expect
    .poll(async () => (await screen()).text, { timeout: 60000 })
    .toContain('for shortcuts');
  const cookie = (await desktop.cookies(origin)).find((cookie) => cookie.name === 'pado_session');
  const response = await fetch(origin + '/api/events', {
    headers: { Cookie: `pado_session=${cookie.value}` },
    signal: abort.signal,
  });
  recording = (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = frame.split('\n').find((line) => line.startsWith('data: '));
        if (!data) continue;
        const { stage } = JSON.parse(data.slice(6));
        events.push({
          ms: Date.now() - started,
          step,
          revision: stage.revision,
          phase: stage.phase,
          turn: !!stage.turn,
          focusId: stage.focusId,
          focusVersion: stage.focusVersion,
          panes: stage.panes,
        });
      }
    }
  })().catch((error) => {
    if (!abort.signal.aborted) throw error;
  });
  for (const turn of scenario.turns) {
    step++;
    started = Date.now();
    const before = (await state()).stage;
    if (before.turn || before.speaker) throw new Error('Audit stage is already occupied');
    await page.getByRole('button', { name: '손들고 참여하기' }).click();
    await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute(
      'data-controller',
      'true',
    );
    await page.getByLabel('Antigravity 터미널 입력').focus();
    await page.keyboard.insertText(turn.prompt);
    await page.keyboard.press('Enter');
    await expect.poll(async () => !!(await state()).stage.turn, { timeout: 20000 }).toBe(true);
    const answered = new Set();
    let nextShot = 0;
    const deadline = Date.now() + (turn.timeoutMs || 180000);
    while (Date.now() < deadline) {
      const { stage } = await state();
      const pending = stage.panes.find(
        (pane) => pane.kind === 'input' && pane.status === 'active' && !answered.has(pane.id),
      );
      if (pending && turn.answer) {
        await shot(`${step}-input`);
        const iframe = page.frameLocator(`iframe[title=${JSON.stringify(pending.title)}]`);
        for (const [label, value] of Object.entries(turn.answer.fields || {}))
          await iframe.getByLabel(label, { exact: true }).fill(value);
        if (turn.answer.button)
          await iframe.getByRole('button', { name: turn.answer.button, exact: false }).click();
        else if (turn.answer.firstButton) {
          const radio = iframe.locator('input[type=radio]');
          if (await radio.count()) await radio.first().check();
          await iframe.getByRole('button').first().click();
        }
        answered.add(pending.id);
      }
      if (!stage.turn) break;
      if (Date.now() >= nextShot) {
        await shot(`${step}-progress`);
        nextShot = Date.now() + 15000;
      }
      await delay(250);
    }
    const after = (await state()).stage;
    const browserChecks = [];
    if (!after.turn && turn.browserCheck) {
      const preview = after.panes.find((pane) => pane.kind === 'browser');
      if (!preview) browserChecks.push({ error: 'No Browser pane to inspect' });
      else {
        try {
          const frame = page.frameLocator(`[data-pane-id=${JSON.stringify(preview.id)}] iframe`);
          const control = frame.locator(turn.browserCheck.selector);
          const before = await control.textContent();
          for (let click = 0; click < turn.browserCheck.clicks; click++) await control.click();
          browserChecks.push({
            id: preview.id,
            selector: turn.browserCheck.selector,
            clicks: turn.browserCheck.clicks,
            before,
            after: await control.textContent(),
          });
        } catch (error) {
          browserChecks.push({ error: error.message });
        }
      }
    }
    await shot(`${step}-final`);
    const result = {
      step,
      prompt: turn.prompt,
      finished: !after.turn,
      stage: after,
      desktop: await layout(page),
      mobile: await layout(viewer),
      browserChecks,
      tui: (await screen()).text,
    };
    results.push(result);
    console.log(
      JSON.stringify({
        step,
        finished: result.finished,
        panes: after.panes.map(({ id, kind, title, size, status }) => ({
          id,
          kind,
          title,
          size,
          status,
        })),
        focus: after.focusId,
      }),
    );
    if (after.turn) {
      await post('admin/stop');
      break;
    }
  }
} catch (error) {
  errors.push(error.stack);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  abort.abort();
  await recording;
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify({ scenario, sourcePolicyHash, events, results, errors }, null, 2),
  );
  console.log('AUDIT_REPORT ' + resolve(output, 'report.json'));
  await browser.close();
}
