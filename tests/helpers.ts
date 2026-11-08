import type { ConsoleMessage, Page } from '@playwright/test';

/** Collects console errors and uncaught page errors from the moment it is called. */
export const collectConsoleErrors = (page: Page): readonly string[] => {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error: Error) => errors.push(error.message));
  return errors;
};

/** Opens the tank with no aquascape or fish, for tests that need a clear line of sight to their markers. */
export const openBareTank = async (page: Page): Promise<void> => {
  await page.goto('/?bareTank');
  await page.waitForFunction(() => window.__tank !== undefined && window.__tank.frameStats().frameCount > 10);
};

/** Opens the app and waits until it has rendered frames. */
export const openApp = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__tank !== undefined && window.__tank.frameStats().frameCount > 10);
};
