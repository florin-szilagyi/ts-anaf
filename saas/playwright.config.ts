import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { appServerEnv, BASE_URL, E2E_PORT } from './e2e/support/env';

// Prefer the environment's preinstalled Chromium (symlink to the binary) when
// present — avoids downloading a browser build in sandboxes/CI images that
// ship one (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).
const chromiumPath = process.env.E2E_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup',
  workers: 1, // specs share one seeded database
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    ...(existsSync(chromiumPath) ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: {
    command: `pnpm exec next dev -p ${E2E_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: appServerEnv(),
  },
});
