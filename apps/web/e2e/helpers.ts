import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { E2E } from '../playwright.config';

import { newDevice } from './fixtures';

let counter = 0;

/** A unique, obviously fictional address for each test person. */
export function newEmail(label: string): string {
  counter += 1;
  return `${label}-${String(Date.now())}-${String(counter)}@example.test`;
}

export const PASSWORD = 'correct horse battery staple';

interface SavedMail {
  to: string;
  kind: string;
  text: string;
}

/** Waits for the newest email of `kind` to `to` in the local mail folder and returns its link. */
export async function waitForMailLink(
  to: string,
  kind: 'verify-email' | 'reset-password',
): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        let files: string[];
        try {
          files = (await readdir(E2E.mailDir))
            .filter((f) => f.includes(kind))
            .sort()
            .reverse();
        } catch {
          return undefined;
        }
        for (const file of files) {
          const mail = JSON.parse(await readFile(join(E2E.mailDir, file), 'utf8')) as SavedMail;
          if (mail.to === to.toLowerCase()) {
            link = /https?:\/\/\S+/.exec(mail.text)?.[0];
            return link;
          }
        }
        return undefined;
      },
      { timeout: 10_000, message: `no ${kind} email for ${to}` },
    )
    .toBeTruthy();
  return link ?? '';
}

export async function signUp(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

export async function completeOnboarding(page: Page, nickname: string): Promise<void> {
  await page.getByLabel('Nickname', { exact: true }).fill(nickname);
  await page.getByAltText(/^Picture 1 /).click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

export interface Person {
  context: BrowserContext;
  page: Page;
  email: string;
  nickname: string;
}

/**
 * Someone on their own device who has signed up, finished onboarding, confirmed their email and
 * holds a live connection: ready to chat.
 */
export async function newVerifiedPerson(browser: Browser, label: string): Promise<Person> {
  const context = await newDevice(browser);
  const page = await context.newPage();
  const email = newEmail(label);
  counter += 1;
  const nickname = `${label}${String(Date.now()).slice(-6)}${String(counter)}`;
  await signUp(page, email);
  await completeOnboarding(page, nickname);
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(await waitForMailLink(email, 'verify-email'));
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Please confirm your email address')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Connected to live chat' })).toBeVisible({
    timeout: 15_000,
  });
  return { context, page, email, nickname };
}
