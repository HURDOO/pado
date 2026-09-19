import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { AppRuntime } from '../server/app-runtime.ts';
import { sandboxDocument } from '../web/src/sandbox.ts';

const output = resolve('.pado/demo-projects-check', randomUUID());
const workspace = resolve(output, 'workspace');
await mkdir(workspace, { recursive: true });
await cp('examples/dev-blog', resolve(workspace, 'dev-blog'), { recursive: true });
const original = await readFile('.pado/workspace/demo-board.html', 'utf8');
const board = await readFile('examples/idea-board/index.html', 'utf8');
expect(createHash('sha256').update(board).digest('hex')).toBe(
  createHash('sha256').update(original).digest('hex'),
);
const runtime = new AppRuntime();
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
try {
  const checked = await runtime.execute(
    {
      requestId: randomUUID(),
      action: 'exec',
      id: 'blog-check',
      cwd: 'dev-blog',
      display: 'none',
      command: ['npm', 'run', 'check'],
    },
    workspace,
    () => {},
  );
  expect(checked.ok, checked.output).toBe(true);
  const served = await runtime.execute(
    {
      requestId: randomUUID(),
      action: 'serve',
      id: 'dev-blog',
      port: 3000,
      cwd: 'dev-blog',
      display: 'none',
      command: ['npm', 'run', 'dev'],
    },
    workspace,
    () => {},
  );
  expect(served.ok, served.output).toBe(true);
  const url = `http://127.0.0.1:${runtime.target(3000)!.port}`;
  for (const viewport of [
    { width: 1280, height: 960 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await expect(page.locator('.post-card')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({
      path: resolve(output, `blog-list-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByLabel('기록 검색').fill('실패');
    await expect(page.locator('.post-card')).toHaveCount(1);
    await expect(
      page.getByRole('heading', { name: '실패 로그를 다음 테스트로 바꾸기' }),
    ).toBeVisible();
    await page.getByLabel('기록 검색').fill('there-is-no-post');
    await expect(page.getByText('아직 일치하는 기록이 없어요')).toBeVisible();
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await expect(page.locator('.post-card')).toHaveCount(3);
    await page.getByRole('button', { name: 'Frontend', exact: true }).click();
    await expect(page.locator('.post-card')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: '화면을 덜 보여주는 연습' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Frontend', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '전체', exact: true }).click();
    await page.getByRole('link', { name: '작은 API에도 경계가 필요하다', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '작은 API에도 경계가 필요하다', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.code-block pre')).toContainText('const post = posts.find');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: '작은 API에도 경계가 필요하다', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({
      path: resolve(output, `blog-detail-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole('link', { name: '← 모든 기록', exact: true }).click();
    await expect(page.locator('.post-card')).toHaveCount(3);
    await page.goto(url + '/posts/missing');
    await expect(page.getByRole('heading', { name: '기록을 찾을 수 없어요' })).toBeVisible();
    await page.close();
  }
  // A real content file exercises the text-only Markdown renderer without executing it on the host.
  const contentFile = resolve(workspace, 'dev-blog/content/small-api-boundaries.md');
  await writeFile(
    contentFile,
    (await readFile(contentFile, 'utf8')) + '\n<script>window.blogUnsafe = true</script>\n',
  );
  const safety = await browser.newPage();
  await safety.goto(url + '/posts/small-api-boundaries');
  await expect(
    safety.getByText('<script>window.blogUnsafe = true</script>', { exact: true }),
  ).toBeVisible();
  expect(await safety.evaluate(() => 'blogUnsafe' in window)).toBe(false);
  await safety.close();
  for (const viewport of [
    { width: 1280, height: 960 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      '<style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe title="원본 아이디어 보드" sandbox="allow-scripts allow-forms"></iframe>',
    );
    await page.locator('iframe').evaluate((frame, html) => {
      (frame as HTMLIFrameElement).srcdoc = html;
    }, sandboxDocument(board));
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('.card')).toHaveCount(3);
    await frame.locator('#newIdeaInput').fill('독립 프로젝트 검증 아이디어');
    await frame.getByRole('button', { name: '추가', exact: true }).click();
    await expect(frame.locator('.card')).toHaveCount(4);
    const card = frame
      .locator('.card')
      .filter({ has: frame.getByRole('heading', { name: '독립 프로젝트 검증 아이디어' }) });
    await card.getByRole('button', { name: '좋아요', exact: true }).click();
    await expect(card.locator('.like-count')).toHaveText('1');
    await card.getByRole('button', { name: '아이디어 삭제', exact: true }).click();
    await expect(frame.locator('.card')).toHaveCount(3);
    expect(
      await frame.locator('html').evaluate((element) => element.scrollWidth > innerWidth),
    ).toBe(false);
    await page.screenshot({
      path: resolve(output, `idea-board-${viewport.width}.png`),
      fullPage: true,
    });
    await page.close();
  }
  expect(errors).toEqual([]);
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify({
      ok: true,
      blogCommand: checked,
      ideaBoardOriginalPreserved: true,
      viewports: [1280, 390, 320],
      errors,
    }),
    { mode: 0o600 },
  );
  console.log('Demo project checks passed. Artifacts: ' + output);
} finally {
  await browser.close();
  await runtime.stop();
}
