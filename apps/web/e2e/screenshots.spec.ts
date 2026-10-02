/**
 * Screenshots of the Stage C pages for a visual check (not a regression test; Stage F adds those).
 * Runs only when E2E_SHOTS=1. Images go to test-results/shots (git-ignored).
 */
import { expect, test } from '@playwright/test';

import { completeOnboarding, newEmail, signUp } from './helpers';

test.skip(!process.env.E2E_SHOTS, 'set E2E_SHOTS=1 to capture screenshots');

const WIDTHS = [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'mobile', width: 375, height: 812 },
];

for (const size of WIDTHS) {
  test(`pages at ${size.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const path of ['/', '/sign-in', '/sign-up', '/forgot-password']) {
      await page.goto(path);
      await page.screenshot({
        path: `test-results/shots/${size.name}${path === '/' ? '-home' : path.replace('/', '-')}.png`,
        fullPage: true,
      });
    }
    await signUp(page, newEmail(`shot-${size.name}`));
    await page.screenshot({
      path: `test-results/shots/${size.name}-onboarding.png`,
      fullPage: true,
    });
    await completeOnboarding(page, `shot${size.name}${String(Date.now()).slice(-5)}`);
    await expect(page).toHaveURL(/\/app$/);
    await page.screenshot({ path: `test-results/shots/${size.name}-app.png`, fullPage: true });
  });
}
