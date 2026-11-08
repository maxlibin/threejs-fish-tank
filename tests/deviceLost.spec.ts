import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('lost GPU device shows a reload message', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__tank.loseDevice());
  await expect(page.getByTestId('fatal-error')).toContainText('reload');
});
