import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TANK, type Vec3 } from '../src/tank/dimensions';
import { collectConsoleErrors, openApp } from './helpers';
import { averagePixels, decodePng, meanColor, meanPixelDifference, type Image } from './pixels';

// Where the bush on the right and the bubble curtain on the left sit in the front-tank view.
const STEM_REGION = { x: 2100, y: 720, width: 400, height: 220 };
const BUBBLE_REGION = { x: 1200, y: 450, width: 400, height: 350 };
const FRAMES_PER_AVERAGE = 8;

test('plants move with the current, and bubbles rise', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__tank.setView('front-tank'));
  await page.waitForTimeout(2500);
  const frameA = decodePng(await page.screenshot());
  await page.waitForTimeout(800);
  const frameB = decodePng(await page.screenshot());
  expect(meanPixelDifference(frameA, frameB, STEM_REGION)).toBeGreaterThan(0.5);
  expect(meanPixelDifference(frameA, frameB, BUBBLE_REGION)).toBeGreaterThan(0.5);
  // Plants on the right are clearly green, not a bare background.
  const [red, green, blue] = meanColor(frameB, STEM_REGION);
  expect(green).toBeGreaterThan(red);
  expect(green).toBeGreaterThan(blue);
  expect(consoleErrors).toEqual([]);
});

test('leaves shake where a fish pushes through them', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  const leaves = JSON.parse(readFileSync('public/assets/aquascape/plant_points.json', 'utf8')) as readonly Vec3[];
  const leaf = leaves.find(([x, y, z]) => x > 0.6 && x < 1.1 && y > 1.2 && y < 1.4 && z > 0.05);
  if (leaf === undefined) throw new Error('Expected leaves in the right-hand bush. Rebuild tools/blender/build_aquascape.py.');
  await openApp(page);
  await page.evaluate(() => window.__tank.freezeAt(30));
  await page.evaluate(([x, y]) => window.__tank.setPose({ azimuthDegrees: 0, eyeHeight: y, distanceToGlass: 0.7, pivotX: x }), leaf);
  await page.evaluate((metres) => window.__tank.setFocusDistance(metres), 0.7 + TANK.frontPaneZ - leaf[2]);
  const [screenX, screenY] = await page.evaluate((point) => window.__tank.projectToScreen(point), leaf);
  const region = { x: Math.max(0, Math.round(screenX) - 300), y: Math.max(0, Math.round(screenY) - 300), width: 600, height: 600 };
  // Fine leaves flicker from frame to frame under anti-aliasing jitter, so each side is an average of many frames.
  await page.waitForTimeout(3000);
  const averageOfFrames = async (): Promise<Image> => {
    const frames: Image[] = [];
    for (let frame = 0; frame < FRAMES_PER_AVERAGE; frame += 1) {
      await page.waitForTimeout(350);
      frames.push(decodePng(await page.screenshot()));
    }
    return averagePixels(frames);
  };
  const before = await averageOfFrames();
  const stillBefore = await averageOfFrames();
  await page.evaluate((point) => window.__tank.shakeLeavesAt(point), leaf);
  await page.waitForTimeout(600);
  const shaken = await averageOfFrames();
  const noise = meanPixelDifference(before, stillBefore, region);
  const change = meanPixelDifference(stillBefore, shaken, region);
  console.log(`leaf shake: noise ${noise.toFixed(2)}, change ${change.toFixed(2)}`);
  expect(change).toBeGreaterThan(noise * 1.6 + 0.3);
  expect(consoleErrors).toEqual([]);
});
