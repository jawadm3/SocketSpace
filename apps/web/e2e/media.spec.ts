/**
 * Stage D5 in real browsers (qa/acceptance_criteria.md J9 and J11; MSG-08, MSG-09, PROF-08,
 * SEC-07, SEC-12): pictures in messages, a photo as profile picture, and link previews.
 *
 * A small web server in this file plays "a site on the internet". The web app under test reaches
 * the made-up name `preview.test` at that server (LINK_PREVIEW_DEV_HOSTS in playwright.config.ts);
 * every other safety rule of the preview fetcher stays in force, which is what the test checks.
 */
import { createServer, type Server } from 'node:http';

import type { Page } from '@playwright/test';
import pg from 'pg';
import sharp from 'sharp';

import { E2E } from '../playwright.config';

import { expect, test } from './fixtures';
import { createRoom, joinFromExplore, newVerifiedPerson, say, shortId } from './helpers';

const PREVIEW = `http://${E2E.previewHost}`;
let site: Server;
/** Every request that reached the pretend site. */
let siteHits: string[] = [];

test.beforeAll(async () => {
  site = createServer((request, response) => {
    const url = request.url ?? '/';
    siteHits.push(url);
    if (url === '/article') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
        <title>Fallback title</title>
        <meta property="og:title" content="How pigeons find their way home">
        <meta property="og:description" content="A short article about &lt;b&gt;homing&lt;/b&gt; pigeons.">
        <meta property="og:site_name" content="Pigeon Post">
        <meta property="og:image" content="${PREVIEW}/tracking-pixel.png">
        </head><body>Article</body></html>`);
    } else if (url === '/to-private') {
      // A public page that sends the visitor on to a private address.
      response.writeHead(302, { location: `http://127.0.0.1:${String(E2E.previewPort)}/secret` });
      response.end();
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<title>Secret admin page</title>');
    }
  });
  await new Promise<void>((done) => site.listen(E2E.previewPort, '127.0.0.1', done));
});

test.afterAll(async () => {
  site.closeAllConnections();
  await new Promise((done) => site.close(done));
});

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 140, b: 220 } } });

/** A photo as a phone makes it: with the camera and a GPS position in its EXIF. */
const jpegWithGps = (width = 1200, height = 800) =>
  solid(width, height)
    .withExif({
      IFD0: { Make: 'SocketCam' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 2646/100',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 3995/100',
      },
    })
    .jpeg()
    .toBuffer();

async function database<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const attachmentCount = () =>
  database(async (client) => {
    const result = await client.query<{ n: number }>('select count(*)::int as n from attachment');
    return result.rows[0]?.n ?? 0;
  });

function message(page: Page, text: string) {
  return page.locator('li[id^="message-"]').filter({ hasText: text }).first();
}

const drafts = (page: Page) => page.getByTestId('picture-draft');

/** With E2E_SHOTS=1: a screenshot for a visual check (test-results/shots, git-ignored). */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `test-results/shots/${name}.png` });
}

/** Uploads straight to the server (skipping the browser's own quick checks). */
function postUpload(page: Page, body: Buffer) {
  return page.request.post('/api/uploads?kind=message', {
    data: body,
    headers: { 'content-type': 'application/octet-stream', origin: E2E.baseURL },
  });
}

async function loadedPicture(page: Page, text: string) {
  const picture = message(page, text).getByTestId('message-picture');
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  return picture;
}

