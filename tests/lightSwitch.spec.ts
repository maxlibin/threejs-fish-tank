import { expect, test, type Page } from '@playwright/test';
import { TANK, type Vec3 } from '../src/tank/dimensions';
import { collectConsoleErrors, openApp } from './helpers';
import { averagePixels, decodePng, meanColor, meanPixelDifference, type Image, type Region } from './pixels';

const LIGHT_COLOUR_COUNT = 8;
const FRAMES_PER_AVERAGE = 4;
const SETTLE_MILLISECONDS = 1500;
/** Inside the water, above the plants, and on the floor just in front of the cabinet. */
const WATER_POINT: Vec3 = [0, TANK.standTopY + 1.1, 0];
const FLOOR_POINT: Vec3 = [0, 0, TANK.frontPaneZ + 0.5];

const averageOfFrames = async (page: Page): Promise<Image> => {
  const frames: Image[] = [];
  for (let frame = 0; frame < FRAMES_PER_AVERAGE; frame += 1) {
    await page.waitForTimeout(250);
    frames.push(decodePng(await page.screenshot()));
  }
  return averagePixels(frames);
};

const regionAround = async (page: Page, point: Vec3, halfSize: number): Promise<Region> => {
  const [x, y] = await page.evaluate((world) => window.__tank.projectToScreen(world), point);
  return { x: x - halfSize, y: y - halfSize, width: halfSize * 2, height: halfSize * 2 };
};

const switchOnScreen = async (page: Page): Promise<readonly [number, number]> => {
  const centre = await page.evaluate(() => window.__tank.lightSwitchCentre());
  return page.evaluate((world) => window.__tank.projectToScreen(world), centre);
};

const redOverBlue = (image: Image, region: Region): number => {
  const [red, , blue] = meanColor(image, region);
  return red / blue;
};

test('the wall switch changes the colour of the tank light', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__tank.freezeAt(30));
  await page.evaluate(() => window.__tank.setView('wide-room'));
  await page.waitForTimeout(2500);
  const water = await regionAround(page, WATER_POINT, 120);
  const floor = await regionAround(page, FLOOR_POINT, 60);
  expect(await page.evaluate(() => window.__tank.lightColourIndex())).toBe(0);
  const daylight = await averageOfFrames(page);

  // The second setting is a warm sunrise: the water and the floor it lights both turn warmer.
  const [x, y] = await switchOnScreen(page);
  await page.mouse.click(x, y);
  await page.waitForTimeout(SETTLE_MILLISECONDS);
  expect(await page.evaluate(() => window.__tank.lightColourIndex())).toBe(1);
  const sunrise = await averageOfFrames(page);
  console.log(`red/blue water ${redOverBlue(daylight, water).toFixed(2)} -> ${redOverBlue(sunrise, water).toFixed(2)}, floor ${redOverBlue(daylight, floor).toFixed(2)} -> ${redOverBlue(sunrise, floor).toFixed(2)}`);
  expect(redOverBlue(sunrise, water)).toBeGreaterThan(redOverBlue(daylight, water) * 1.15);
  expect(redOverBlue(sunrise, floor)).toBeGreaterThan(redOverBlue(daylight, floor) * 1.05);

  // Going all the way round comes back to the first light.
  for (let press = 1; press < LIGHT_COLOUR_COUNT; press += 1) await page.mouse.click(x, y);
  await page.waitForTimeout(SETTLE_MILLISECONDS);
  expect(await page.evaluate(() => window.__tank.lightColourIndex())).toBe(0);
  const backToDaylight = await averageOfFrames(page);
  expect(meanPixelDifference(daylight, backToDaylight, water)).toBeLessThan(2);
  expect(consoleErrors).toEqual([]);
});

test('a drag that starts on the switch turns the camera instead', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  // Time keeps running here: the camera only moves toward where a drag points it while the world is not frozen.
  await openApp(page);
  await page.evaluate(() => window.__tank.setView('wide-room'));
  await page.waitForTimeout(1000);
  const [x, y] = await switchOnScreen(page);
  const azimuth = await page.evaluate(() => window.__tank.azimuthDegrees());
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 160, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__tank.lightColourIndex())).toBe(0);
  expect(await page.evaluate(() => window.__tank.azimuthDegrees())).not.toBe(azimuth);
  expect(consoleErrors).toEqual([]);
});
