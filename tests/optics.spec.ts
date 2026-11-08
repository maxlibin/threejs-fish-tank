import { expect, test, type Page } from '@playwright/test';
import { apparentPosition } from '../src/tank/refraction';
import { TANK, type Plane3, type Vec3 } from '../src/tank/dimensions';
import type { OrbitPose } from '../src/camera/cameraRig';
import { collectConsoleErrors, openBareTank } from './helpers';
import { decodePng, redCentroidInRegion } from './pixels';

const MARKER: Vec3 = [0.1, 1.0, -0.05];
// Near the right-hand pane, which can only be seen from the end of the room.
const SIDE_MARKER: Vec3 = [1.25, 1.0, 0.05];
const FRONT: Plane3 = { normal: [0, 0, 1], constant: -(TANK.frontPaneZ - TANK.glassThickness) };
const RIGHT: Plane3 = { normal: [1, 0, 0], constant: -(TANK.width / 2 - TANK.glassThickness) };
const SEARCH_RADIUS_PIXELS = 90;

const expectMarkerWhereRefractionPredicts = async (page: Page, marker: Vec3, pose: OrbitPose, pane: Plane3): Promise<void> => {
  await page.evaluate((nextPose) => window.__tank.setPose(nextPose), pose);
  await page.waitForTimeout(500);
  const eye = await page.evaluate(() => window.__tank.eye());
  const expected = await page.evaluate(
    (world) => window.__tank.projectToScreen(world),
    apparentPosition(eye, marker, pane, TANK.iorWater),
  );
  const shot = decodePng(await page.screenshot());
  const centroid = redCentroidInRegion(shot, {
    x: expected[0] - SEARCH_RADIUS_PIXELS,
    y: expected[1] - SEARCH_RADIUS_PIXELS,
    width: SEARCH_RADIUS_PIXELS * 2,
    height: SEARCH_RADIUS_PIXELS * 2,
  });
  expect(centroid).not.toBeNull();
  expect(Math.hypot((centroid?.x ?? 0) - expected[0], (centroid?.y ?? 0) - expected[1])).toBeLessThan(4);
};

test('submerged marker appears where refraction predicts', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openBareTank(page);
  await page.evaluate(async (center) => {
    const fixture = await import('/tests/fixtures/opticsFixture.ts' as string);
    for (const position of center) window.__tank.addToContents(fixture.createOpticsMarker(position, 0.012));
  }, [MARKER, SIDE_MARKER]);

  await expectMarkerWhereRefractionPredicts(page, MARKER, { azimuthDegrees: 0, eyeHeight: 1.05, distanceToGlass: 0.9, pivotX: 0 }, FRONT);
  await expectMarkerWhereRefractionPredicts(page, MARKER, { azimuthDegrees: 45, eyeHeight: 1.05, distanceToGlass: 0.5, pivotX: 0 }, FRONT);
  await expectMarkerWhereRefractionPredicts(page, SIDE_MARKER, { azimuthDegrees: 75, eyeHeight: 1.05, distanceToGlass: 0.25, pivotX: 1.25 }, RIGHT);
  expect(consoleErrors).toEqual([]);
});
