import { mkdir } from 'node:fs/promises';
import { test } from '@playwright/test';
import type { ReviewView } from '../src/camera/cameraRig';
import { openApp } from './helpers';

const VIEWS: readonly ReviewView[] = ['wide-room', 'front-tank', 'side-glancing', 'underside-surface', 'angelfish-closeup'];
const CAPTURE_TIME_SECONDS = 30;
const SETTLE_MILLISECONDS = 2000;

test('capture review views', async ({ page }) => {
  const milestone = process.env['MILESTONE'];
  if (milestone === undefined) throw new Error('Set MILESTONE to name the reviews/ folder, for example MILESTONE=m1.');
  const folder = `reviews/${milestone}`;
  await mkdir(folder, { recursive: true });
  await openApp(page);
  await page.evaluate((seconds) => window.__tank.freezeAt(seconds), CAPTURE_TIME_SECONDS);
  for (const view of VIEWS) {
    await page.evaluate((name) => window.__tank.setView(name), view);
    await page.waitForTimeout(SETTLE_MILLISECONDS);
    await page.screenshot({ path: `${folder}/${view}.png` });
  }
});
