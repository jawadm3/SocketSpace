/**
 * Journey J11, names and pictures (PROF-01, PROF-04, PROF-06, PROF-07): a real name appears only
 * where its owner allows it; a built avatar looks the same on someone else's device and loads
 * nothing from third parties; a new nickname reaches other people without a reload.
 */
import type { Page } from '@playwright/test';

import { E2E } from '../playwright.config';

import { expect, test } from './fixtures';
import { newVerifiedPerson } from './helpers';

function members(page: Page) {
  return page.getByRole('complementary', { name: 'Members' });
}

async function saveProfile(page: Page) {
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

test('J11: real names only where allowed, same avatar everywhere, live nickname changes', async ({
  browser,
}) => {
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const room = `Names ${String(Date.now()).slice(-6)}`;

  await ava.page.goto('/app/rooms/new');
  await ava.page.getByLabel('Name').fill(room);
  await ava.page.getByRole('button', { name: 'Create room' }).click();
  await expect(ava.page.getByRole('heading', { level: 1, name: room })).toBeVisible();
  const roomPath = new URL(ava.page.url()).pathname;
  await sam.page.goto(`/app/explore?q=${encodeURIComponent(room)}`);
  await sam.page.getByRole('button', { name: `Join ${room}` }).click();
  await expect(sam.page).toHaveURL(roomPath);

  // Ava shows her real name to everyone, next to her nickname.
  await ava.page.goto('/app/settings/profile');
  await ava.page.getByLabel('Real name (optional)').fill('Ava Example');
  await ava.page.getByRole('radio', { name: /^Everyone/ }).check();
  await ava.page.getByRole('radio', { name: /^Both/ }).check();
  // ...and builds her own picture.
  await ava.page.getByRole('tab', { name: 'Make your own' }).click();
  await ava.page.getByRole('button', { name: 'Portrait', exact: true }).click();
  await ava.page.getByRole('combobox', { name: /^Glasses/ }).selectOption({ label: 'Style 2' });
  await ava.page.getByRole('button', { name: 'Background 1 of 8' }).click();
  const preview = await ava.page.getByAltText('Preview of your picture').getAttribute('src');
  await saveProfile(ava.page);

  // Sam sees "nickname · real name", and exactly the same picture, with no third-party request.
  const origins = new Set<string>();
  sam.page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('data:')) origins.add(new URL(url).origin);
  });
  await sam.page.reload();
  const avaRow = members(sam.page).getByRole('listitem').filter({ hasText: ava.nickname });
  await expect(avaRow).toContainText(`${ava.nickname} · Ava Example`);
  await expect(avaRow.locator('img')).toHaveAttribute('src', preview ?? 'missing');
  const ours = [new URL(E2E.baseURL).origin, new URL(E2E.realtimeURL).origin];
  expect(origins).toContain(ours[0]);
  for (const origin of origins) expect(ours).toContain(origin);

  // Ava makes her real name private again: Sam no longer receives it.
  await ava.page.getByRole('radio', { name: /^Nobody/ }).check();
  await saveProfile(ava.page);
  await sam.page.reload();
  await expect(members(sam.page).getByText(ava.nickname)).toBeVisible();
  await expect(sam.page.getByText('Ava Example')).toHaveCount(0);

  // A new nickname reaches Sam's open page without a reload.
  const renamed = `${ava.nickname.slice(0, 16)}new`;
  await ava.page.getByLabel('Nickname', { exact: true }).fill(renamed);
  await saveProfile(ava.page);
  await expect(members(sam.page).getByText(renamed)).toBeVisible();

  await ava.context.close();
  await sam.context.close();
});
