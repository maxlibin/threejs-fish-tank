import { expect, test } from '@playwright/test';
import { collectConsoleErrors, openApp } from './helpers';

test('48 hours in, shader time values stay small enough for smooth motion', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__tank.jumpTimeTo(172_800));
  await page.waitForTimeout(2000);
  // 32-bit floats lose sub-millisecond precision past about 4096.
  expect(await page.evaluate(() => window.__tank.largestTimeUniform())).toBeLessThan(4096);
  expect((await page.evaluate(() => window.__tank.frameStats())).frameCount).toBeGreaterThan(10);
  expect(consoleErrors).toEqual([]);
});
