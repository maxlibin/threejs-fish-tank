import { expect, test } from '@playwright/test';
import { apparentPosition } from '../src/tank/refraction';
import { TANK, type Plane3, type Vec3 } from '../src/tank/dimensions';
import { collectConsoleErrors, openBareTank } from './helpers';
import { decodePng, meanColor, meanPixelDifference, type Region } from './pixels';

const FRONT: Plane3 = { normal: [0, 0, 1], constant: -(TANK.frontPaneZ - TANK.glassThickness) };
const NEAR: Vec3 = [-0.25, 1.0, 0.29];
const FAR: Vec3 = [0.25, 1.0, -0.29];
const SAND: Vec3 = [0, 0.7, 0.15];

const squareAround = ([x, y]: readonly [number, number], half: number): Region => ({ x: x - half, y: y - half, width: half * 2, height: half * 2 });

test('caustics move on the sand, and distant objects lose red', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openBareTank(page);
  await page.evaluate(async ([near, far]) => {
    const fixture = await import('./tests/fixtures/waterLightFixture.ts' as string);
    window.__tank.addToContents(fixture.createWaterLightScene(near, far));
  }, [NEAR, FAR] as const);
  await page.evaluate(() => window.__tank.setPose({ azimuthDegrees: 0, eyeHeight: 1.05, distanceToGlass: 1.3, pivotX: 0 }));
  await page.waitForTimeout(3000);

  const eye = await page.evaluate(() => window.__tank.eye());
  const screen = async (point: Vec3): Promise<readonly [number, number]> =>
    page.evaluate((world) => window.__tank.projectToScreen(world), apparentPosition(eye, point, FRONT, TANK.iorWater));
  const sandRegion = squareAround(await screen(SAND), 120);

  const frameA = decodePng(await page.screenshot());
  await page.waitForTimeout(800);
  const frameB = decodePng(await page.screenshot());
  expect(meanPixelDifference(frameA, frameB, sandRegion)).toBeGreaterThan(1);

  const [nearRed, , nearBlue] = meanColor(frameB, squareAround(await screen(NEAR), 12));
  const [farRed, , farBlue] = meanColor(frameB, squareAround(await screen(FAR), 12));
  expect(farRed / farBlue).toBeLessThan((nearRed / nearBlue) * 0.97);
  expect(consoleErrors).toEqual([]);
});
