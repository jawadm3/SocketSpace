/**
 * POST /api/uploads and GET /api/media/<id> against the real sign-in setup and a database
 * (MSG-09, PROF-08, SEC-12, journey J9): who may upload, what is refused and why, what is stored,
 * and who may see it afterwards.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  deleteMessage,
  eq,
  roomCreate,
  schema,
  sendMessage,
  sql,
  updateProfile,
} from '@socketspace/db';
import { LIMITS } from '@socketspace/shared/limits';
import { uploadResponseSchema } from '@socketspace/shared/media';

import { cookieHeader, createAuthHarness, type AuthHarness } from '../../test/auth-harness';
import {
  createLocalStorage,
  createMemoryStorage,
  createVercelBlobStorage,
  isStorageKey,
  newStorageKey,
  type BlobApi,
} from '../storage';
import { collectAttachmentGarbage, serveMedia } from './media';
import { handleUpload } from './upload';

let h: AuthHarness;
const storage = createMemoryStorage();
let n = 0;

beforeAll(async () => {
  h = await createAuthHarness();
});

afterAll(async () => {
  await h.close();
});

async function person(options: { verified?: boolean; onboarded?: boolean } = {}) {
  n += 1;
  const email = `upload${String(n)}@example.test`;
  const result = await h.call('/sign-up/email', {
    body: { email, password: 'correct horse battery staple', name: '' },
  });
  const [row] = await h.db.select().from(schema.user).where(eq(schema.user.email, email));
  if (!row) throw new Error('no user');
  await h.db
    .update(schema.user)
    .set({
      emailVerified: options.verified ?? true,
      ...((options.onboarded ?? true) && {
        nickname: `uploader${String(n)}`,
        avatarKind: 'preset',
        avatarConfig: { style: 'lorelei', seed: 'x' },
        onboardedAt: new Date(),
      }),
    })
    .where(eq(schema.user.id, row.id));
  return { id: row.id, cookie: cookieHeader(result.cookies) };
}

const jpeg = (width = 320, height = 240) =>
  sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
    .jpeg()
    .toBuffer();

function upload(
  cookie: string | null,
  body: Buffer,
  options: { kind?: string; origin?: string | null; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({
    'content-type': 'application/octet-stream',
    ...options.headers,
  });
  if (cookie) headers.set('cookie', cookie);
  const origin = options.origin === undefined ? 'http://localhost:3000' : options.origin;
  if (origin !== null) headers.set('origin', origin);
  return handleUpload(
    new Request(`http://localhost:3000/api/uploads?kind=${options.kind ?? 'message'}`, {
      method: 'POST',
      headers,
      body: new Uint8Array(body),
    }),
    { auth: h.auth, db: h.db, env: h.env, storage },
  );
}

const media = (cookie: string | null, id: string, headers: Record<string, string> = {}) =>
  serveMedia(
    new Request(`http://localhost:3000/api/media/${id}`, {
      headers: { ...headers, ...(cookie ? { cookie } : {}) },
    }),
    id,
    { auth: h.auth, db: h.db, storage },
  );

async function uploaded(cookie: string, body: Buffer, kind = 'message') {
  const response = await upload(cookie, body, { kind });
  expect(response.status).toBe(201);
  return uploadResponseSchema.parse(await response.json()).attachment;
}

const message = async (response: Response) =>
  ((await response.json()) as { error: { message: string } }).error.message;

describe('POST /api/uploads', () => {
  it('stores a re-encoded WebP without metadata and answers with its ID and size (J9)', async () => {
    const ava = await person();
    const attachment = await uploaded(ava.cookie, await jpeg());
    expect(attachment).toMatchObject({ width: 320, height: 240 });

    const [row] = await h.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, attachment.id));
    expect(row).toMatchObject({ uploaderId: ava.id, status: 'pending', mime: 'image/webp' });
    expect(isStorageKey(row?.storageKey ?? '')).toBe(true);
    const stored = await storage.get(row?.storageKey ?? '');
    if (!stored) throw new Error('nothing stored');
    const metadata = await sharp(stored).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect(stored.length).toBe(row?.bytes);
  });

  it('refuses a renamed PHP file, a 30-megapixel picture and a 6 MB file, each with a reason (J9)', async () => {
    const ava = await person();
    const before = storage.size();

    const php = await upload(ava.cookie, Buffer.from('<?php system($_GET["c"]); ?>'));
    expect(php.status).toBe(415);
    expect(await message(php)).toMatch(/not a picture/);

    const huge = await sharp({
      create: { width: 6000, height: 5000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png({ compressionLevel: 1 })
      .toBuffer();
    const tooManyPixels = await upload(ava.cookie, huge);
    expect(tooManyPixels.status).toBe(422);
    expect(await message(tooManyPixels)).toMatch(/25 megapixels/);

    const sixMb = Buffer.concat([await jpeg(), Buffer.alloc(6 * 1024 * 1024)]);
    const tooLarge = await upload(ava.cookie, sixMb);
    expect(tooLarge.status).toBe(413);
    expect(await message(tooLarge)).toMatch(/at most 4 MB/);
    // The same when the browser does not say how large the file is until it has been read.
    const undeclared = await upload(ava.cookie, sixMb, { headers: { 'content-length': '10' } });
    expect(undeclared.status).toBe(413);

    expect(storage.size()).toBe(before);
    const rows = await h.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.uploaderId, ava.id));
    expect(rows).toHaveLength(0);
  });

  it('needs a signed-in account with a confirmed email, from our own pages', async () => {
    const ava = await person();
    const file = await jpeg();
    expect((await upload(null, file)).status).toBe(401);
    expect((await upload(ava.cookie, file, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await upload(ava.cookie, file, { origin: null })).status).toBe(403);
    expect(
      (await upload(ava.cookie, file, { headers: { 'sec-fetch-site': 'cross-site' } })).status,
    ).toBe(403);
    expect((await upload(ava.cookie, file, { kind: 'banner' })).status).toBe(400);

    const unverified = await person({ verified: false });
    const refused = await upload(unverified.cookie, file);
    expect(refused.status).toBe(403);
    expect(await message(refused)).toMatch(/Confirm your email/);

    // Before onboarding is finished: a profile photo yes, a message picture no.
    const newcomer = await person({ onboarded: false });
    expect((await upload(newcomer.cookie, file)).status).toBe(403);
    expect((await upload(newcomer.cookie, file, { kind: 'avatar' })).status).toBe(201);

    await h.db.update(schema.user).set({ status: 'suspended' }).where(eq(schema.user.id, ava.id));
    expect((await upload(ava.cookie, file)).status).toBe(403);
  });

  it(`allows ${String(LIMITS.upload.perHour)} uploads an hour, counting refused ones`, async () => {
    const ava = await person();
    // Start the count from a known place: the window is the clock hour.
    await h.db.delete(schema.httpRateLimit).where(eq(schema.httpRateLimit.key, `upload:${ava.id}`));
    await h.db.insert(schema.httpRateLimit).values({
      key: `upload:${ava.id}`,
      windowStart: sql`to_timestamp(floor(extract(epoch from now()) / 3600) * 3600)`,
      count: LIMITS.upload.perHour - 1,
    });
    const junk = await upload(ava.cookie, Buffer.from('not a picture'));
    expect(junk.status).toBe(415);
    const limited = await upload(ava.cookie, await jpeg());
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('GET /api/media/<id>', () => {
  it('serves a message picture to people who may read the room, and to nobody else', async () => {
    const ava = await person();
    const sam = await person();
    const attachment = await uploaded(ava.cookie, await jpeg());

    // Not sent yet: only the uploader.
    expect((await media(sam.cookie, attachment.id)).status).toBe(404);
    expect((await media(ava.cookie, attachment.id)).status).toBe(200);

    const room = await roomCreate(h.db, ava.id, {
      slug: `pictures-${uuidv4().slice(0, 8)}`,
      name: 'Pictures',
      topic: '',
      visibility: 'private',
    });
    if (!room.ok) throw new Error(room.reason);
    const sent = await sendMessage(h.db, {
      conversationId: room.room.id,
      authorId: ava.id,
      clientId: uuidv4(),
      body: '',
      attachmentIds: [attachment.id],
    });
    if (!sent.ok) throw new Error(sent.reason);

    expect((await media(sam.cookie, attachment.id)).status).toBe(404);
    expect((await media(null, attachment.id)).status).toBe(401);
    expect((await media(ava.cookie, 'not-an-id')).status).toBe(404);
    expect((await media(ava.cookie, uuidv4())).status).toBe(404);

    const response = await media(ava.cookie, attachment.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect((await sharp(bytes).metadata()).format).toBe('webp');

    // Asking again with the tag from before: checked again, answered without the file.
    const etag = response.headers.get('etag') ?? '';
    const again = await media(ava.cookie, attachment.id, { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect((await media(sam.cookie, attachment.id, { 'if-none-match': etag })).status).toBe(404);

    // A deleted message takes its picture with it, for everyone.
    await deleteMessage(h.db, { messageId: sent.message.id, actorId: ava.id });
    expect((await media(ava.cookie, attachment.id)).status).toBe(404);
    expect((await media(ava.cookie, attachment.id, { 'if-none-match': etag })).status).toBe(404);
  });

  it('serves a profile photo to anyone signed in, as a 256-pixel square without metadata', async () => {
    const ava = await person();
    const sam = await person();
    const photo = await uploaded(ava.cookie, await jpeg(900, 400), 'avatar');
    expect(photo).toMatchObject({ width: 256, height: 256 });
    const saved = await updateProfile(h.db, ava.id, {
      nickname: `photo${String(n)}`,
      bio: '',
      realName: '',
      realNameVisibility: 'nobody',
      nameDisplay: 'nickname',
      avatar: { kind: 'photo', config: { attachmentId: photo.id } },
    });
    expect(saved.ok).toBe(true);

    const response = await media(sam.cookie, photo.id);
    expect(response.status).toBe(200);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect([metadata.width, metadata.height, metadata.exif]).toEqual([256, 256, undefined]);
  });
});

describe('clean-up', () => {
  it('deletes the files and rows of removed pictures and of uploads unused for a day', async () => {
    const ava = await person();
    const stale = await uploaded(ava.cookie, await jpeg());
    const fresh = await uploaded(ava.cookie, await jpeg());
    await h.db
      .update(schema.attachment)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(schema.attachment.id, stale.id));
    const keyOf = async (id: string) =>
      (await h.db.select().from(schema.attachment).where(eq(schema.attachment.id, id)))[0]
        ?.storageKey ?? '';
    const staleKey = await keyOf(stale.id);
    const freshKey = await keyOf(fresh.id);

    expect(await collectAttachmentGarbage({ db: h.db, storage }, 1000)).toBeGreaterThanOrEqual(1);
    expect(await storage.get(staleKey)).toBeNull();
    expect(await keyOf(stale.id)).toBe('');
    expect(await storage.get(freshKey)).not.toBeNull();
  });
});

describe('storage drivers', () => {
  it('make random keys of one fixed shape and refuse any other key', async () => {
    const key = newStorageKey('message');
    expect(key).toMatch(/^m\/[0-9a-f]{32}\.webp$/);
    expect(newStorageKey('avatar')).toMatch(/^a\/[0-9a-f]{32}\.webp$/);
    expect(newStorageKey('message')).not.toBe(key);
    const memory = createMemoryStorage();
    for (const bad of [
      '../secret',
      'm/../../etc/passwd',
      'm/abc.webp',
      `x/${'0'.repeat(32)}.webp`,
    ]) {
      await expect(memory.get(bad)).rejects.toThrow('Invalid storage key');
      await expect(memory.put(bad, Buffer.from('x'), 'image/webp')).rejects.toThrow();
    }
  });

  it('vercel-blob: stores privately under our own key and never adds to or overwrites it', async () => {
    const calls: { op: string; key: string | string[]; options: Record<string, unknown> }[] = [];
    const files = new Map<string, Buffer>();
    const api: BlobApi = {
      put: (pathname, body, options) => {
        calls.push({ op: 'put', key: pathname, options });
        files.set(pathname, body);
        return Promise.resolve({});
      },
      get: (pathname, options) => {
        calls.push({ op: 'get', key: pathname, options });
        const found = files.get(pathname);
        return Promise.resolve(
          found ? { statusCode: 200, stream: new Response(new Uint8Array(found)).body } : null,
        );
      },
      del: (pathnames, options) => {
        calls.push({ op: 'del', key: pathnames, options });
        for (const pathname of pathnames) files.delete(pathname);
        return Promise.resolve();
      },
    };
    const blob = createVercelBlobStorage('test-token', api);
    const key = newStorageKey('message');
    await blob.put(key, Buffer.from('picture'), 'image/webp');
    expect(calls[0]).toEqual({
      op: 'put',
      key,
      options: {
        access: 'private',
        token: 'test-token',
        contentType: 'image/webp',
        addRandomSuffix: false,
        allowOverwrite: false,
      },
    });
    expect((await blob.get(key))?.toString()).toBe('picture');
    expect(calls[1]?.options).toEqual({ access: 'private', token: 'test-token' });
    expect(await blob.get(newStorageKey('message'))).toBeNull();
    await blob.delete([key]);
    expect(files.size).toBe(0);
    await blob.delete([]);
    expect(calls.filter((c) => c.op === 'del')).toHaveLength(1);
    await expect(blob.get('../other-store/file')).rejects.toThrow('Invalid storage key');
    await expect(blob.delete([key, 'https://evil.example/x'])).rejects.toThrow();
  });

  it('local: writes, reads and deletes inside its folder only', async () => {
    // Inside the repository's git-ignored cache folder (created here on a fresh checkout).
    const cache = resolve(process.cwd(), '..', '..', '.cache');
    await mkdir(cache, { recursive: true });
    const directory = await mkdtemp(join(cache, 'storage-'));
    try {
      const local = createLocalStorage(directory);
      const key = newStorageKey('avatar');
      expect(await local.get(key)).toBeNull();
      await local.put(key, Buffer.from('picture'), 'image/webp');
      expect((await local.get(key))?.toString()).toBe('picture');
      // A key is never written twice.
      await expect(local.put(key, Buffer.from('other'), 'image/webp')).rejects.toThrow();
      await expect(local.get('../outside.webp')).rejects.toThrow('Invalid storage key');
      await local.delete([key, newStorageKey('avatar')]);
      expect(await local.get(key)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
