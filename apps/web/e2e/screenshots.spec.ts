/**
 * Screenshots of key pages for a visual check (not a regression test; Stage F adds those).
 * Runs only when E2E_SHOTS=1. Images go to test-results/shots (git-ignored).
 */
import { expect, test } from './fixtures';

import { completeOnboarding, newEmail, newVerifiedPerson, signUp } from './helpers';

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

test('room screens at desktop and mobile width', async ({ browser }) => {
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const name = `Design talk ${String(Date.now()).slice(-4)}`;
  await ava.page.goto('/app/rooms/new');
  await ava.page.getByLabel('Name').fill(name);
  await ava.page.getByLabel('Topic (optional)').fill('Pixels, palettes and type');
  await ava.page.screenshot({ path: 'test-results/shots/desktop-room-new.png', fullPage: true });
  await ava.page.getByRole('button', { name: 'Create room' }).click();
  await expect(ava.page.getByRole('heading', { level: 1, name })).toBeVisible();
  const roomPath = new URL(ava.page.url()).pathname;

  await sam.page.goto(`/app/explore?q=${encodeURIComponent(name)}`);
  await sam.page.screenshot({ path: 'test-results/shots/desktop-explore.png', fullPage: true });
  await sam.page.getByRole('button', { name: `Join ${name}` }).click();
  await expect(sam.page).toHaveURL(roomPath);

  const lines: [typeof ava, string][] = [
    [ava, 'Morning! Has anyone tried the new type scale?'],
    [ava, 'I think the headings feel a bit heavy.'],
    [sam, 'Yes, I tried it yesterday.\nThe body text reads well at 16 px.'],
    [ava, 'Great, let us keep it then.'],
  ];
  for (const [person, text] of lines) {
    const composer = person.page.getByLabel(`Message #${name}`);
    await composer.fill(text);
    await composer.press('Enter');
    await expect(person.page.getByRole('log').getByText(text.split('\n')[0] ?? text)).toBeVisible();
  }
  await expect(ava.page.getByRole('log').getByText('The body text reads well')).toBeVisible();

  // Formatting, a reply with a mention, a reaction, someone typing, and the action bar.
  const great = sam.page.locator('li[id^="message-"]').filter({ hasText: 'Great, let us' });
  await great.hover();
  await great.getByRole('button', { name: 'Reply' }).click();
  await sam.page
    .getByLabel(`Message #${name}`)
    .fill(`**Agreed**, @${ava.nickname}. The scale lives in \`tokens.css\`.`);
  await sam.page.getByLabel(`Message #${name}`).press('Enter');
  const reply = ava.page.locator('li[id^="message-"]').filter({ hasText: 'The scale lives' });
  await expect(reply).toBeVisible();
  await reply.hover();
  await reply.getByRole('button', { name: 'Add reaction' }).click();
  await ava.page.screenshot({ path: 'test-results/shots/desktop-room-react.png' });
  await ava.page.getByRole('button', { name: 'React with 🎉' }).click();
  await sam.page.getByLabel(`Message #${name}`).pressSequentially('One more', { delay: 30 });
  await expect(ava.page.getByTestId('typing')).not.toHaveText('');
  await reply.hover();
  await ava.page.screenshot({ path: 'test-results/shots/desktop-room.png' });

  // Offline: the banner, and a message waiting in the outbox.
  await ava.context.setOffline(true);
  await ava.page.getByLabel(`Message #${name}`).fill('Sent when the network returns');
  await ava.page.getByLabel(`Message #${name}`).press('Enter');
  await expect(ava.page.getByTestId('connection-banner')).toBeVisible();
  await ava.page.screenshot({ path: 'test-results/shots/desktop-room-offline.png' });
  await ava.context.setOffline(false);
  await expect(ava.page.getByTestId('connection-banner')).toHaveCount(0, { timeout: 10_000 });
  await expect(ava.page.getByRole('log').getByText('Sending…')).toHaveCount(0);

  await ava.page.setViewportSize({ width: 375, height: 812 });
  await ava.page.screenshot({ path: 'test-results/shots/mobile-room.png' });
  await ava.page.setViewportSize({ width: 1280, height: 860 });

  await ava.page.getByRole('link', { name: 'Room settings' }).click();
  await ava.page.getByRole('button', { name: 'Create invite link' }).click();
  const inviteUrl = await ava.page.getByLabel('Invite link (shown once)').inputValue();
  await ava.page.getByText(`Manage ${sam.nickname}`).click();
  await ava.page.screenshot({
    path: 'test-results/shots/desktop-room-settings.png',
    fullPage: true,
  });

  const outsider = await browser.newContext();
  const outsiderPage = await outsider.newPage();
  await outsiderPage.goto(inviteUrl);
  await outsiderPage.screenshot({ path: 'test-results/shots/desktop-invite.png', fullPage: true });

  await ava.page.goto('/app/settings/profile');
  await ava.page.getByRole('tab', { name: 'Make your own' }).click();
  await ava.page.getByRole('button', { name: 'Portrait', exact: true }).click();
  await ava.page.getByRole('combobox', { name: /^Glasses/ }).selectOption({ label: 'Style 2' });
  await ava.page.getByRole('button', { name: 'Background 3 of 8' }).click();
  await ava.page.screenshot({
    path: 'test-results/shots/desktop-profile-builder.png',
    fullPage: true,
  });

  await sam.page.goto('/app');
  await sam.page.screenshot({ path: 'test-results/shots/desktop-app-home.png', fullPage: true });

  for (const context of [ava.context, sam.context, outsider]) await context.close();
});
