import { expect, test } from '@playwright/test';
import { collectConsoleErrors, openApp } from './helpers';
import { decodePng, meanPixelDifference } from './pixels';

test('fish loads and animates', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__tank.setView('angelfish-closeup'));
  await page.waitForTimeout(1500);
  const frameA = decodePng(await page.screenshot());
  await page.waitForTimeout(500);
  const frameB = decodePng(await page.screenshot());
  const positions = await page.evaluate(() => window.__tank.fishPositions());
  expect(positions.length).toBeGreaterThan(0);
  const middle = { x: 1000, y: 300, width: 1400, height: 800 };
  expect(meanPixelDifference(frameA, frameB, middle)).toBeGreaterThan(1);
  expect(consoleErrors).toEqual([]);
});

test('a missing fish file names the file', async ({ page }) => {
  await page.route('**/assets/fish/angelfish.glb', (route) => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/');
  await expect(page.getByTestId('fatal-error')).toContainText('angelfish.glb');
});
