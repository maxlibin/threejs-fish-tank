import { mkdir } from 'node:fs/promises';
import { test } from '@playwright/test';
import type { ReviewView } from '../src/camera/cameraRig';
import { openApp } from './helpers';

const VIEWS: readonly ReviewView[] = ['front-tank', 'side-glancing', 'underside-surface'];

test('capture optics fixture for checking by eye', async ({ page }) => {
  const folder = 'reviews/m1-optics';
  await mkdir(folder, { recursive: true });
  await openApp(page);
  await page.evaluate(async () => {
    const fixture = await import('./tests/fixtures/opticsFixture.ts' as string);
    window.__tank.addToContents(fixture.createOpticsScene());
  });
  for (const view of VIEWS) {
    await page.evaluate((name) => window.__tank.setView(name), view);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${folder}/fixture-${view}.png` });
  }
});
