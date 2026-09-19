import { chromium, expect } from '@playwright/test';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

// Explicit one-time handoff. Never reset the stage, replace an app or overwrite a workspace.
const origin = 'http://192.168.10.13:4173';
const target = resolve('.pado/workspace/hackathon-ops');
if (existsSync(target))
  throw new Error('Working project already exists; do not overwrite or relaunch automatically.');
if (!existsSync('examples/hackathon-ops/package-lock.json'))
  throw new Error('Run the isolated smoke check first.');
const output = resolve('.pado/desk-handoff', randomUUID());
await mkdir(output, { recursive: true });
const preservedFiles = ['demo-board.html', 'event.json', 'verify.mjs', 'build-browser-event.mjs'];
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(resolve('.pado/workspace', file)))
    .digest('hex');
const beforeFiles = Object.fromEntries(
  await Promise.all(preservedFiles.map(async (file) => [file, await hash(file)])),
);
const browser = await chromium.launch({ headless: true });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const state = () => page.evaluate(async () => (await fetch('/api/me')).json());
async function join(p, nickname) {
  p.on('pageerror', (error) => errors.push(error.message));
  await p.goto(origin);
  await p.getByLabel('어떻게 불러 드릴까요?').fill(nickname);
  await p.getByRole('button', { name: 'Stage 입장하기' }).click();
  await expect(p.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-connected', 'true');
}
try {
  await join(page, '임시 베이스 연결');
  const before = (await state()).stage;
  if (before.turn || before.speaker || before.panes.some((pane) => pane.server))
    throw new Error('Live stage is occupied or has another app; leave it intact.');
  await writeFile(resolve(output, 'panes-before.json'), JSON.stringify(before.panes, null, 2), {
    flag: 'wx',
  });
  await cp('examples/hackathon-ops', target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (source) => !/(?:^|\/)(node_modules|data|dist)(?:\/|$)/.test(source),
  });
  await expect
    .poll(() => page.evaluate(async () => (await (await fetch('/api/tui/snapshot')).json()).text), {
      timeout: 60000,
    })
    .toContain('for shortcuts');
  await page.getByRole('button', { name: '손들고 참여하기' }).click();
  await expect(page.getByLabel('Antigravity TUI 화면')).toHaveAttribute('data-controller', 'true');
  await page.getByLabel('Antigravity 터미널 입력').focus();
  await page.keyboard.insertText(
    '사용자가 승인한 교체 가능한 임시 시연 베이스 /workspace/hackathon-ops를 준비해 두었다. 최종 시연 주제 확정은 아니다. 먼저 이 폴더의 README.md, AGENTS.md, docs/TASKS.md, docs/DECISIONS.md를 읽고 맥락을 파악해라. 기존 루트 파일 및 next-idea-browser pane은 보존한다. 앱 코드를 다시 만들거나 문서를 수정하지 말고 다음 네 helper 호출을 각각 순서대로 실행해라: (1) node /opt/pado/present.mjs exec desk-install --quiet --cwd hackathon-ops npm ci --no-audit --no-fund (2) node /opt/pado/present.mjs exec desk-check --quiet --cwd hackathon-ops npm run check (3) node /opt/pado/present.mjs exec desk-seed --quiet --cwd hackathon-ops npm run seed:demo (4) node /opt/pado/present.mjs serve hackathon-ops 3000 --quiet --cwd hackathon-ops npm run dev . 실패하면 멈추고 이유만 알려라. 성공하면 실제 서버 Browser인 hackathon-ops를 focus하고 size 3으로 만들어라. 별도 Docs/Input/File/Terminal은 지금 요청한 검토에 필요하지 않으니 만들지 않는다. presentation 파일이 필요하면 hackathon-ops 안에 새 이름으로 만들고 기존 event.json은 덮어쓰지 않는다. 팀 등록과 질문 접수 가능, 정책/운영자 답변은 후속 작업이라는 짧은 사실만 TUI에 안내하고 끝내라.',
  );
  await page.keyboard.press('Enter');
  await expect.poll(async () => !!(await state()).stage.turn, { timeout: 30000 }).toBe(true);
  const frame = page.frameLocator('[data-pane-id="hackathon-ops"] iframe');
  await expect(
    frame.getByRole('heading', { name: '지도 API 없이 시연할 방법이 있을까요?' }),
  ).toBeVisible({ timeout: 300000 });
  await expect.poll(async () => (await state()).stage.turn, { timeout: 90000 }).toBe(null);
  const after = (await state()).stage;
  for (const pane of before.panes) {
    const current = after.panes.find((p) => p.id === pane.id);
    expect(current).toBeTruthy();
    // Result focus may resize a prior pane; its content and identity must not change.
    const fingerprint = ({ size: _size, ...content }) =>
      createHash('sha256').update(JSON.stringify(content)).digest('hex');
    expect(fingerprint(current)).toBe(fingerprint(pane));
  }
  for (const [file, expected] of Object.entries(beforeFiles))
    expect(await hash(file)).toBe(expected);
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  await join(mobile, '베이스 모바일 확인');
  await expect(
    mobile
      .frameLocator('[data-pane-id="hackathon-ops"] iframe')
      .getByRole('heading', { name: '지도 API 없이 시연할 방법이 있을까요?' }),
  ).toBeVisible();
  for (const [name, p] of [
    ['desktop', page],
    ['mobile', mobile],
  ]) {
    expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const appFrame = p.frames().find((f) => f.url().startsWith('http://192.168.10.13:4273/'));
    expect(appFrame).toBeTruthy();
    expect(await appFrame.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await p.screenshot({ path: resolve(output, name + '.png') });
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      output,
      preservedFiles,
      panes: after.panes.map((p) => ({ id: p.id, kind: p.kind })),
      focus: after.focusId,
      errors,
    }),
  );
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify({ ok: true, errors, preservedFiles }, null, 2),
  );
} finally {
  await browser.close();
}
