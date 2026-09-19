import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { AppRuntime } from '../server/app-runtime.ts';
import { runtimeRequestSchema } from '../shared/protocol.ts';

// Trusted harness only. All example installation, tests and app execution stay in AppRuntime.
const output = resolve('.pado/desk-review', randomUUID());
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/playwright');
const workspace = resolve(output, 'workspace');
await mkdir(workspace, { recursive: true });
await cp('examples/hackathon-ops', resolve(workspace, 'hackathon-ops'), {
  recursive: true,
  errorOnExist: true,
  force: false,
  filter: (source) => !/(?:^|\/)(node_modules|dist|data)(?:\/|$)/.test(source),
});
const runtime = new AppRuntime();
let browser;
const errors = [];
const run = async (action, command) => {
  const result = await runtime.execute(
    runtimeRequestSchema.parse({
      requestId: randomUUID(),
      id: 'desk',
      action,
      cwd: 'hackathon-ops',
      port: 3000,
      display: 'none',
      command,
    }),
    workspace,
    () => {},
  );
  console.log(result.output);
  if (!result.ok) throw new Error('Sandbox command failed: ' + result.code);
};
const url = () => `http://127.0.0.1:${runtime.target(3000).port}`;
try {
  await run('exec', [
    'npm',
    existsSync('examples/hackathon-ops/package-lock.json') ? 'ci' : 'install',
    '--no-audit',
    '--no-fund',
  ]);
  await run('exec', ['npm', 'run', 'check']);
  await run('serve', ['npm', 'run', 'dev']);
  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await desktop.newPage();
  const phone = await mobile.newPage();
  for (const p of [page, phone]) p.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url());
  await expect(page.getByText('첫 번째 질문을 기다리고 있어요.')).toBeVisible();
  await page.screenshot({ path: resolve(output, 'empty-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '팀 등록', exact: true }).click();
  await page.getByLabel('팀 이름', { exact: true }).fill('검증팀');
  await page.getByLabel('프로젝트 한 줄 소개').fill('모바일에서 사용하는 질문 도우미');
  await page.getByRole('button', { name: '팀 등록하기' }).click();
  await expect(page.getByRole('status')).toContainText('팀을 등록했어요');
  await page.getByLabel('질문 제목').fill('질문이 다른 화면에도 보이나요?');
  await page
    .getByLabel('자세한 내용')
    .fill('새로고침과 서버 재시작 뒤에도 보이는지 확인하고 싶어요.');
  await page.getByRole('button', { name: '질문 접수하기' }).click();
  await expect(page.getByRole('heading', { name: '질문이 다른 화면에도 보이나요?' })).toBeVisible();
  await phone.goto(url());
  await expect(
    phone.getByRole('heading', { name: '질문이 다른 화면에도 보이나요?' }),
  ).toBeVisible();
  await phone.getByLabel('질문하는 팀').selectOption({ label: '검증팀' });
  await phone.getByRole('combobox', { name: /질문 분야/ }).selectOption('운영');
  await phone.getByLabel('질문 제목').fill('모바일에서 보낸 질문');
  await phone.getByLabel('자세한 내용').fill('가로 스크롤 없이 폼을 작성합니다.');
  await phone.getByRole('button', { name: '질문 접수하기' }).click();
  await expect(page.getByRole('heading', { name: '모바일에서 보낸 질문' })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole('button', { name: '규칙', exact: true }).click();
  await expect(page.getByText('이 분야의 질문은 아직 없어요.')).toBeVisible();
  await page.getByRole('button', { name: '전체', exact: true }).click();
  await page.getByRole('button', { name: '팀 등록', exact: true }).click();
  await page.getByLabel('팀 이름', { exact: true }).fill('검증팀');
  await page.getByLabel('프로젝트 한 줄 소개').fill('중복 거부 확인');
  await page.getByRole('button', { name: '팀 등록하기' }).click();
  await expect(page.getByRole('alert')).toContainText('이미 등록된 팀');
  await page.getByRole('button', { name: '질문 접수', exact: true }).click();
  await page.route('**/api/board', (route) => route.abort());
  await expect(page.getByRole('alert')).toContainText('목록을 갱신하지 못했어요', {
    timeout: 12000,
  });
  await page.unroute('**/api/board');
  await page.getByRole('button', { name: '다시 확인' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  for (const privatePath of [
    '/api.ts',
    '/data/desk.sqlite',
    '/@fs/workspace/hackathon-ops/api.ts',
  ]) {
    const response = await fetch(url() + privatePath);
    const body = await response.text();
    if (body.includes('CREATE TABLE') || body.startsWith('SQLite format'))
      throw new Error('Private app file exposed');
  }
  await run('exec', ['npm', 'run', 'seed:demo']);
  await expect(
    page.getByRole('heading', { name: '지도 API 없이 시연할 방법이 있을까요?' }),
  ).toBeVisible({ timeout: 10000 });
  await run('serve', ['npm', 'run', 'dev']);
  await page.goto(url());
  await phone.goto(url());
  await expect(page.getByRole('heading', { name: '모바일에서 보낸 질문' })).toBeVisible();
  for (const [name, p] of [
    ['desktop', page],
    ['mobile', phone],
  ]) {
    await expect(p.getByRole('heading', { name: '질문이 다른 화면에도 보이나요?' })).toBeVisible();
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(name + ' overflow');
    await p.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      output,
      errors,
      checks: [
        'typecheck',
        '4 API tests',
        'build',
        'empty state',
        'desktop registration',
        'mobile question',
        'shared refresh',
        'duplicate error',
        'category filter',
        'network recovery',
        'source/database isolation',
        'server restart persistence',
        'desktop/mobile overflow',
      ],
    }),
  );
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: true, errors }, null, 2));
  // Lockfile is generated by the sandbox, not by executing app tooling on the host.
  if (!existsSync('examples/hackathon-ops/package-lock.json'))
    await cp(
      resolve(workspace, 'hackathon-ops/package-lock.json'),
      'examples/hackathon-ops/package-lock.json',
      { force: false, errorOnExist: true },
    );
} finally {
  await browser?.close();
  await runtime.stop();
}
