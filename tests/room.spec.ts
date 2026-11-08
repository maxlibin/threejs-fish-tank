import { expect, test } from '@playwright/test';
import type { OrbitPose } from '../src/camera/cameraRig';
import { collectConsoleErrors, openApp } from './helpers';
import { decodePng, shareOfBlack } from './pixels';

const FULL_FRAME = { x: 0, y: 0, width: 3440, height: 1440 };
const EXTREMES: readonly OrbitPose[] = [
  { azimuthDegrees: -75, eyeHeight: 2.15, distanceToGlass: 3, pivotX: -1.25 },
  { azimuthDegrees: 75, eyeHeight: 2.15, distanceToGlass: 3, pivotX: 1.25 },
  { azimuthDegrees: -75, eyeHeight: 0.9, distanceToGlass: 1.2, pivotX: 1.25 },
  { azimuthDegrees: 75, eyeHeight: 0.9, distanceToGlass: 1.2, pivotX: -1.25 },
  { azimuthDegrees: 0, eyeHeight: 2.15, distanceToGlass: 3, pivotX: 0 },
];

test('the camera sees no unbuilt room at any limit', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openApp(page);
  for (const pose of EXTREMES) {
    await page.evaluate((nextPose) => window.__tank.setPose(nextPose), pose);
    await page.waitForTimeout(1000);
    const shot = decodePng(await page.screenshot());
    // Unbuilt space renders as pure black.
    expect(shareOfBlack(shot, FULL_FRAME)).toBeLessThan(0.02);
  }
  expect(consoleErrors).toEqual([]);
});
