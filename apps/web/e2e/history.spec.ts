/**
 * Long histories (HIST-02, HIST-04): a room with 10,000 messages opens at the newest, loads older
 * pages as the reader scrolls up, keeps only the visible messages in the page, and scrolls without
 * long stalls. Frame times are printed so they can be recorded as evidence.
 */
import pg from 'pg';

import { E2E } from '../playwright.config';

import { expect, test } from './fixtures';
import { createRoom, newVerifiedPerson, shortId } from './helpers';

const COUNT = 10_000;

/** Writes `COUNT` messages straight into the database (much faster than sending them). */
async function seedMessages(slug: string, nickname: string): Promise<void> {
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    await client.query('begin');
    const room = await client.query<{ id: string; last: string }>(
      'select id, last_event_seq as last from conversation where slug = $1 for update',
      [slug],
    );
    const author = await client.query<{ id: string }>('select id from "user" where nickname = $1', [
      nickname,
    ]);
    const roomId = room.rows[0]?.id;
    const authorId = author.rows[0]?.id;
    if (!roomId || !authorId) throw new Error('room or author missing');
    const base = Number(room.rows[0]?.last ?? 0);
    // Every seventh message has two lines, so rows have different heights.
    await client.query(
      `insert into message (id, conversation_id, seq, version_seq, author_id, client_id, body, created_at)
       select gen_random_uuid(), $1, $2 + s, $2 + s, $3, gen_random_uuid(),
              'Message number ' || s || case when s % 7 = 0 then E'\\nwith a second line' else '' end,
              now() - make_interval(secs => $4 - s)
         from generate_series(1, $4::int) as s`,
      [roomId, base, authorId, COUNT],
    );
    // The newest message replies to message 9,000, ten pages back.
    await client.query(
      `insert into message (id, conversation_id, seq, version_seq, author_id, client_id, body, reply_to_id)
       select gen_random_uuid(), $1, $2::bigint + $4::bigint + 1, $2::bigint + $4::bigint + 1, $3, gen_random_uuid(),
              'A reply to an old message', (select id from message where conversation_id = $1 and seq = $2::bigint + 9000)`,
      [roomId, base, authorId, COUNT],
    );
    await client.query(
      'update conversation set last_event_seq = $2, last_message_at = now() where id = $1',
      [roomId, base + COUNT + 1],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

test('HIST-02, HIST-04: 10,000 messages load page by page, stay light and scroll smoothly', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ava = await newVerifiedPerson(browser, 'ava');
  const name = `Archive ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Public');
  await seedMessages(roomPath.split('/').pop() ?? '', ava.nickname);

  const page = ava.page;
  await page.reload();
  const log = page.getByRole('log');
  await expect(log.getByText(`Message number ${String(COUNT)}`, { exact: true })).toBeVisible();
  const rowsInPage = () => page.locator('li[id^="message-"]').count();
  expect(await rowsInPage()).toBeLessThan(60);

  // One scroll to the top loads one page, and the message that was at the top stays in view
  // (the reader keeps their place instead of being thrown further back).
  const pageRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/messages?before=')) pageRequests.push(request.url());
  });
  const scrollToTop = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('[role="log"]')?.parentElement;
      if (scroller) scroller.scrollTop = 0;
    });
  const firstShown = `Message number ${String(COUNT - 48)}`;
  await scrollToTop();
  await expect(
    log.getByText(`Message number ${String(COUNT - 49)}`, { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1000);
  expect(pageRequests).toHaveLength(1);
  await expect(log.getByText(firstShown, { exact: true })).toBeInViewport();

  // A reply quote whose original is not loaded yet loads older pages until it finds it (MSG-04).
  await page.evaluate(() => {
    const scroller = document.querySelector('[role="log"]')?.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await log.getByRole('button', { name: /^Replying to an earlier message/ }).click();
  await expect(log.getByText('Message number 9000', { exact: true })).toBeInViewport({
    timeout: 20_000,
  });
  await expect(page.locator('li[id^="message-"]:focus')).toContainText('Message number 9000');

  // Keep scrolling to the top until the start of the room is reached.
  const started = Date.now();
  const start = log.getByText(`This is the start of #${name}.`);
  while (!(await start.isVisible())) {
    expect(Date.now() - started, 'reaching the start took too long').toBeLessThan(180_000);
    await scrollToTop();
    await page.waitForTimeout(150);
  }
  const loadSeconds = (Date.now() - started) / 1000;
  // The last page kept the reader's place too; one more scroll up shows the very first message.
  await scrollToTop();
  await expect(log.getByText('Message number 1', { exact: true })).toBeInViewport();
  const rowsAtTop = await rowsInPage();
  expect(rowsAtTop).toBeLessThan(80);

  // Scroll from the top to the bottom, one screen per frame, and time every frame.
  const frames = await page.evaluate(async () => {
    const scroller = document.querySelector('[role="log"]')?.parentElement;
    if (!scroller) return [];
    const gaps: number[] = [];
    let last = performance.now();
    for (let guard = 0; guard < 5000; guard++) {
      scroller.scrollTop += scroller.clientHeight;
      await new Promise((done) => requestAnimationFrame(done));
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break;
    }
    return gaps;
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const worst = sorted[sorted.length - 1] ?? 0;
  const over50 = frames.filter((gap) => gap > 50).length;
  console.log(
    `[HIST-04] ${String(COUNT)} messages: start reached after ${loadSeconds.toFixed(1)} s ` +
      `(${String(pageRequests.length)} page requests); ` +
      `rows in page at the top ${String(rowsAtTop)}; scroll frames ${String(frames.length)}, ` +
      `p95 ${p95.toFixed(1)} ms, worst ${worst.toFixed(1)} ms, over 50 ms ${String(over50)}`,
  );
  expect(frames.length).toBeGreaterThan(50);
  expect(p95).toBeLessThan(100);
  await expect(log.getByText(`Message number ${String(COUNT)}`, { exact: true })).toBeVisible();

  await ava.context.close();
});
