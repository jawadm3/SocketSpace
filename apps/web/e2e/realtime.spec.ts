/**
 * The live connection end to end, in a real browser (RT-01, AUTH-06): the page fetches a token,
 * connects to the realtime server through the origin and token checks, and is disconnected the
 * moment its session is signed out from another device.
 */
import { expect, newDevice, test } from './fixtures';

import { PASSWORD, completeOnboarding, newEmail, signUp } from './helpers';

test('a signed-in page holds an authenticated live connection', async ({ page }) => {
  await signUp(page, newEmail('live'));
  await completeOnboarding(page, `live${String(Date.now()).slice(-6)}`);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('status').filter({ hasText: 'live chat' })).toHaveText(
    'Connected to live chat',
    { timeout: 15_000 },
  );
});

test('signing a device out elsewhere disconnects it immediately (AUTH-06)', async ({ browser }) => {
  const email = newEmail('two-devices');

  // Device 1: sign up and connect.
  const laptop = await newDevice(browser);
  const laptopPage = await laptop.newPage();
  await signUp(laptopPage, email);
  await completeOnboarding(laptopPage, `dev${String(Date.now()).slice(-6)}`);
  await expect(
    laptopPage.getByRole('status').filter({ hasText: 'Connected to live chat' }),
  ).toBeVisible({ timeout: 15_000 });

  // Device 2: sign in with the same account.
  const phone = await newDevice(browser);
  const phonePage = await phone.newPage();
  await phonePage.goto('/sign-in');
  await phonePage.getByLabel('Email').fill(email);
  await phonePage.getByLabel('Password').fill(PASSWORD);
  await phonePage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(phonePage).toHaveURL(/\/app$/);

  // From device 2, sign every other device out.
  await phonePage.goto('/settings/sessions');
  await expect(phonePage.getByRole('listitem')).toHaveCount(2);
  await phonePage.getByRole('button', { name: 'Sign out everywhere else' }).click();
  await expect(phonePage.getByRole('listitem')).toHaveCount(1);

  // Device 1 is told straight away and sent to the sign-in page.
  await expect(laptopPage).toHaveURL(/\/sign-in$/, { timeout: 10_000 });

  await laptop.close();
  await phone.close();
});
