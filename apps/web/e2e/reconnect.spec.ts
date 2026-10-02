/**
 * Journey J4 in real browsers (qa/acceptance_criteria.md, RECON-01 to RECON-04): messages written
 * offline wait in the outbox and go out once each, in order, when the network returns; the
 * outbox survives a reload. (The server-restart part of J4 is covered by the realtime restart
 * tests, `operations.test.ts`, because the end-to-end servers cannot be restarted mid-test.)
 */
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { createRoom, joinFromExplore, newVerifiedPerson, say, shortId } from './helpers';

function log(page: Page) {
  return page.getByRole('log');
}

test('J4: offline sending, catching up, and an outbox that survives a reload', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const name = `Outage ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Public');
  await joinFromExplore(sam.page, name, roomPath);
  const banner = ava.page.getByTestId('connection-banner');

  // The network goes: a banner, and messages wait as "Sending".
  await ava.context.setOffline(true);
  await expect(banner).toContainText('You are offline');
  await say(ava.page, name, 'Written offline, first');
  await say(ava.page, name, 'Written offline, second');
  await expect(log(ava.page).getByText('Sending…')).toHaveCount(2);

  // Sam writes during the outage.
  await say(sam.page, name, 'Sam during the outage');
  await expect(log(sam.page).getByText('Sam during the outage')).toBeVisible();

  // The network returns: within 10 seconds Ava has Sam's message, and her own two arrive once
  // each, in order, on both screens.
  await ava.context.setOffline(false);
  await expect(log(ava.page).getByText('Sam during the outage')).toBeVisible({ timeout: 10_000 });
  await expect(log(ava.page).getByText('Sending…')).toHaveCount(0, { timeout: 10_000 });
  await expect(banner).toHaveCount(0);
  for (const page of [ava.page, sam.page]) {
    const messages = log(page);
    for (const text of [
      'Sam during the outage',
      'Written offline, first',
      'Written offline, second',
    ]) {
      await expect(messages.getByText(text)).toHaveCount(1);
    }
    const all = await messages.innerText();
    expect(all.indexOf('Sam during the outage')).toBeLessThan(
      all.indexOf('Written offline, first'),
    );
    expect(all.indexOf('Written offline, first')).toBeLessThan(
      all.indexOf('Written offline, second'),
    );
  }

  // A message still unsent when the page reloads is kept and sent afterwards (RECON-04). The
  // realtime token is blocked so the message cannot leave before the reload.
  await ava.page.route('**/api/realtime/token', (route) => route.abort());
  await ava.context.setOffline(true);
  await say(ava.page, name, 'Kept across a reload');
  await expect(log(ava.page).getByText('Sending…')).toHaveCount(1);
  await ava.context.setOffline(false);
  await ava.page.reload();
  await expect(log(ava.page).getByText('Kept across a reload')).toBeVisible();
  await expect(log(ava.page).getByText('Sending…')).toHaveCount(1);
  await ava.page.unroute('**/api/realtime/token');
  await expect(log(sam.page).getByText('Kept across a reload')).toBeVisible({ timeout: 30_000 });
  await expect(log(ava.page).getByText('Sending…')).toHaveCount(0, { timeout: 10_000 });

  // Stored exactly once.
  await ava.page.reload();
  await expect(log(ava.page).getByText('Kept across a reload')).toHaveCount(1);
  await expect(log(sam.page).getByText('Kept across a reload')).toHaveCount(1);

  await ava.context.close();
  await sam.context.close();
});
