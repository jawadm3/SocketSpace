/**
 * Rooms end to end in real browsers (qa/acceptance_criteria.md):
 * J2 (two people chat in a public room, live) and J5 (private rooms, a one-use invite, a mute
 * and a ban reaching the person at once).
 */
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

import { newVerifiedPerson } from './helpers';

const shortId = () => String(Date.now()).slice(-6);

async function createRoom(page: Page, name: string, visibility: 'Public' | 'Private') {
  await page.goto('/app/rooms/new');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('radio', { name: new RegExp(`^${visibility}`) }).check();
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname;
}

function sidebar(page: Page) {
  return page.getByRole('complementary', { name: 'Rooms and navigation' });
}

async function say(page: Page, room: string, text: string) {
  const composer = page.getByLabel(`Message #${room}`);
  await composer.fill(text);
  await composer.press('Enter');
}

test('J2: two people chat in a public room, live', async ({ browser }) => {
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const name = `Design ${shortId()}`;

  const roomPath = await createRoom(ava.page, name, 'Public');
  expect(roomPath).toMatch(/^\/app\/r\/design-\d+$/);
  await expect(sidebar(ava.page).getByRole('link', { name })).toBeVisible();
  await expect(
    ava.page.getByText(`No messages yet. Be the first to say hello in #${name}.`),
  ).toBeVisible();

  // Sam finds the room in Explore and joins; Ava sees Sam arrive without reloading.
  await sam.page.goto(`/app/explore?q=${encodeURIComponent(name)}`);
  await sam.page.getByRole('button', { name: `Join ${name}` }).click();
  await expect(sam.page).toHaveURL(roomPath);
  await expect(sidebar(sam.page).getByRole('link', { name })).toBeVisible();
  await expect(
    ava.page.getByRole('complementary', { name: 'Members' }).getByText(sam.nickname),
  ).toBeVisible();

  // Messages travel both ways, live, once each.
  await say(sam.page, name, 'Hello Ava!');
  await expect(sam.page.getByRole('log').getByText('Hello Ava!')).toBeVisible();
  await expect(ava.page.getByRole('log').getByText('Hello Ava!')).toBeVisible();
  await say(ava.page, name, 'Welcome, Sam.');
  await expect(sam.page.getByRole('log').getByText('Welcome, Sam.')).toBeVisible();
  await expect(sam.page.getByText('Sending…')).toHaveCount(0);
  await expect(ava.page.getByRole('log').getByText('Hello Ava!')).toHaveCount(1);

  // History survives a reload, in order.
  await ava.page.reload();
  const log = ava.page.getByRole('log');
  await expect(log.getByText('Hello Ava!')).toBeVisible();
  const text = await log.innerText();
  expect(text.indexOf('Hello Ava!')).toBeLessThan(text.indexOf('Welcome, Sam.'));

  await ava.context.close();
  await sam.context.close();
});

test('J5: private room, one-use invite, mute and ban reach the person at once', async ({
  browser,
}) => {
  const ava = await newVerifiedPerson(browser, 'owner');
  const sam = await newVerifiedPerson(browser, 'guest');
  const lee = await newVerifiedPerson(browser, 'other');
  const name = `Secret ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Private');

  // Someone without an invite cannot tell the room exists.
  await lee.page.goto(roomPath);
  await expect(lee.page.getByRole('heading', { name: 'Room not found' })).toBeVisible();

  // Ava creates a link that works once.
  await ava.page.getByRole('link', { name: 'Room settings' }).click();
  await ava.page.getByLabel('Can be used').selectOption('1');
  await ava.page.getByRole('button', { name: 'Create invite link' }).click();
  const inviteUrl = await ava.page.getByLabel('Invite link (shown once)').inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{22}$/);

  // Sam uses it; Lee is too late.
  await sam.page.goto(inviteUrl);
  await sam.page.getByRole('button', { name: `Join #${name}` }).click();
  await expect(sam.page).toHaveURL(roomPath);
  await lee.page.goto(inviteUrl);
  await expect(
    lee.page.getByText('This invite has been used up. Ask for a new one.'),
  ).toBeVisible();

  // Ava mutes Sam for 10 minutes; Sam is told why, and the composer gives way to the reason.
  await ava.page.reload();
  await ava.page.getByText(`Manage ${sam.nickname}`).click();
  const muteForm = ava.page.locator('form', {
    has: ava.page.getByRole('button', { name: `Mute ${sam.nickname}` }),
  });
  await muteForm.getByLabel(`Mute ${sam.nickname} for`).selectOption('10m');
  await muteForm.getByLabel('Reason (shown to them)').fill('Too many messages at once');
  await muteForm.getByRole('button', { name: `Mute ${sam.nickname}` }).click();
  await expect(muteForm.getByText('Muted.')).toBeVisible();
  await expect(sam.page.getByRole('alert').filter({ hasText: 'You were muted' })).toContainText(
    'Too many messages at once',
  );
  await expect(sam.page.getByText('A moderator muted you in this room until')).toBeVisible();
  await expect(sam.page.getByLabel(`Message #${name}`)).toHaveCount(0);

  // Ava bans Sam: Sam is told, the room leaves Sam's sidebar, and the page closes.
  await ava.page.reload();
  await ava.page.getByText(`Manage ${sam.nickname}`).click();
  const banForm = ava.page.locator('form', {
    has: ava.page.getByRole('button', { name: `Ban ${sam.nickname}` }),
  });
  await banForm.getByLabel(`Ban ${sam.nickname} for`).selectOption('1d');
  await banForm.getByLabel('Reason (shown to them)').fill('Ignoring the mute');
  await banForm.getByRole('button', { name: `Ban ${sam.nickname}` }).click();
  await expect(sam.page.getByRole('alert').filter({ hasText: 'You were banned' })).toContainText(
    'Ignoring the mute',
  );
  await expect(sidebar(sam.page).getByRole('link', { name })).toHaveCount(0);
  await expect(sam.page.getByRole('heading', { name: 'Room not found' })).toBeVisible();

  // The ban is listed in settings and recorded with its reason.
  await ava.page.reload();
  await expect(ava.page.getByText('Ignoring the mute')).toBeVisible();

  for (const person of [ava, sam, lee]) await person.context.close();
});
