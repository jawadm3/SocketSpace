/**
 * Journey J7 in real browsers: random mode, safely (RAND-01 to RAND-10).
 *
 * The 18+ gate, matching by shared interest and the random fallback after 10 seconds, links
 * refused, a report that carries the server's own record of the chat (and no chat text anywhere
 * else in the database), "Add contact" only when both press it, room suggestions with aggregate
 * counters, the pause notice with its end time, and a guest with stricter limits.
 *
 * The rule "three reports from different people pause someone for 24 hours" is exercised on live
 * connections in apps/realtime/src/random.test.ts; here the same database function applies the
 * pause, so the browser side (what the person sees) is checked without six more browser profiles.
 */
import type { Page } from '@playwright/test';

import {
  applyAutomaticRandomTimeout,
  createPgDatabase,
  eq,
  getMetricTotal,
  newId,
  schema,
} from '@socketspace/db';
import {
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
} from '@socketspace/shared/internal-events';

import { E2E } from '../playwright.config';

import { expect, newDevice, test } from './fixtures';
import { createRoom, newVerifiedPerson, shortId, sidebar } from './helpers';

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

/** With E2E_SHOTS=1: a screenshot for a visual check (test-results/shots, git-ignored). */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `test-results/shots/${name}.png` });
}

const lobby = (page: Page) => page.getByRole('form', { name: 'Start a random chat' });
const searching = (page: Page) => page.getByText('Looking for someone to talk to');
const messages = (page: Page) => page.getByTestId('random-message');

/** Ticks both boxes of the 18+ gate and continues to the lobby. */
async function passGate(page: Page, button = 'Continue'): Promise<void> {
  await expect(page.getByRole('heading', { name: /the rules of random chat/ })).toBeVisible();
  await page.getByLabel('I am 18 or older.').check();
  await page.getByLabel('I have read the rules above and accept them.').check();
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(lobby(page)).toBeVisible();
}

async function startSearch(page: Page, interests: string): Promise<void> {
  await page.getByLabel('Interests (optional)').fill(interests);
  const start = page.getByRole('button', { name: 'Start chatting' });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
}

async function write(page: Page, text: string): Promise<void> {
  const box = page.getByLabel('Message to the stranger');
  await box.fill(text);
  await box.press('Enter');
}

test('J7: the gate, a shared-interest match, links refused, a report with evidence', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = shortId();
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const kim = await newVerifiedPerson(browser, 'kim');

  // The gate: no way into the lobby without confirming and accepting.
  await sidebar(ava.page).getByRole('link', { name: 'Random chat' }).click();
  await expect(ava.page).toHaveURL(/\/app\/random$/);
  await expect(lobby(ava.page)).toHaveCount(0);
  await ava.page.getByLabel('I am 18 or older.').check();
  await ava.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    ava.page.getByRole('alert').filter({ hasText: 'Please tick both boxes' }),
  ).toBeVisible();
  await expect(lobby(ava.page)).toHaveCount(0);
  await shot(ava.page, 'random-gate');
  await passGate(ava.page);
  // The acceptance is stored: the gate does not come back.
  await ava.page.reload();
  await expect(lobby(ava.page)).toBeVisible();
  await shot(ava.page, 'random-lobby');
  for (const person of [sam, kim]) {
    await person.page.goto('/app/random');
    await passGate(person.page);
  }

  // Kim waits first with another interest; Ava and Sam share one and get each other.
  await startSearch(kim.page, `music${id}`);
  await expect(searching(kim.page)).toBeVisible();
  await startSearch(ava.page, `Chess${id}, films${id}`);
  await startSearch(sam.page, `chess${id}`);
  for (const person of [ava, sam]) {
    await expect(person.page.getByRole('heading', { name: 'Stranger' })).toBeVisible();
    await expect(person.page.getByText(`You both like: chess${id}`)).toBeVisible();
  }
  await expect(searching(kim.page)).toBeVisible();
  await shot(kim.page, 'random-searching');
  await kim.page.getByRole('button', { name: 'Cancel' }).click();
  await expect(lobby(kim.page)).toBeVisible();

  // Links are refused, plain or disguised; the other person never sees them.
  await write(ava.page, 'check out bit.ly/x');
  await expect(messages(ava.page).filter({ hasText: 'bit.ly' })).toContainText(
    "Not sent. Links aren't allowed in random chats.",
  );
  await write(ava.page, 'example dot com');
  await expect(messages(ava.page).filter({ hasText: 'example dot com' })).toContainText(
    "Links aren't allowed in random chats.",
  );
  await ava.page.waitForTimeout(1200);

  // Ordinary messages reach the other person; mild swearing arrives masked.
  await write(ava.page, `hello from ava ${id}`);
  await expect(messages(sam.page).filter({ hasText: `hello from ava ${id}` })).toBeVisible();
  await expect(messages(sam.page)).toHaveCount(1);
  await write(sam.page, `unkind words about walrus${id}`);
  await expect(messages(ava.page).filter({ hasText: `walrus${id}` })).toBeVisible();
  await write(sam.page, 'what a shit day');
  await expect(
    messages(ava.page).filter({ hasText: `what a ${MASK.repeat(4)} day` }),
  ).toBeVisible();
  await expect(
    messages(sam.page).filter({ hasText: `what a ${MASK.repeat(4)} day` }),
  ).toBeVisible();
  await shot(ava.page, 'random-chat');

  // Ava reports: the chat ends for both; only the reporter is told why.
  await ava.page.getByRole('button', { name: 'Report', exact: true }).click();
  const form = ava.page.getByRole('form', { name: 'Report this chat' });
  await form.getByLabel('What is wrong?').selectOption('harassment');
  await form.getByLabel(/Anything to add/).fill('They were unkind.');
  await shot(ava.page, 'random-report');
  await form.getByRole('button', { name: 'Send report' }).click();
  await expect(ava.page.getByRole('heading', { name: 'Chat ended' })).toBeVisible();
  await expect(ava.page.getByText('You reported this chat.')).toBeVisible();
  await expect(ava.page.getByText('Thank you for the report.')).toBeVisible();
  await expect(sam.page.getByRole('heading', { name: 'Chat ended' })).toBeVisible();
  await expect(sam.page.getByText('The stranger left the chat.')).toBeVisible();
  await shot(ava.page, 'random-ended-reported');

  // The report holds the server's record of the chat ...
  const avaId = await userId(ava.nickname);
  const samId = await userId(sam.nickname);
  const [report] = await db.select().from(schema.report).where(eq(schema.report.reporterId, avaId));
  expect(report).toMatchObject({
    targetType: 'random_session',
    targetUserId: samId,
    reason: 'harassment',
    details: 'They were unkind.',
  });
  const evidence = report?.evidence as {
    session: { endReason: string };
    messages: { from: string; text: string; delivered: boolean }[];
  };
  expect(evidence.session.endReason).toBe('report');
  expect(evidence.messages).toEqual([
    expect.objectContaining({ from: 'reporter', text: `hello from ava ${id}` }),
    expect.objectContaining({ from: 'reported', text: `unkind words about walrus${id}` }),
    // As written; the other person saw it masked.
    expect.objectContaining({ from: 'reported', text: 'what a shit day', delivered: true }),
  ]);
  // ... and the database holds no random-chat text anywhere else.
  const elsewhere = JSON.stringify([
    await db.select().from(schema.message),
    await db.select().from(schema.contentFlag),
    await db.select().from(schema.randomSession),
    await db.select().from(schema.notification),
    await db.select().from(schema.moderationAction),
  ]);
  expect(elsewhere).not.toContain(`walrus${id}`);
  expect(elsewhere).not.toContain(`hello from ava ${id}`);
  const [session] = await db
    .select()
    .from(schema.randomSession)
    .where(eq(schema.randomSession.id, report?.randomSessionId ?? ''));
  expect(session).toMatchObject({ endReason: 'report', sharedInterestCount: 1 });
});

