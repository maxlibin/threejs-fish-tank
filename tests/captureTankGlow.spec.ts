import { test } from '@playwright/test';
import { TANK, type Vec3 } from '../src/tank/dimensions';
import { openApp } from './helpers';

/** Not a check: photographs the tank for tools/blender/build_room.py to use as a light source and TV picture. */
test('capture the tank image that lights the room', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__tank.setPose({ azimuthDegrees: 0, eyeHeight: 1.26, distanceToGlass: 1.9, pivotX: 0 }));
  await page.waitForTimeout(3000);
  const corners: readonly Vec3[] = [
    [-TANK.width / 2, TANK.standTopY + TANK.height, TANK.frontPaneZ],
    [TANK.width / 2, TANK.standTopY, TANK.frontPaneZ],
  ];
  const [[left, top], [right, bottom]] = await page.evaluate((points) => points.map((point) => window.__tank.projectToScreen(point)), corners as Vec3[]) as [[number, number], [number, number]];
  await page.screenshot({ path: 'public/assets/room/tank_glow.png', clip: { x: left, y: top, width: right - left, height: bottom - top } });
});
