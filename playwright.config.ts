import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  outputDir: './.playwright-output',
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173/living-room-fish-tank/',
    channel: 'chrome',
    headless: false,
    viewport: { width: 3440, height: 1440 },
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    },
  },
  webServer: {
    command: 'npx vite',
    url: 'http://localhost:5173/living-room-fish-tank/',
    reuseExistingServer: true,
  },
});
