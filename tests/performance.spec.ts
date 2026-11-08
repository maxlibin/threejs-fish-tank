import { expect, test } from '@playwright/test';
import type { ReviewView } from '../src/camera/cameraRig';
import { openApp } from './helpers';

const VIEWS: readonly ReviewView[] = ['wide-room', 'front-tank', 'side-glancing', 'underside-surface', 'angelfish-closeup'];
const SAMPLE_MILLISECONDS = 10_000;

test('holds the frame-rate target at every review view', async ({ page }) => {
  await openApp(page);
  const results: { view: ReviewView; average: number; onePercentLow: number }[] = [];
  for (const view of VIEWS) {
    await page.evaluate((name) => window.__tank.setView(name), view);
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__tank.resetFrameStats());
    await page.waitForTimeout(SAMPLE_MILLISECONDS);
    const stats = await page.evaluate(() => window.__tank.frameStats());
    console.log(`${view}: average ${stats.averageFps.toFixed(1)} fps, slowest 1% ${stats.onePercentLowFps.toFixed(1)} fps, minimum ${stats.minimumFps.toFixed(1)} fps`);
    results.push({ view, average: stats.averageFps, onePercentLow: stats.onePercentLowFps });
  }
  for (const { average, onePercentLow } of results) {
    expect(average).toBeGreaterThanOrEqual(60);
    expect(onePercentLow).toBeGreaterThan(40);
  }
});
