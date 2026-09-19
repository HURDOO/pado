import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const origin = process.env.PADO_E2E_ORIGIN || 'http://127.0.0.1:14735';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  outputDir: 'test-results/browser',
  use: { baseURL: origin, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 950 } },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    env: {
      PADO_BIND_HOST: '127.0.0.1',
      PADO_PORT: new URL(origin).port,
      PADO_ORIGIN: origin,
      PADO_ADMIN_PASSWORD: 'pado-test-only-password',
      PADO_RUNNER: 'rehearsal',
      PADO_DATA_DIR: resolve('.pado', `browser-${randomUUID()}`),
    },
  },
});
