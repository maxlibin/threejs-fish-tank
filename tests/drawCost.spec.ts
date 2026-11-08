import { expect, test } from '@playwright/test';
import type { ReviewView } from '../src/camera/cameraRig';
import { openApp } from './helpers';

// A budget that an M4 Max can draw at 60 fps with these materials, and that other programs cannot affect.
const TRIANGLE_BUDGET: Readonly<Record<ReviewView, number>> = {
  'wide-room': 6_000_000,
  'front-tank': 6_000_000,
  'side-glancing': 6_000_000,
  'underside-surface': 6_000_000,
  'angelfish-closeup': 4_000_000,
};

test('each view stays within its triangle budget', async ({ page }) => {
  await openApp(page);
  const measured: { view: ReviewView; triangles: number; drawCalls: number }[] = [];
  for (const view of Object.keys(TRIANGLE_BUDGET) as ReviewView[]) {
    await page.evaluate((name) => window.__tank.setView(name), view);
    await page.waitForTimeout(1200);
    const drawn = await page.evaluate(() => window.__tank.drawnLastFrame());
    console.log(`${view}: ${(drawn.triangles / 1e6).toFixed(2)} M triangles, ${drawn.drawCalls} draw calls`);
    measured.push({ view, ...drawn });
  }
  for (const { view, triangles } of measured) expect(triangles).toBeLessThan(TRIANGLE_BUDGET[view]);
});
