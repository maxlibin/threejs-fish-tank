import { expect, test, type Page } from '@playwright/test';
import { ROOM } from '../src/tank/dimensions';
import { openApp } from './helpers';

const VIEWPORT_CENTER = { x: 1720, y: 720 };
// The eye position comes from a numeric solve, so limits hold to within a micrometre.
const SOLVER_TOLERANCE = 1e-6;

const dragHard = async (page: Page, dx: number, dy: number): Promise<void> => {
  await page.mouse.move(VIEWPORT_CENTER.x, VIEWPORT_CENTER.y);
  await page.mouse.down();
  await page.mouse.move(VIEWPORT_CENTER.x + dx, VIEWPORT_CENTER.y + dy);
  await page.mouse.up();
};

const expectInsideLimits = async (page: Page): Promise<void> => {
  const reading = await page.evaluate(() => ({
    distance: window.__tank.distanceToGlass(),
    azimuth: window.__tank.azimuthDegrees(),
    eye: window.__tank.eye(),
  }));
  expect(reading.eye[0]).toBeGreaterThan(ROOM.minX);
  expect(reading.eye[0]).toBeLessThan(ROOM.maxX);
  expect(reading.eye[2]).toBeLessThan(ROOM.maxZ);
  expect(reading.distance).toBeGreaterThanOrEqual(0.25 - SOLVER_TOLERANCE);
  expect(reading.distance).toBeLessThanOrEqual(4.6 + SOLVER_TOLERANCE);
  expect(Math.abs(reading.azimuth)).toBeLessThanOrEqual(75);
};

test('camera stays inside its limits under rapid input', async ({ page }) => {
  await openApp(page);
  await page.mouse.move(VIEWPORT_CENTER.x, VIEWPORT_CENTER.y);

  for (const direction of [-1, 1, -1]) {
    for (let i = 0; i < 200; i += 1) {
      await page.mouse.wheel(0, direction * 400);
      if (i % 20 === 0) await expectInsideLimits(page);
    }
    await page.waitForTimeout(500);
    await expectInsideLimits(page);
  }

  for (const [dx, dy] of [[1500, 600], [-1500, -600], [-1500, 600], [1500, -600]] as const) {
    for (let i = 0; i < 25; i += 1) {
      await dragHard(page, dx, dy);
      if (i % 5 === 0) await expectInsideLimits(page);
    }
    await page.waitForTimeout(500);
    await expectInsideLimits(page);
  }
});
