/**
 * Playwright config for the README screenshots.
 *
 * Run with: pnpm screenshots
 *   pnpm screenshots --grep route-red --project dark   # one shot
 *
 * Needs the demo feed from `pnpm screenshots:feed`.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results',
  // Each shot loads its own feed, so tests do not depend on each other.
  fullyParallel: true,
  // Kept low out of politeness to the OSM tile servers.
  workers: 2,
  timeout: 90_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    deviceScaleFactor: 1,
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    cwd: '../..',
    // Stops Vite opening a browser tab.
    env: { BROWSER: 'none' },
  },
  projects: [
    {
      name: 'light',
      grepInvert: /@mobile|@gif/,
      use: { colorScheme: 'light' },
    },
    {
      name: 'dark',
      grepInvert: /@mobile|@gif/,
      use: { colorScheme: 'dark' },
    },
    {
      name: 'mobile',
      grep: /@mobile/,
      use: {
        colorScheme: 'light',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'gif',
      grep: /@gif/,
      use: {
        colorScheme: 'dark',
        viewport: { width: 1280, height: 800 },
        video: { mode: 'on', size: { width: 1280, height: 800 } },
      },
    },
  ],
});
