import { expect, test } from '@playwright/test';
import { apparentPosition } from '../src/tank/refraction';
import { TANK, type Plane3, type Vec3 } from '../src/tank/dimensions';
import { collectConsoleErrors, openBareTank } from './helpers';
import { decodePng, meanPixelDifference, redCentroidInRegion } from './pixels';

const MARKER: Vec3 = [0, TANK.waterSurfaceY - 0.08, -0.05];
const MIRRORED: Vec3 = [MARKER[0], 2 * TANK.waterSurfaceY - MARKER[1], MARKER[2]];
const FRONT: Plane3 = { normal: [0, 0, 1], constant: -(TANK.frontPaneZ - TANK.glassThickness) };

test('surface moves and mirrors the marker from below', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openBareTank(page);
  await page.evaluate(async (center) => {
    const fixture = await import('/tests/fixtures/opticsFixture.ts' as string);
    window.__tank.addToContents(fixture.createOpticsMarker(center, 0.05));
  }, MARKER);
  await page.evaluate(() => window.__tank.setPose({ azimuthDegrees: 0, eyeHeight: 1.2, distanceToGlass: 1.6, pivotX: 0 }));
  await page.waitForTimeout(3000);

  const eye = await page.evaluate(() => window.__tank.eye());
  const expected = await page.evaluate((world) => window.__tank.projectToScreen(world), apparentPosition(eye, MIRRORED, FRONT, TANK.iorWater));
  // The marker looks smaller from across the bigger tank, so measure tightly around its mirror image.
  const region = { x: expected[0] - 75, y: expected[1] - 75, width: 150, height: 150 };

  const frameA = decodePng(await page.screenshot());
  await page.waitForTimeout(700);
  const frameB = decodePng(await page.screenshot());

  expect(redCentroidInRegion(frameB, region)).not.toBeNull();
  // A still surface measures zero here; ripples vary between about 0.25 and 0.6.
  expect(meanPixelDifference(frameA, frameB, region)).toBeGreaterThan(0.15);
  expect(consoleErrors).toEqual([]);
});

test('ripples have the height and steepness of a calm filtered tank', async ({ page }) => {
  await openBareTank(page);
  await page.waitForTimeout(6000);
  const stats = await page.evaluate(() => window.__tank.surfaceStats());
  // Real still-tank ripples are fractions of a millimetre to a few millimetres near the outlet.
  expect(stats.rmsHeight).toBeGreaterThan(0.00003);
  expect(stats.maxHeight).toBeLessThan(0.006);
  // Steep enough to focus light into caustics, far too gentle to break.
  expect(stats.rmsSlope).toBeGreaterThan(0.015);
  expect(stats.rmsSlope).toBeLessThan(0.2);
});
