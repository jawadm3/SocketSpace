/**
 * Stage E1 in real browsers (SAFE-01, SAFE-02, PROF-08, ADMIN-03): the word-list filter, reports
 * with the server's own evidence, and sanctions enforced live.
 *
 * The moderation dashboard comes in Stage E3. Until then this journey plays the moderator the
 * way the dashboard will: it calls the same database functions (`applySanction`, `liftSanction`)
 * and sends the realtime server the same signed internal event.
 */
import type { Page } from '@playwright/test';

import { applySanction, createPgDatabase, eq, liftSanction, newId, schema } from '@socketspace/db';
import {
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
} from '@socketspace/shared/internal-events';

import { E2E } from '../playwright.config';

import { expect, test } from './fixtures';
import {
  createRoom,
  joinFromExplore,
  newVerifiedPerson,
  PASSWORD,
  say,
  shortId,
  sidebar,
} from './helpers';

const MASK = String.fromCodePoint(0x2022);
const handle = createPgDatabase({ connectionString: E2E.databaseUrl, max: 2 });
const db = handle.db;

test.afterAll(async () => {
  await handle.close();
});

async function userId(nickname: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.nickname, nickname));
  if (!row) throw new Error(`no user ${nickname}`);
  return row.id;
}

/** A site administrator who exists only in the database (the dashboard is Stage E3). */
async function newAdmin(): Promise<string> {
  const id = newId();
  await db.insert(schema.user).values({
    id,
    email: `admin-${id}@example.test`,
    name: '',
    emailVerified: true,
    role: 'admin',
  });
  return id;
}

/** Sends the realtime server an internal event, signed like the web app's. */
async function tellRealtime(event: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ id: newId(), at: new Date().toISOString(), ...event });
  const timestamp = String(Date.now());
  const response = await fetch(`${E2E.realtimeURL}/internal/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [INTERNAL_TIMESTAMP_HEADER]: timestamp,
      [INTERNAL_SIGNATURE_HEADER]: await signInternalRequest(E2E.internalSecret, timestamp, body),
    },
    body,
  });
  expect(response.status).toBe(204);
}

async function sanction(
  adminId: string,
  targetUserId: string,
  kind: 'mute' | 'suspend',
  reason: string,
): Promise<void> {
  const result = await applySanction(db, {
    actor: { type: 'admin', id: adminId },
    targetUserId,
    kind,
    reason,
    durationSeconds: 3600,
  });
  if (!result.ok) throw new Error(result.reason);
  await tellRealtime({
    type: 'user.sanctioned',
    userId: targetUserId,
    kind,
    reason,
    until: result.sanction.expiresAt?.toISOString() ?? null,
  });
}

/** With E2E_SHOTS=1: a screenshot for a visual check (test-results/shots, git-ignored). */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `test-results/shots/${name}.png` });
}

function message(page: Page, text: string) {
  return page.locator('li[id^="message-"]').filter({ hasText: text }).first();
}

function memberRow(page: Page, nickname: string) {
  return page
    .getByRole('complementary', { name: 'Members' })
    .getByRole('listitem')
    .filter({ hasText: nickname });
}

/** Fills in the open report dialog and sends it. */
async function sendReport(page: Page, title: RegExp, reason: string, aspect?: string) {
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  if (aspect) await dialog.getByRole('radio', { name: aspect }).check();
  await dialog.getByRole('radio', { name: reason }).check();
  await dialog.getByLabel(/Anything a moderator should know/).fill('Please look at this.');
  await shot(page, `report-${reason.split(' ')[0]?.toLowerCase() ?? 'dialog'}`);
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('status')).toContainText('A moderator will look at it');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
}

const reportsBy = (reporterId: string) =>
  db.select().from(schema.report).where(eq(schema.report.reporterId, reporterId));

test('the word filter masks and blocks; messages, people and rooms can be reported', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const name = `Safety ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Public');
  await joinFromExplore(sam.page, name, roomPath);
  await expect(memberRow(ava.page, sam.nickname)).toBeVisible();

  // Medium severity: delivered, but the word is masked for everyone, the author included.
  await say(ava.page, name, 'you slut, honestly');
  const masked = `you ${MASK.repeat(4)}, honestly`;
  await expect(message(sam.page, masked)).toBeVisible();
  await expect(message(ava.page, masked)).toBeVisible();
  await expect(sam.page.getByRole('log')).not.toContainText('slut');

  // Low severity is left alone in community rooms.
  await say(ava.page, name, 'what a shit day');
  await expect(message(sam.page, 'what a shit day')).toBeVisible();

  // High severity: never sent. The author is told why; nobody else sees anything.
  await say(ava.page, name, 'just kill yourself');
  const refused = ava.page.getByRole('log').getByRole('alert');
  await expect(refused).toContainText('This message was not sent');
  await expect(refused).toContainText('words that are not allowed here');
  // Sending the same words again cannot help, so only "Delete" is offered.
  await expect(refused.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await shot(ava.page, 'filter-blocked');
  await refused.getByRole('button', { name: 'Delete' }).click();
  await say(ava.page, name, 'sorry about that');
  await expect(message(sam.page, 'sorry about that')).toBeVisible();
  await expect(sam.page.getByRole('log')).not.toContainText('kill yourself');

  // Sam reports the masked message: the server keeps the text as it was written.
  const reported = message(sam.page, masked);
  await reported.hover();
  await reported.getByRole('button', { name: 'Report' }).click();
  await sendReport(sam.page, /Report a message from/, 'Harassment or bullying');

  // ...and Ava's profile picture, from the member list...
  await memberRow(sam.page, ava.nickname)
    .getByRole('button', { name: `Report ${ava.nickname}` })
    .click();
  await sendReport(
    sam.page,
    new RegExp(`Report ${ava.nickname}`),
    'Sexual content',
    'Their profile picture',
  );

  // ...and the room itself.
  await sam.page.getByRole('button', { name: `Report the room ${name}` }).click();
  await sendReport(sam.page, /Report the room/, 'Something illegal');

  const samId = await userId(sam.nickname);
  const avaId = await userId(ava.nickname);
  const stored = await reportsBy(samId);
  const byType = new Map(stored.map((r) => [r.targetType, r]));
  expect([...byType.keys()].sort()).toEqual(['message', 'room', 'user']);
  expect(byType.get('message')).toMatchObject({
    targetUserId: avaId,
    reason: 'harassment',
    details: 'Please look at this.',
    status: 'open',
    evidence: { kind: 'message', message: { body: 'you slut, honestly', filterSeverity: 2 } },
  });
  expect(byType.get('user')).toMatchObject({
    targetUserId: avaId,
    reason: 'sexual',
    evidence: { kind: 'user', aspect: 'profile_picture', profile: { nickname: ava.nickname } },
  });
  expect(byType.get('room')).toMatchObject({
    reason: 'illegal',
    evidence: { kind: 'room', room: { name } },
  });

  // The filter put the masked message and the blocked attempt in front of the moderators.
  const flags = await db
    .select({ severity: schema.contentFlag.severity, excerpt: schema.contentFlag.excerpt })
    .from(schema.contentFlag)
    .where(eq(schema.contentFlag.userId, avaId));
  expect(flags.map((f) => f.severity).sort()).toEqual(['high', 'medium']);

  // You cannot report your own message: the button is not offered.
  const own = message(sam.page, masked);
  await expect(own.getByRole('button', { name: 'Report' })).toHaveCount(1);
  await message(ava.page, masked).hover();
  await expect(message(ava.page, masked).getByRole('button', { name: 'Report' })).toHaveCount(0);
});

