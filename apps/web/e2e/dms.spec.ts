/**
 * Stage D4 in real browsers (qa/acceptance_criteria.md J6; DM-01, DM-02, NOTIF-01, SAFE-01,
 * HIST-03): direct messages with receipts, notifications, blocking, and search.
 */
import type { Page } from '@playwright/test';
import pg from 'pg';

import { E2E } from '../playwright.config';

import { expect, test } from './fixtures';
import { createRoom, joinFromExplore, newVerifiedPerson, say, shortId, sidebar } from './helpers';

/** How many notifications of `type` a person has (checked in the database). */
async function notificationCount(nickname: string, type: string): Promise<number> {
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n from notification n join "user" u on u.id = n.user_id
        where u.nickname = $1 and n.type = $2`,
      [nickname, type],
    );
    return result.rows[0]?.n ?? 0;
  } finally {
    await client.end();
  }
}

function memberRow(page: Page, nickname: string) {
  return page
    .getByRole('complementary', { name: 'Members' })
    .getByRole('listitem')
    .filter({ hasText: nickname });
}

function message(page: Page, text: string) {
  return page.locator('li[id^="message-"]').filter({ hasText: text }).first();
}

test('J6: one DM per pair, Sent → Delivered → Seen, notifications, and blocking', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const name = `Lobby ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Public');
  await joinFromExplore(sam.page, name, roomPath);
  await expect(memberRow(ava.page, sam.nickname)).toBeVisible();

  // Starting a DM twice opens the same conversation.
  await memberRow(ava.page, sam.nickname)
    .getByRole('button', { name: `Message ${sam.nickname}` })
    .click();
  await expect(ava.page).toHaveURL(/\/app\/dm\/[0-9a-f-]{36}$/);
  const dmPath = new URL(ava.page.url()).pathname;
  await expect(ava.page.getByRole('heading', { level: 1, name: sam.nickname })).toBeVisible();
  await ava.page.goto(roomPath);
  await memberRow(ava.page, sam.nickname)
    .getByRole('button', { name: `Message ${sam.nickname}` })
    .click();
  await expect(ava.page).toHaveURL(dmPath);

  // Sam's sidebar lists the DM without reloading; Sam stays elsewhere for now.
  await sam.page.goto('/app');
  await expect(sidebar(sam.page).getByRole('link', { name: ava.nickname })).toBeVisible();

  // Sent → Delivered (Sam's device received it) → Seen (Sam opened it).
  const dmComposer = ava.page.getByLabel(`Message @${sam.nickname}`);
  await dmComposer.fill('First DM');
  await dmComposer.press('Enter');
  const first = message(ava.page, 'First DM');
  await expect(first.getByRole('img', { name: 'Delivered' })).toBeVisible({ timeout: 10_000 });
  await expect(
    sidebar(sam.page).getByRole('link', { name: ava.nickname }).getByTestId('unread-badge'),
  ).toHaveText('1, 1 unread');

  // The DM notified Sam: the bell shows it, and the notifications page lists it.
  const bell = sidebar(sam.page).getByRole('link', { name: /^Notifications/ });
  await expect(bell.getByTestId('notifications-badge')).toHaveText('1, 1 unread');
  await bell.click();
  await expect(
    sam.page.getByRole('link', { name: new RegExp(`${ava.nickname} sent you a message`) }),
  ).toBeVisible();
  await expect(bell.getByTestId('notifications-badge')).toHaveCount(0);
  await sam.page
    .getByRole('link', { name: new RegExp(`${ava.nickname} sent you a message`) })
    .click();
  await expect(sam.page).toHaveURL(new RegExp(`${dmPath}\\?m=`));
  await expect(sam.page.getByRole('log').getByText('First DM')).toBeVisible();
  await expect(first.getByRole('img', { name: 'Seen' })).toBeVisible({ timeout: 10_000 });

  // Sam blocks Ava: Ava can no longer write in the DM or start a new one, and Ava's mentions
  // do not notify Sam.
  await sam.page.getByRole('button', { name: `Block ${ava.nickname}` }).click();
  await expect(sam.page.getByRole('button', { name: `Unblock ${ava.nickname}` })).toBeVisible();
  await expect(ava.page.getByText('You cannot send messages in this conversation.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(ava.page.getByLabel(`Message @${sam.nickname}`)).toHaveCount(0);
  await ava.page.goto(roomPath);
  await memberRow(ava.page, sam.nickname)
    .getByRole('button', { name: `Message ${sam.nickname}` })
    .click();
  await expect(
    ava.page.getByRole('alert').filter({ hasText: 'You cannot message this person.' }),
  ).toBeVisible();
  const mentionsBefore = await notificationCount(sam.nickname, 'mention');
  await say(ava.page, name, `Hey @${sam.nickname}, are you there?`);
  await expect(ava.page.getByRole('log').getByText('are you there?')).toBeVisible();
  await expect(ava.page.getByRole('log').getByText('Sending…')).toHaveCount(0);
  expect(await notificationCount(sam.nickname, 'mention')).toBe(mentionsBefore);
  // In the room, Sam sees Ava's message folded away.
  await sam.page.goto(roomPath);
  await expect(message(sam.page, 'Message from someone you blocked.')).toBeVisible();

  await ava.context.close();
  await sam.context.close();
});

test('HIST-03: search finds words only where you belong, and jumps to the message', async ({
  browser,
}) => {
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const word = `quokka${shortId()}`;
  const open = `Open ${shortId()}`;
  const secret = `Secret ${shortId()}`;
  const openPath = await createRoom(ava.page, open, 'Public');
  await say(ava.page, open, `Spotted a ${word} today`);
  await createRoom(ava.page, secret, 'Private');
  await say(ava.page, secret, `The ${word} plan stays here`);
  await expect(ava.page.getByRole('log').getByText('plan stays here')).toBeVisible();

  // Ava finds both; Sam, outside both rooms, finds nothing.
  await ava.page.goto(`/app/search?q=${word}`);
  const results = ava.page.getByRole('list', { name: 'Search results' }).getByRole('listitem');
  await expect(results).toHaveCount(2);
  await expect(results.first().locator('mark')).toHaveText(word);
  await sam.page.goto(`/app/search?q=${word}`);
  await expect(sam.page.getByText(`No messages found for “${word}”.`)).toBeVisible();

  // After joining the public room, Sam finds that message only, and the result opens it.
  await joinFromExplore(sam.page, open, openPath);
  await sam.page.goto('/app/search');
  await sam.page.getByLabel('Search messages').fill(word.toUpperCase());
  await sam.page.getByLabel('Search messages').press('Enter');
  const samResults = sam.page.getByRole('list', { name: 'Search results' }).getByRole('listitem');
  await expect(samResults).toHaveCount(1);
  await samResults.getByRole('link').click();
  await expect(sam.page).toHaveURL(new RegExp(`${openPath}\\?m=`));
  await expect(sam.page.locator('li[id^="message-"]:focus')).toContainText(`Spotted a ${word}`);

  await ava.context.close();
  await sam.context.close();
});