test('J7: the random fallback, add contact when both ask, suggested rooms, the pause notice', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = shortId();
  const bea = await newVerifiedPerson(browser, 'bea');
  const cal = await newVerifiedPerson(browser, 'cal');
  // A public room about Cal's interest, which Cal is not in yet.
  const roomName = `Lounge${id}`;
  const roomPath = await createRoom(bea.page, roomName, 'Public');
  for (const person of [bea, cal]) {
    await person.page.goto('/app/random');
    await passGate(person.page);
  }

  // No shared interest: they are paired with each other only after waiting 10 seconds.
  await startSearch(bea.page, `knitting${id}`);
  await startSearch(cal.page, `lounge${id}`);
  const startedAt = Date.now();
  await expect(cal.page.getByText('Widening the search to everyone.')).toBeVisible({
    timeout: 20_000,
  });
  for (const person of [bea, cal]) {
    await expect(person.page.getByText('No shared interests: a random match.')).toBeVisible({
      timeout: 20_000,
    });
  }
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(9000);

  // "Add contact": one person asking shares nothing.
  const beaId = await userId(bea.nickname);
  const calId = await userId(cal.nickname);
  const contactsOf = (owner: string) =>
    db.select().from(schema.contact).where(eq(schema.contact.userId, owner));
  await bea.page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await expect(bea.page.getByRole('button', { name: 'Waiting for their answer…' })).toBeVisible();
  await expect(cal.page.getByText('would like to add you as a contact')).toBeVisible();
  await expect(cal.page.getByRole('heading', { name: 'Stranger' })).toBeVisible();
  expect(await contactsOf(beaId)).toEqual([]);
  expect(await contactsOf(calId)).toEqual([]);
  await shot(cal.page, 'random-offer');

  // Both asked: each appears in the other's contacts, and the names are shown.
  await cal.page.getByRole('button', { name: 'Accept: add contact' }).click();
  await expect(cal.page.getByRole('heading', { name: bea.nickname })).toBeVisible();
  await expect(bea.page.getByRole('heading', { name: cal.nickname })).toBeVisible();
  for (const person of [bea, cal]) {
    await expect(person.page.getByRole('button', { name: 'Contact added' })).toBeDisabled();
  }
  expect(await contactsOf(beaId)).toMatchObject([{ contactId: calId, source: 'random' }]);
  expect(await contactsOf(calId)).toMatchObject([{ contactId: beaId, source: 'random' }]);

  // The end screen suggests public rooms about the person's interest; opening and joining one is
  // counted, without storing who did it.
  const clicked = await getMetricTotal(db, 'random_room_cta_clicked');
  const joined = await getMetricTotal(db, 'room_joined_after_random');
  await bea.page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(bea.page.getByText('You ended the chat.')).toBeVisible();
  await expect(bea.page.getByText(`You and ${cal.nickname} are now contacts.`)).toBeVisible();
  await expect(cal.page.getByText('The stranger left the chat.')).toBeVisible();
  const open = cal.page.getByRole('button', { name: `Open #${roomName}` });
  await expect(open).toBeVisible();
  await shot(cal.page, 'random-ended-suggestions');
  await open.click();
  await expect(cal.page).toHaveURL(new RegExp(`${roomPath}\\?from=random$`));
  await cal.page.getByRole('button', { name: `Join #${roomName}` }).click();
  await expect(cal.page.getByLabel(`Message #${roomName}`)).toBeVisible();
  expect(await getMetricTotal(db, 'random_room_cta_clicked')).toBe(clicked + 1);
  expect(await getMetricTotal(db, 'room_joined_after_random')).toBe(joined + 1);
  const counters = await db.select().from(schema.metricDaily);
  expect(Object.keys(counters[0] ?? {}).sort()).toEqual(['day', 'name', 'value']);
  expect(JSON.stringify(counters)).not.toContain(calId);

  // A pause (here the automatic one after three reports) is shown with its end time, and the
  // person cannot start a chat.
  const result = await applyAutomaticRandomTimeout(db, { targetUserId: beaId, cause: 'reports' });
  if (!result.applied) throw new Error(result.reason);
  await tellRealtime({
    type: 'user.sanctioned',
    userId: beaId,
    kind: 'random_timeout',
    reason: result.sanction.reason,
    until: result.sanction.expiresAt?.toISOString() ?? null,
  });
  await expect(bea.page.getByText(/You cannot use random chat until/)).toBeVisible();
  await bea.page.getByRole('button', { name: 'Change interests' }).click();
  const paused = lobby(bea.page).getByRole('alert');
  await expect(paused).toContainText('Random chat is paused for you until');
  await expect(paused).toContainText('Three different people reported your random chats');
  const start = bea.page.getByRole('button', { name: 'Start chatting' });
  await expect(start).toBeDisabled();
  // It also looks switched off.
  await expect(start).toHaveCSS('opacity', '0.6');
  await shot(bea.page, 'random-paused');
});

