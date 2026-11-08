import { expect, test, type Page } from '@playwright/test';
import { apparentPosition } from '../src/tank/refraction';
import { TANK, type Plane3, type Vec3 } from '../src/tank/dimensions';
import { collectConsoleErrors, openBareTank } from './helpers';
import { decodePng, edgeSharpness, redBoundingBox } from './pixels';

// Clear of the fish, whose own edges would skew the sharpness reading.
const MARKER: Vec3 = [-0.3, 1.0, 0.15];
const FAR_MARKER: Vec3 = [0.2, 1.0, -0.04];
const FRONT: Plane3 = { normal: [0, 0, 1], constant: -(TANK.frontPaneZ - TANK.glassThickness) };
const POSE = { azimuthDegrees: 0, eyeHeight: 1.05, distanceToGlass: 0.5, pivotX: 0 };

const addMarkers = async (page: Page, positions: readonly Vec3[]): Promise<void> => {
  await page.evaluate(async (centers) => {
    const fixture = await import('/tests/fixtures/opticsFixture.ts' as string);
    for (const center of centers) window.__tank.addToContents(fixture.createOpticsMarker(center, 0.012));
  }, positions as Vec3[]);
};

/** A square around where refraction shows a marker, excluding its mirror images in the panes. */
const regionAround = async (page: Page, point: Vec3, half: number) => {
  const eye = await page.evaluate(() => window.__tank.eye());
  const [x, y] = await page.evaluate((world) => window.__tank.projectToScreen(world), apparentPosition(eye, point, FRONT, TANK.iorWater));
  return { x: x - half, y: y - half, width: half * 2, height: half * 2 };
};

const screenshotAt = async (page: Page, width: number, height: number) => {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(1500);
  return { shot: decodePng(await page.screenshot()), width, height };
};

test('resizing keeps a correct, sharp image', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openBareTank(page);
  await addMarkers(page, [MARKER]);
  await page.evaluate((pose) => window.__tank.setPose(pose), POSE);
  await page.evaluate(() => window.__tank.setFocusDistance(window.__tank.eye()[2] - 0.05));

  const baseline = await screenshotAt(page, 3440, 1440);
  const baselineSharpness = edgeSharpness(baseline.shot, await regionAround(page, MARKER, 110));

  for (const [width, height] of [[1280, 720], [1920, 1080], [3440, 1440]] as const) {
    const { shot } = await screenshotAt(page, width, height);
    const canvasWidth = await page.getByTestId('app-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width);
    expect(canvasWidth).toBe(width);
    const region = await regionAround(page, MARKER, (110 * width) / 3440 + 20);
    const box = redBoundingBox(shot, region);
    expect(box).not.toBeNull();
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(1, 0);
    expect(edgeSharpness(shot, region)).toBeGreaterThan(baselineSharpness * 0.8);
  }
  expect(consoleErrors).toEqual([]);
});

test('depth of field follows the focus distance', async ({ page }) => {
  await openBareTank(page);
  await addMarkers(page, [FAR_MARKER]);
  await page.evaluate((pose) => window.__tank.setPose(pose), POSE);
  const sharpnessFocusedAt = async (metres: number): Promise<number> => {
    await page.evaluate((focus) => window.__tank.setFocusDistance(focus), metres);
    await page.waitForTimeout(1500);
    return edgeSharpness(decodePng(await page.screenshot()), await regionAround(page, FAR_MARKER, 110));
  };
  // With no depth of field, these two would measure the same.
  const focusedOnMarker = await sharpnessFocusedAt(0.86);
  const focusedOnGlass = await sharpnessFocusedAt(0.3);
  expect(focusedOnGlass).toBeLessThan(focusedOnMarker * 0.8);
});
