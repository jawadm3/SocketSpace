/**
 * Rooms end to end in real browsers (qa/acceptance_criteria.md):
 * J2 (two people chat in a public room, live: typing, unread badges across tabs, presence and
 * invisible mode) and J5 (private rooms, a one-use invite, a mute and a ban reaching the person
 * at once).
 */
import { expect, test } from './fixtures';

import { createRoom, newVerifiedPerson, say, shortId, sidebar } from './helpers';

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
  // ...and online at once, and Sam sees Ava online too (RT-03).
  const memberRow = (page: typeof ava.page, nickname: string) =>
    page
      .getByRole('complementary', { name: 'Members' })
      .getByRole('listitem')
      .filter({ hasText: nickname });
  await expect(
    memberRow(ava.page, sam.nickname).getByRole('img', { name: 'online' }),
  ).toBeVisible();
  await expect(
    memberRow(sam.page, ava.nickname).getByRole('img', { name: 'online' }),
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
  // Acknowledged messages carry a tick.
  await expect(log.getByRole('img', { name: 'Sent' })).toHaveCount(1);

  // Typing (RT-04): Sam sees Ava typing; it disappears soon after Ava clears the text.
  await expect(
    ava.page.getByRole('status').filter({ hasText: 'Connected to live chat' }),
  ).toBeVisible({ timeout: 15_000 });
  // The server accepts one typing signal per person every 2 seconds and Ava typed moments ago
  // (before the reload), so leave that window first.
  await ava.page.waitForTimeout(2_500);
  const typingLine = sam.page.getByTestId('typing');
  const avaComposer = ava.page.getByLabel(`Message #${name}`);
  await avaComposer.pressSequentially('Thinking about', { delay: 30 });
  await expect(typingLine).toHaveText(`${ava.nickname} is typing…`, { timeout: 2_000 });
  await avaComposer.fill('');
  await expect(typingLine).toHaveText('', { timeout: 7_000 });

  // Unread (RT-05): with Sam away from the room on two tabs, a new message raises both badges
  // by one; opening the room on one tab clears the badge on both.
  const samTab2 = await sam.context.newPage();
  for (const page of [sam.page, samTab2]) {
    await page.goto('/app');
    await expect(
      page.getByRole('status').filter({ hasText: 'Connected to live chat' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(sidebar(page).getByTestId('unread-badge')).toHaveCount(0);
  }
  await say(ava.page, name, 'Are you there?');
  for (const page of [sam.page, samTab2]) {
    await expect(sidebar(page).getByRole('link', { name }).getByTestId('unread-badge')).toHaveText(
      '1, 1 unread',
    );
  }
  await sam.page.bringToFront();
  await sidebar(sam.page).getByRole('link', { name }).click();
  await expect(sam.page.getByRole('log').getByText('Are you there?')).toBeVisible();
  await expect(sidebar(sam.page).getByTestId('unread-badge')).toHaveCount(0);
  await expect(sidebar(samTab2).getByTestId('unread-badge')).toHaveCount(0);

  // Presence (RT-03, PROF-02): Ava sees Sam online; invisible mode shows Sam offline at once.
  const samForAva = memberRow(ava.page, sam.nickname);
  await expect(samForAva.getByRole('img', { name: 'online' })).toBeVisible();
  await samTab2.goto('/app/settings/profile');
  const visibleSwitch = samTab2.getByRole('switch', { name: "Show when I'm online" });
  await visibleSwitch.uncheck();
  await expect(samTab2.getByText('You now appear offline.')).toBeVisible();
  await expect(samForAva.getByRole('img', { name: /^offline/ })).toBeVisible();
  await visibleSwitch.check();
  await expect(samTab2.getByText('People can see when you are online.')).toBeVisible();
  await expect(samForAva.getByRole('img', { name: 'online' })).toBeVisible();

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