test('J9: a photo with GPS data is stored as WebP without metadata; fakes and oversized files are refused', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const name = `Photos ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Public');
  await joinFromExplore(sam.page, name, roomPath);
  const composer = ava.page.getByLabel(`Message #${name}`);
  const picker = ava.page.locator('#composer-pictures');

  // The file really carries a location before it is uploaded.
  const original = await jpegWithGps();
  expect((await sharp(original).metadata()).exif).toBeDefined();

  // Attach, wait for the upload, send with a caption: both people see it at once.
  await picker.setInputFiles({ name: 'holiday.jpg', mimeType: 'image/jpeg', buffer: original });
  await expect(drafts(ava.page)).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await composer.fill('Look at this view');
  await shot(ava.page, 'media-composer-draft');
  await composer.press('Enter');
  await expect(drafts(ava.page)).toHaveCount(0);
  const avaPicture = await loadedPicture(ava.page, 'Look at this view');
  const samPicture = await loadedPicture(sam.page, 'Look at this view');
  const src = await samPicture.getAttribute('src');
  expect(src).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
  expect(await avaPicture.getAttribute('src')).toBe(src);

  // What is stored and served: WebP, scaled down, no EXIF, no trace of the camera or position.
  const served = await sam.page.request.get(src ?? '');
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/webp');
  expect(served.headers()['x-content-type-options']).toBe('nosniff');
  const stored = await served.body();
  const metadata = await sharp(stored).metadata();
  expect(metadata.format).toBe('webp');
  expect(metadata.exif).toBeUndefined();
  expect(metadata.xmp).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  expect(stored.includes('SocketCam')).toBe(false);
  expect(stored.includes('Exif')).toBe(false);
  expect([metadata.width, metadata.height]).toEqual([1200, 800]);
  const row = await database(async (client) => {
    const result = await client.query<{ mime: string; status: string; storage_key: string }>(
      'select mime, status, storage_key from attachment where id = $1',
      [src?.split('/').pop()],
    );
    return result.rows[0];
  });
  expect(row).toMatchObject({ mime: 'image/webp', status: 'attached' });
  expect(row?.storage_key).toMatch(/^m\/[0-9a-f]{32}\.webp$/);

  // Someone who is not signed in gets nothing.
  const stranger = await browser.newContext();
  expect((await stranger.request.get(`${E2E.baseURL}${src ?? ''}`)).status()).toBe(401);
  await stranger.close();

  // A picture needs no text; the reply quote and the picture survive a reload.
  await picker.setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: await solid(40, 30).png().toBuffer(),
  });
  await expect(drafts(ava.page)).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await ava.page.getByRole('button', { name: 'Send' }).click();
  await expect(sam.page.getByTestId('message-picture')).toHaveCount(2);
  await sam.page.reload();
  await expect(sam.page.getByTestId('message-picture')).toHaveCount(2);

  // Refused, each with a clear reason (the browser checks first; the server decides).
  const php = Buffer.from('<?php system($_GET["c"]); ?>');
  await picker.setInputFiles({ name: 'cute-cat.png', mimeType: 'image/png', buffer: php });
  await expect(drafts(ava.page).getByRole('alert')).toContainText('not a picture');
  await shot(ava.page, 'media-refused');
  await sam.page.setViewportSize({ width: 375, height: 812 });
  await shot(sam.page, 'media-room-mobile');
  await ava.page.getByRole('button', { name: 'Remove cute-cat.png' }).click();

  const sixMb = Buffer.concat([
    await solid(10, 10).png().toBuffer(),
    Buffer.alloc(6 * 1024 * 1024),
  ]);
  await picker.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: sixMb });
  await expect(drafts(ava.page).getByRole('alert')).toContainText('at most 4 MB');
  await ava.page.getByRole('button', { name: 'Remove big.png' }).click();

  const thirtyMegapixels = await solid(6000, 5000).png({ compressionLevel: 1 }).toBuffer();
  await picker.setInputFiles({
    name: 'poster.png',
    mimeType: 'image/png',
    buffer: thirtyMegapixels,
  });
  await expect(drafts(ava.page).getByRole('alert')).toContainText('25 megapixels', {
    timeout: 20_000,
  });
  await ava.page.getByRole('button', { name: 'Remove poster.png' }).click();
  // Nothing to send: the button stays off.
  await expect(ava.page.getByRole('button', { name: 'Send' })).toBeDisabled();

  // The same files sent straight to the server, without the browser's checks.
  const before = await attachmentCount();
  const phpAnswer = await postUpload(ava.page, php);
  expect(phpAnswer.status()).toBe(415);
  expect(((await phpAnswer.json()) as { error: { message: string } }).error.message).toMatch(
    /not a picture/,
  );
  expect((await postUpload(ava.page, sixMb)).status()).toBe(413);
  expect((await postUpload(ava.page, thirtyMegapixels)).status()).toBe(422);
  // From another site's page (a different Origin): refused before anything is read.
  const foreign = await ava.page.request.post('/api/uploads?kind=message', {
    data: original,
    headers: { 'content-type': 'application/octet-stream', origin: 'https://evil.example' },
  });
  expect(foreign.status()).toBe(403);
  const after = await attachmentCount();
  expect(after).toBe(before);

  // A deleted message takes its picture with it.
  const captioned = message(ava.page, 'Look at this view');
  await captioned.hover();
  await captioned.getByRole('button', { name: 'Delete' }).click();
  await captioned
    .getByRole('group', { name: 'Confirm deletion' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(sam.page.getByTestId('message-picture')).toHaveCount(1);
  expect((await sam.page.request.get(src ?? '')).status()).toBe(404);

  // A message the server refuses says why and offers "Try again" and "Delete" (UI-05). Here the
  // uploaded picture disappears (as the clean-up of old unused uploads would do) before sending.
  await picker.setInputFiles({
    name: 'gone.png',
    mimeType: 'image/png',
    buffer: await solid(60, 60).png().toBuffer(),
  });
  await expect(drafts(ava.page)).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await database((client) => client.query("delete from attachment where status = 'pending'"));
  await composer.fill('This one will not go through');
  await composer.press('Enter');
  const refused = ava.page.getByRole('log').getByRole('alert');
  await expect(refused).toContainText('A picture in this message is no longer available');
  await expect(ava.page.getByRole('log')).toContainText('Not sent');
  await shot(ava.page, 'media-send-refused');
  await refused.getByRole('button', { name: 'Try again' }).click();
  await expect(refused).toContainText('no longer available');
  await refused.getByRole('button', { name: 'Delete' }).click();
  await expect(ava.page.getByRole('log')).not.toContainText('This one will not go through');
  await expect(message(sam.page, 'This one will not go through')).toHaveCount(0);

  await ava.context.close();
  await sam.context.close();
});

