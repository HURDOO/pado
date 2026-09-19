import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const origin = 'http://127.0.0.1:16473';
export default defineConfig({
  testDir: './tests/public-browser',
  workers: 1,
  timeout: 45_000,
  outputDir: 'test-results/public-browser',
  use: { baseURL: origin, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 950 } },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: origin + '/api/health',
    reuseExistingServer: false,
    env: {
      PADO_BIND_HOST: '127.0.0.1',
      PADO_PORT: '16473',
      PADO_ORIGIN: origin,
      PADO_PUBLIC_MODE: '1',
      PADO_PARTICIPANT_TUI: '1',
      PADO_RUNNER: 'antigravity',
      PADO_AGENT_IMAGE: 'pado-agent:public-candidate',
      PADO_ADMIN_PASSWORD: 'pado-public-test-password',
      PADO_DATA_DIR: resolve('.pado', 'public-browser-' + randomUUID()),
    },
  },
});