test('J7: a guest chats without an account, with stricter limits (RAND-10)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = shortId();
  const dan = await newVerifiedPerson(browser, 'dan');
  await dan.page.goto('/app/random');
  await passGate(dan.page);

  // The guest: no account, the gate first, then the same chat.
  const context = await newDevice(browser);
  const guest = await context.newPage();
  await guest.goto('/');
  await guest.getByRole('link', { name: /Try random chat as a guest/ }).click();
  await expect(guest).toHaveURL(/\/random$/);
  await shot(guest, 'random-guest-gate');
  await passGate(guest, 'Continue as a guest');

  await startSearch(guest, `tea${id}`);
  await startSearch(dan.page, `tea${id}`);
  for (const page of [guest, dan.page]) {
    await expect(page.getByText(`You both like: tea${id}`)).toBeVisible({ timeout: 15_000 });
  }
  await write(guest, `hello from a guest ${id}`);
  await expect(messages(dan.page).filter({ hasText: `hello from a guest ${id}` })).toBeVisible();
  await write(dan.page, `hello guest ${id}`);
  await expect(messages(guest).filter({ hasText: `hello guest ${id}` })).toBeVisible();

  // No exchange of contacts with a guest: the guest has no buttons, the member is refused.
  await expect(guest.getByRole('button', { name: 'Add contact' })).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Share profiles' })).toHaveCount(0);
  await dan.page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await expect(
    dan.page.getByRole('alert').filter({ hasText: 'both of you have an account' }),
  ).toBeVisible();
  await expect(dan.page.getByRole('heading', { name: 'Stranger' })).toBeVisible();
  await shot(guest, 'random-guest-chat');

  // The member skips: the guest sees the end and is invited to create an account.
  await dan.page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(searching(dan.page)).toBeVisible();
  await expect(guest.getByRole('heading', { name: 'Chat ended' })).toBeVisible();
  await expect(guest.getByText('The stranger left the chat.')).toBeVisible();
  await dan.page.getByRole('button', { name: 'Cancel' }).click();

  // A guest account can do nothing else: the app sends it to sign-in.
  await guest.goto('/app');
  await expect(guest).toHaveURL(/\/sign-in/);
  // The guest is a real, anonymous account that passed the gate.
  const guests = await db.select().from(schema.user).where(eq(schema.user.isAnonymous, true));
  expect(guests.some((g) => g.adultConfirmedAt !== null && g.randomTermsVersion !== null)).toBe(
    true,
  );
  await context.close();
});