test('a mute and a suspension reach the person at once, with the reason', async ({ browser }) => {
  test.setTimeout(90_000);
  const ava = await newVerifiedPerson(browser, 'ava');
  const name = `Standing ${shortId()}`;
  await createRoom(ava.page, name, 'Public');
  await say(ava.page, name, 'before the mute');
  await expect(message(ava.page, 'before the mute')).toBeVisible();
  const avaId = await userId(ava.nickname);
  const adminId = await newAdmin();

  // Muted: told why without reloading, and the composer gives way to the explanation.
  await sanction(adminId, avaId, 'mute', 'Flooding the room');
  await expect(ava.page.getByRole('alert').filter({ hasText: 'muted your account' })).toContainText(
    'Reason: Flooding the room',
  );
  await expect(ava.page.getByLabel(`Message #${name}`)).toHaveCount(0);
  await expect(
    ava.page.getByRole('region', { name }).getByText('A moderator muted your account until'),
  ).toContainText('Reason: Flooding the room');

  await shot(ava.page, 'account-muted');

  // The bell counts it, and the notification leads to the account-standing page.
  const bell = sidebar(ava.page).getByRole('link', { name: /^Notifications/ });
  await expect(bell.getByTestId('notifications-badge')).toHaveText('1, 1 unread');
  await bell.click();
  await ava.page.getByRole('link', { name: /A message from the moderators/ }).click();
  await expect(ava.page).toHaveURL(/\/app\/settings\/standing$/);
  const decision = ava.page.getByRole('list', { name: 'Decisions in force' }).getByRole('listitem');
  await expect(decision).toContainText('Muted');
  await expect(decision).toContainText('Flooding the room');
  await shot(ava.page, 'account-standing');

  // Lifted: they can post again.
  const lifted = await liftSanction(db, {
    actorId: adminId,
    targetUserId: avaId,
    kind: 'mute',
    reason: 'Appeal accepted',
  });
  expect(lifted.ok).toBe(true);
  await tellRealtime({ type: 'user.unsanctioned', userId: avaId, kind: 'mute' });
  await expect(
    ava.page.getByRole('status').filter({ hasText: 'You can post again.' }),
  ).toBeVisible();
  await expect(ava.page.getByText('Your account is in good standing')).toBeVisible();
  await sidebar(ava.page).getByRole('link', { name }).click();
  await say(ava.page, name, 'after the mute');
  await expect(message(ava.page, 'after the mute')).toBeVisible();

  // Suspended: signed out at once; signing in again says why and until when.
  await sanction(adminId, avaId, 'suspend', 'Harassing another member');
  await expect(ava.page).toHaveURL(/\/sign-in/);
  await ava.page.getByLabel('Email').fill(ava.email);
  await ava.page.getByLabel('Password').fill(PASSWORD);
  await ava.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const why = ava.page.getByRole('alert').filter({ hasText: 'This account is suspended until' });
  await expect(why).toContainText('Reason: Harassing another member');
  await shot(ava.page, 'sign-in-suspended');
  await expect(ava.page).toHaveURL(/\/sign-in/);
});
