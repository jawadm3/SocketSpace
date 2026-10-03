/**
 * Journey J3 in real browsers (qa/acceptance_criteria.md): formatting rendered safely, edit,
 * react, reply with a quote that jumps to the original, @mentions with autocomplete (members
 * only), and delete as a tombstone in place (MSG-02 to MSG-07, SEC-06).
 */
import type { Page } from '@playwright/test';
import pg from 'pg';

import { E2E } from '../playwright.config';

import { expect, test } from './fixtures';
import { createRoom, joinFromExplore, newVerifiedPerson, say, shortId } from './helpers';

/** The message (list item) whose text contains `text`; the first one if several do. */
function message(page: Page, text: string) {
  return page.locator('li[id^="message-"]').filter({ hasText: text }).first();
}

/** Nicknames of people with a mention row for the message whose text starts with `prefix`. */
async function mentionedIn(prefix: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ nickname: string }>(
      `select u.nickname from mention m
         join message msg on msg.id = m.message_id
         join "user" u on u.id = m.user_id
        where msg.body like $1
        order by u.nickname`,
      [`${prefix}%`],
    );
    return result.rows.map((r) => r.nickname);
  } finally {
    await client.end();
  }
}

test('J3: format, edit, react, reply, mention and delete', async ({ browser }) => {
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  // Kim has an account but is not in the room: a mention must not reach Kim.
  const kim = await newVerifiedPerson(browser, 'kim');
  const name = `Plans ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Public');
  await joinFromExplore(sam.page, name, roomPath);
  await expect(
    ava.page.getByRole('complementary', { name: 'Members' }).getByText(sam.nickname),
  ).toBeVisible();

  // Nothing a message says may open a dialog (or run anything at all).
  const dialogs: string[] = [];
  for (const page of [ava.page, sam.page]) {
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
  }

  // Formatting renders; HTML stays text (MSG-07, SEC-06).
  await say(
    ava.page,
    name,
    'Plan: **bold** *italic* `code` https://example.test/docs <img src=x onerror=alert(1)>',
  );
  const plan = message(sam.page, 'Plan:');
  await expect(plan.locator('strong')).toHaveText('bold');
  await expect(plan.locator('em')).toHaveText('italic');
  await expect(plan.locator('code')).toHaveText('code');
  const link = plan.getByRole('link', { name: 'https://example.test/docs' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(plan).toContainText('<img src=x onerror=alert(1)>');
  await expect(plan.locator('img[src="x"], img[onerror]')).toHaveCount(0);

  // Edit (MSG-02): Up arrow in an empty composer edits your last message; both see "(edited)".
  await say(ava.page, name, 'Lunch at noon?');
  await expect(message(sam.page, 'Lunch at noon?')).toBeVisible();
  await ava.page.getByLabel(`Message #${name}`).press('ArrowUp');
  const editor = ava.page.getByLabel('Edit message');
  await expect(editor).toHaveValue('Lunch at noon?');
  await editor.fill('Lunch at 1pm?');
  await editor.press('Enter');
  for (const page of [ava.page, sam.page]) {
    const lunch = message(page, 'Lunch at 1pm?');
    await expect(lunch).toContainText('(edited)');
    await expect(page.getByRole('log').getByText('Lunch at noon?')).toHaveCount(0);
  }

  // React (MSG-05): 👍 toggles on and off, for both people.
  const lunchForSam = message(sam.page, 'Lunch at 1pm?');
  await lunchForSam.hover();
  await lunchForSam.getByRole('button', { name: 'Add reaction' }).click();
  await sam.page.getByRole('button', { name: 'React with 👍' }).click();
  for (const page of [ava.page, sam.page]) {
    await expect(
      message(page, 'Lunch at 1pm?').getByRole('button', { name: /^👍 1:/ }),
    ).toBeVisible();
  }
  await lunchForSam.getByRole('button', { name: /^👍 1:/ }).click();
  for (const page of [ava.page, sam.page]) {
    await expect(message(page, 'Lunch at 1pm?').getByRole('button', { name: /^👍/ })).toHaveCount(
      0,
    );
  }

  // Reply (MSG-04): the reply quotes the original, and the quote jumps to it.
  await lunchForSam.hover();
  await lunchForSam.getByRole('button', { name: 'Reply' }).click();
  await expect(sam.page.getByText(`Replying to ${ava.nickname}`)).toBeVisible();
  await say(sam.page, name, 'Works for me');
  const quote = message(ava.page, 'Works for me').getByRole('button', {
    name: new RegExp(`^Replying to ${ava.nickname}: Lunch at 1pm\\?`),
  });
  await expect(quote).toBeVisible();
  await quote.click();
  const original = message(ava.page, 'Lunch at 1pm?');
  await expect(original).toBeFocused();
  await expect(original).toHaveAttribute('data-highlight', 'true');

  // Mentions (MSG-06): autocomplete offers room members only; a mention row exists for the
  // member, none for a non-member with a matching nickname.
  const samComposer = sam.page.getByLabel(`Message #${name}`);
  await samComposer.pressSequentially(`Thanks @${ava.nickname.slice(0, 3)}`);
  const suggestions = sam.page.getByRole('listbox', { name: 'People to mention' });
  await expect(suggestions.getByRole('option', { name: `@${ava.nickname}` })).toBeVisible();
  await samComposer.press('Enter');
  await expect(samComposer).toHaveValue(`Thanks @${ava.nickname} `);
  await samComposer.pressSequentially('see you there');
  await samComposer.press('Enter');
  await expect(
    message(ava.page, 'Thanks').locator('[data-mention="me"]', { hasText: `@${ava.nickname}` }),
  ).toBeVisible();

  await samComposer.pressSequentially(`Also @${kim.nickname.slice(0, 3)}`);
  await expect(suggestions).toHaveCount(0);
  await samComposer.pressSequentially(kim.nickname.slice(3));
  await samComposer.press('Enter');
  await expect(message(ava.page, 'Also @')).toBeVisible();
  expect(await mentionedIn('Thanks @')).toEqual([ava.nickname]);
  // The reply and the mention reached Ava's notification bell (NOTIF-01).
  await expect(
    ava.page
      .getByRole('complementary', { name: 'Rooms and navigation' })
      .getByRole('link', { name: /^Notifications/ })
      .getByTestId('notifications-badge'),
  ).toHaveText('2, 2 unread');
  expect(await mentionedIn('Also @')).toEqual([]);

  // Delete (MSG-03): a tombstone in the same place, for both; the reply's quote says so.
  const lunchForAva = message(ava.page, 'Lunch at 1pm?');
  await lunchForAva.hover();
  await lunchForAva.getByRole('button', { name: 'Delete' }).click();
  await ava.page
    .getByRole('group', { name: 'Confirm deletion' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  for (const page of [ava.page, sam.page]) {
    const log = page.getByRole('log');
    await expect(log.getByText('Message deleted')).toBeVisible();
    await expect(log.getByText('Lunch at 1pm?')).toHaveCount(0);
    await expect(log.getByText('Replying to a deleted message')).toBeVisible();
    const text = await log.innerText();
    expect(text.indexOf('Plan:')).toBeLessThan(text.indexOf('Message deleted'));
    expect(text.indexOf('Message deleted')).toBeLessThan(text.indexOf('Works for me'));
  }
  // The tombstone survives a reload (it is stored, not just shown).
  await sam.page.reload();
  await expect(sam.page.getByRole('log').getByText('Message deleted')).toBeVisible();

  expect(dialogs).toEqual([]);
  await ava.context.close();
  await sam.context.close();
  await kim.context.close();
});
