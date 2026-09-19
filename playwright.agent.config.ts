import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Explicit opt-in: this suite makes real AI requests using the dedicated login volume.
const dataDir = (process.env.PADO_LIVE_DATA_DIR ??= resolve('.pado/live', randomUUID()));
const port = process.env.PADO_LIVE_PORT || '14736';
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/live',
  testMatch: [
    'tui.spec.ts',
    'preview.spec.ts',
    'tasks.spec.ts',
    'projects.spec.ts',
    'decision-review.spec.ts',
    'secrets.spec.ts',
    'work-context.spec.ts',
    'waiting-terminal.spec.ts',
  ],
  workers: 1,
  retries: 0,
  timeout: 360_000,
  expect: { timeout: 120_000 },
  outputDir: process.env.PADO_LIVE_OUTPUT || 'test-results/live',
  use: { baseURL: origin, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'agent-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 950 } },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    env: {
      PADO_BIND_HOST: '127.0.0.1',
      PADO_PORT: port,
      PADO_ORIGIN: origin,
      PADO_ADMIN_PASSWORD: 'pado-live-test-only-password',
      PADO_RUNNER: 'antigravity',
      PADO_DATA_DIR: dataDir,
    },
  },
});