test('J9: link previews are text only, and nothing is fetched from private addresses', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const name = `Links ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Public');
  await joinFromExplore(sam.page, name, roomPath);

  // Neither browser may contact the linked site itself: previews come from our server.
  const contacted: string[] = [];
  for (const page of [ava.page, sam.page]) {
    page.on('request', (request) => {
      if (new URL(request.url()).hostname === E2E.previewHost) contacted.push(request.url());
    });
  }
  siteHits = [];

  await say(ava.page, name, `Good read: ${PREVIEW}/article`);
  for (const page of [ava.page, sam.page]) {
    const card = message(page, 'Good read').getByTestId('link-preview');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Pigeon Post');
    await expect(card).toContainText('How pigeons find their way home');
    // Tags in the page's text arrive as text.
    await expect(card).toContainText('A short article about <b>homing</b> pigeons.');
    await expect(card.locator('img')).toHaveCount(0);
    await expect(card.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
  }
  // Two readers, one fetch; and the picture the page names was never asked for.
  expect(siteHits.filter((hit) => hit === '/article')).toHaveLength(1);
  expect(siteHits).not.toContain('/tracking-pixel.png');
  await shot(sam.page, 'media-link-preview');

  // Hostile links: the cloud metadata address, localhost, and a public page that redirects to a
  // private address. No preview, and no request to those addresses.
  siteHits = [];
  const hostile = [
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:3000',
    `${PREVIEW}/to-private`,
  ];
  for (const [index, link] of hostile.entries()) {
    const text = `Hostile ${String(index)}`;
    await say(ava.page, name, `${text} ${link}`);
    const sent = message(sam.page, text);
    await expect(sent).toBeVisible();
    const id = (await sent.getAttribute('id'))?.replace('message-', '') ?? '';
    // Ask the server directly, so the check does not depend on timing in the page.
    const answer = await sam.page.request.get(`/api/messages/${id}/previews`);
    expect(answer.status()).toBe(200);
    expect(await answer.json()).toEqual({ previews: [] });
    await expect(sent.getByTestId('link-preview')).toHaveCount(0);
    // The link itself is still an ordinary link the reader can choose to click.
    await expect(sent.getByRole('link', { name: link })).toBeVisible();
  }
  // The redirecting page was asked once; the private address behind it never was.
  expect(siteHits).toEqual(['/to-private']);
  expect(siteHits).not.toContain('/secret');

  const statuses = await database(async (client) => {
    const result = await client.query<{ url: string; status: string }>(
      'select url, status from link_preview where url = any($1)',
      [hostile.map((link) => new URL(link).href)],
    );
    return Object.fromEntries(result.rows.map((r) => [r.url, r.status]));
  });
  expect(statuses).toEqual({
    'http://169.254.169.254/latest/meta-data/': 'blocked',
    'http://localhost:3000/': 'blocked',
    [`${PREVIEW}/to-private`]: 'blocked',
  });
  expect(contacted).toEqual([]);

  await ava.context.close();
  await sam.context.close();
});

test('J11: an uploaded profile photo is cropped, stripped of metadata and shown to others', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ava = await newVerifiedPerson(browser, 'ava');
  const sam = await newVerifiedPerson(browser, 'sam');
  const name = `Faces ${shortId()}`;
  const roomPath = await createRoom(ava.page, name, 'Public');
  await joinFromExplore(sam.page, name, roomPath);
  await say(ava.page, name, 'Hello from Ava');
  const samSees = message(sam.page, 'Hello from Ava').locator('img').first();
  await expect(samSees).toHaveAttribute('src', /^\/api\/avatar\?c=/);

  await ava.page.goto('/app/settings/profile');
  await ava.page.getByRole('tab', { name: 'Upload a photo' }).click();
  await ava.page.getByTestId('avatar-photo-input').setInputFiles({
    name: 'me.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegWithGps(900, 500),
  });
  await expect(ava.page.getByTestId('picked-avatar')).toHaveAttribute('src', /^\/api\/media\//, {
    timeout: 15_000,
  });
  await shot(ava.page, 'media-avatar-photo');
  await ava.page.getByRole('button', { name: 'Save changes' }).click();
  await expect(ava.page.getByText('Saved.')).toBeVisible();

  // Sam sees the new picture without reloading, served by our own server.
  await expect(samSees).toHaveAttribute('src', /^\/api\/media\/[0-9a-f-]{36}$/, {
    timeout: 10_000,
  });
  const src = (await samSees.getAttribute('src')) ?? '';
  const served = await sam.page.request.get(src);
  expect(served.status()).toBe(200);
  const metadata = await sharp(await served.body()).metadata();
  expect([metadata.format, metadata.width, metadata.height, metadata.exif]).toEqual([
    'webp',
    256,
    256,
    undefined,
  ]);

  // A file that is not a picture is refused with a reason, and the photo stays.
  await ava.page.getByTestId('avatar-photo-input').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<?php echo "hi"; ?>'),
  });
  await expect(ava.page.getByRole('alert').filter({ hasText: 'not a picture' })).toBeVisible();
  await expect(ava.page.getByTestId('picked-avatar')).toHaveAttribute('src', src);

  // Back to a generated picture: the photo is gone for everyone.
  await ava.page.getByRole('tab', { name: 'Gallery' }).click();
  await ava.page.getByAltText(/^Picture 1 /).click();
  await ava.page.getByRole('button', { name: 'Save changes' }).click();
  await expect(samSees).toHaveAttribute('src', /^\/api\/avatar\?c=/, { timeout: 10_000 });
  expect((await sam.page.request.get(src)).status()).toBe(404);

  await ava.context.close();
  await sam.context.close();
});
