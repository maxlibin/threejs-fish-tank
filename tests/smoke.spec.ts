import { expect, test } from '@playwright/test';
import { collectConsoleErrors, openApp } from './helpers';

test('renders with WebGPU and no console errors', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openApp(page);
  const stats = await page.evaluate(() => window.__tank.frameStats());
  expect(consoleErrors).toEqual([]);
  expect(stats.backend).toBe('webgpu');
  await expect(page.getByTestId('app-canvas')).toBeVisible();
});

test('shows a clear error without WebGPU', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
  });
  await page.goto('/');
  await expect(page.getByTestId('fatal-error')).toContainText('WebGPU');
});
