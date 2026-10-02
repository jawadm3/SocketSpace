/**
 * Journey J1 (qa/acceptance_criteria.md): sign up, onboarding gate, read-only until verified,
 * verify by email, sign in again, reset the password. Also J11's "no skipping onboarding" and
 * "taken nickname shows free suggestions".
 */
import { expect, newDevice, test } from './fixtures';

import { PASSWORD, completeOnboarding, newEmail, signUp, waitForMailLink } from './helpers';

test('J1: sign up, onboard, verify, sign out and in, reset the password', async ({ page }) => {
  const email = newEmail('ava');
  const nickname = `ava${String(Date.now()).slice(-6)}`;

  // Sign up lands on onboarding, which explains that the email still needs confirming.
  await signUp(page, email);
  await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();
  await expect(page.getByText('We have also emailed you a link')).toBeVisible();

  // The app cannot be reached before onboarding is finished (no skipping, D-023).
  await page.goto('/app');
  await expect(page).toHaveURL(/\/onboarding$/);

  // A nickname alone is not enough: a profile picture is required.
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose a profile picture to continue')).toBeVisible();

  await completeOnboarding(page, nickname);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: `Hello, ${nickname}` })).toBeVisible();
  // Read-only until the address is confirmed.
  await expect(page.getByText('Please confirm your email address')).toBeVisible();

  // The verification email arrives in the local mail catcher; its link verifies the account.
  const verifyLink = await waitForMailLink(email, 'verify-email');
  await page.goto(verifyLink);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Please confirm your email address')).toHaveCount(0);

  // Opening the same link again does no harm.
  await page.goto(verifyLink);
  await expect(page).toHaveURL(/\/app$/);

  // Sign out, then back in with email and password.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Forgotten password: the same confirmation whatever the address, then a single-use link.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('If an account uses that address')).toBeVisible();
  const resetLink = await waitForMailLink(email, 'reset-password');
  await page.goto(resetLink);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  const newPassword = 'a brand new passphrase here';
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();

  // The old password no longer works; the new one does.
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // (Next.js's own route announcer also has role=alert, so filter by text.)
  await expect(page.getByRole('alert').filter({ hasText: /invalid|incorrect/i })).toBeVisible();
  await page.getByLabel('Password').fill(newPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);

  // The reset link cannot be used twice.
  await page.goto(resetLink);
  await expect(page.getByText('This reset link is invalid or has expired')).toBeVisible();
});

test('J11: a taken nickname (in any letter case) offers free suggestions', async ({ browser }) => {
  const nickname = `Maple${String(Date.now()).slice(-6)}`;

  const first = await (await newDevice(browser)).newPage();
  await signUp(first, newEmail('first'));
  await completeOnboarding(first, nickname);
  await expect(first).toHaveURL(/\/app$/);
  await first.close();

  const page = await (await newDevice(browser)).newPage();
  await signUp(page, newEmail('second'));
  await completeOnboarding(page, nickname.toLowerCase());
  await expect(page.getByText('That nickname is taken')).toBeVisible();
  const suggestion = page
    .getByRole('button', { name: new RegExp(`^${nickname.toLowerCase()}`, 'i') })
    .first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await page.getByAltText(/^Picture 2 /).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test('every page carries the security headers and a per-request CSP nonce (SEC-05)', async ({
  request,
}) => {
  const first = await request.get('/sign-in');
  const second = await request.get('/sign-in');
  const csp = first.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain('unsafe-eval');
  expect(second.headers()['content-security-policy']).not.toBe(csp);

  const headers = first.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toContain('max-age=63072000');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['x-powered-by']).toBeUndefined();
});
