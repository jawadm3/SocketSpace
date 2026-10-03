/**
 * GET /api/messages/<id>/previews (MSG-08, SEC-07): the server decides what to fetch from the
 * message's own text, answers from the cache, never fetches for someone who may not read the
 * message, and (with the real fetcher) fetches nothing from private addresses.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimLinkPreviewFetch,
  deleteMessage,
  eq,
  roomCreate,
  schema,
  sendMessage,
  sql,
} from '@socketspace/db';
import { LIMITS } from '@socketspace/shared/limits';
import type { LinkPreviewsResponse } from '@socketspace/shared/media';

import { cookieHeader, createAuthHarness, type AuthHarness } from '../../test/auth-harness';
import { hashLink, loadLinkPreviews, normalizeLink, type PreviewLookup } from './previews';

let h: AuthHarness;
let server: Server;
let port: number;
let hits: string[] = [];
let n = 0;

beforeAll(async () => {
  h = await createAuthHarness();
  server = createServer((request, response) => {
    hits.push(`${request.headers.host ?? ''}${request.url ?? ''}`);
    if (request.url === '/to-private') {
      response.writeHead(302, { location: 'http://10.0.0.1/admin' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>Local page</title><meta name="description" content="Served by the test">');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await h.close();
});

async function person() {
  n += 1;
  const email = `preview${String(n)}@example.test`;
  const result = await h.call('/sign-up/email', {
    body: { email, password: 'correct horse battery staple', name: '' },
  });
  const [row] = await h.db.select().from(schema.user).where(eq(schema.user.email, email));
  if (!row) throw new Error('no user');
  await h.db
    .update(schema.user)
    .set({
      nickname: `previewer${String(n)}`,
      avatarKind: 'preset',
      onboardedAt: new Date(),
      emailVerified: true,
    })
    .where(eq(schema.user.id, row.id));
  return { id: row.id, cookie: cookieHeader(result.cookies) };
}

async function messageIn(visibility: 'public' | 'private', authorId: string, body: string) {
  const room = await roomCreate(h.db, authorId, {
    slug: `links-${uuidv4().slice(0, 8)}`,
    name: 'Links',
    topic: '',
    visibility,
  });
  if (!room.ok) throw new Error(room.reason);
  const sent = await sendMessage(h.db, {
    conversationId: room.room.id,
    authorId,
    clientId: uuidv4(),
    body,
  });
  if (!sent.ok) throw new Error(sent.reason);
  return sent.message.id;
}

/** A stand-in fetcher that records what it was asked for. */
function recorder(answer: (url: string) => PreviewLookup = () => ({ status: 'error' })) {
  const asked: string[] = [];
  return {
    asked,
    lookup: (url: string) => {
      asked.push(url);
      return Promise.resolve(answer(url));
    },
  };
}

const ok = (title: string): PreviewLookup => ({
  status: 'ok',
  preview: { title, description: null, siteName: 'example.com' },
});

async function previews(
  cookie: string | null,
  messageId: string,
  deps: Partial<Parameters<typeof loadLinkPreviews>[2]> = {},
) {
  const response = await loadLinkPreviews(
    new Request(`http://localhost:3000/api/messages/${messageId}/previews`, {
      headers: cookie ? { cookie } : {},
    }),
    messageId,
    { auth: h.auth, db: h.db, enabled: true, ...deps },
  );
  return {
    response,
    body: (response.status === 200 ? await response.json() : null) as LinkPreviewsResponse | null,
  };
}

describe('GET /api/messages/[id]/previews', () => {
  it("fetches the message's first three links (not those in code), once, then answers from the cache", async () => {
    const ava = await person();
    const id = await messageIn(
      'public',
      ava.id,
      'see https://example.com/a#part and [this](https://example.com/b) not `https://example.com/code` ' +
        'then https://example.com/c https://example.com/d',
    );
    const fetcher = recorder((url) => ok(`Title of ${new URL(url).pathname}`));

    const first = await previews(ava.cookie, id, fetcher);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(first.body?.previews.map((p) => p.title)).toEqual([
      'Title of /a',
      'Title of /b',
      'Title of /c',
    ]);
    // The fragment is not part of what is fetched.
    expect([...fetcher.asked].sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);

    const second = await previews(ava.cookie, id, fetcher);
    expect(second.body?.previews).toEqual(first.body?.previews);
    expect(fetcher.asked).toHaveLength(3);

    // Another message with the same link uses the same cache entry.
    const other = await messageIn('public', ava.id, 'again https://example.com/a');
    expect((await previews(ava.cookie, other, fetcher)).body?.previews).toHaveLength(1);
    expect(fetcher.asked).toHaveLength(3);
  });

  it('remembers refusals and failures too, and tries a failure again after an hour', async () => {
    const ava = await person();
    const blockedId = await messageIn('public', ava.id, 'http://blocked.example/x');
    const failingId = await messageIn('public', ava.id, 'http://failing.example/x');
    const fetcher = recorder((url) =>
      url.includes('blocked') ? { status: 'blocked' } : { status: 'error' },
    );

    for (const id of [blockedId, failingId, blockedId, failingId]) {
      expect((await previews(ava.cookie, id, fetcher)).body?.previews).toEqual([]);
    }
    expect(fetcher.asked).toHaveLength(2);

    const rows = await h.db
      .select({
        status: schema.linkPreview.status,
        hours: sql<number>`round(extract(epoch from (expires_at - fetched_at)) / 3600)::int`,
      })
      .from(schema.linkPreview)
      .where(sql`${schema.linkPreview.url} like 'http://%.example/x'`);
    expect(rows).toEqual(
      expect.arrayContaining([
        { status: 'blocked', hours: LIMITS.linkPreview.ttlSeconds / 3600 },
        { status: 'error', hours: 1 },
      ]),
    );

    await h.db
      .update(schema.linkPreview)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(schema.linkPreview.urlHash, hashLink('http://failing.example/x')));
    await previews(ava.cookie, failingId, fetcher);
    expect(fetcher.asked).toHaveLength(3);
  });

  it('fetches nothing for someone who may not read the message, or for a deleted one', async () => {
    const ava = await person();
    const lee = await person();
    const id = await messageIn('private', ava.id, 'secret https://example.com/private-room');
    const fetcher = recorder(() => ok('Should not be fetched'));

    expect((await previews(null, id, fetcher)).response.status).toBe(401);
    expect((await previews(lee.cookie, id, fetcher)).response.status).toBe(404);
    expect((await previews(lee.cookie, uuidv4(), fetcher)).response.status).toBe(404);
    expect((await previews(lee.cookie, 'not-an-id', fetcher)).response.status).toBe(404);
    await deleteMessage(h.db, { messageId: id, actorId: ava.id });
    expect((await previews(ava.cookie, id, fetcher)).response.status).toBe(404);
    expect(fetcher.asked).toEqual([]);
  });

  it('fetches a new link once however many people open the message at the same moment', async () => {
    const ava = await person();
    const readers = [ava, await person(), await person(), await person()];
    const id = await messageIn('public', ava.id, 'everyone look https://example.com/popular');
    const asked: string[] = [];
    let release: (answer: PreviewLookup) => void = () => undefined;
    const slow = {
      lookup: (url: string) => {
        asked.push(url);
        return new Promise<PreviewLookup>((resolve) => {
          release = resolve;
        });
      },
    };

    // The page is still being fetched while everyone else's request is answered.
    let answered = 0;
    const all = readers.map((reader) =>
      previews(reader.cookie, id, slow).then((result) => {
        answered += 1;
        return result;
      }),
    );
    await expect.poll(() => answered, { timeout: 10_000 }).toBe(readers.length - 1);
    expect(asked).toHaveLength(1);
    release(ok('Popular page'));
    const answers = await Promise.all(all);

    expect(asked).toEqual(['https://example.com/popular']);
    const winners = answers.filter((a) => a.body?.previews.length === 1);
    const told = answers.filter((a) => a.body?.pending === true);
    expect(winners).toHaveLength(1);
    expect(told).toHaveLength(readers.length - 1);
    for (const waiting of told) {
      expect(waiting.body?.previews).toEqual([]);
      expect(waiting.response.headers.get('cache-control')).toBe('no-store');
    }
    // Asking again a moment later: answered from the cache, still one fetch.
    const later = await previews(readers[1]?.cookie ?? null, id, slow);
    expect(later.body).toEqual({
      previews: [
        {
          url: 'https://example.com/popular',
          title: 'Popular page',
          description: null,
          siteName: 'example.com',
        },
      ],
    });
    expect(asked).toHaveLength(1);
  });

  it('lets someone else fetch when a claimed fetch never finished', async () => {
    const ava = await person();
    const id = await messageIn('public', ava.id, 'https://example.com/abandoned');
    const hash = hashLink('https://example.com/abandoned');
    const fetcher = recorder(() => ok('Recovered'));

    // A claim left behind by a request that died.
    expect(await claimLinkPreviewFetch(h.db, hash, 'https://example.com/abandoned')).toBe(true);
    expect(await claimLinkPreviewFetch(h.db, hash, 'https://example.com/abandoned')).toBe(false);
    expect((await previews(ava.cookie, id, fetcher)).body).toEqual({ previews: [], pending: true });
    expect(fetcher.asked).toEqual([]);

    // The claim runs out after a few seconds.
    await h.db
      .update(schema.linkPreview)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(schema.linkPreview.urlHash, hash));
    expect((await previews(ava.cookie, id, fetcher)).body?.previews[0]?.title).toBe('Recovered');
    expect(fetcher.asked).toHaveLength(1);
  });

  it('limits how many fetches one person can cause, and can be switched off', async () => {
    const ava = await person();
    const fetcher = recorder((url) => ok(url));
    await h.db.insert(schema.httpRateLimit).values({
      key: `preview-fetch:${ava.id}`,
      windowStart: sql`to_timestamp(floor(extract(epoch from now()) / 60) * 60)`,
      count: LIMITS.linkPreview.fetchesPerMinute,
    });
    const id = await messageIn('public', ava.id, 'https://example.com/over-the-limit');
    const limited = await previews(ava.cookie, id, fetcher);
    expect(limited.body?.previews).toEqual([]);
    // Not complete, so the browser must not keep this answer.
    expect(limited.response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher.asked).toEqual([]);

    const sam = await person();
    const off = await previews(sam.cookie, id, { ...fetcher, enabled: false });
    expect(off.body?.previews).toEqual([]);
    expect(fetcher.asked).toEqual([]);
  });

  it('with the real fetcher: no request goes to the metadata address, localhost, or a private redirect target (J9)', async () => {
    const ava = await person();
    hits = [];
    const hostile = await messageIn(
      'public',
      ava.id,
      `http://169.254.169.254/latest/meta-data/ http://localhost:${String(port)}/ http://127.0.0.1:${String(port)}/x`,
    );
    expect((await previews(ava.cookie, hostile)).body?.previews).toEqual([]);

    // "public.test" stands for a public site; it is reached at the test server.
    const fetchOptions = { devHosts: new Map([['public.test', { host: '127.0.0.1', port }]]) };
    const redirecting = await messageIn('public', ava.id, 'http://public.test/to-private');
    expect((await previews(ava.cookie, redirecting, { fetchOptions })).body?.previews).toEqual([]);
    expect(hits).toEqual(['public.test/to-private']);

    const fine = await messageIn('public', ava.id, 'http://public.test/page');
    expect((await previews(ava.cookie, fine, { fetchOptions })).body?.previews).toEqual([
      {
        url: 'http://public.test/page',
        title: 'Local page',
        description: 'Served by the test',
        siteName: 'public.test',
      },
    ]);

    const statuses = await h.db
      .select({ url: schema.linkPreview.url, status: schema.linkPreview.status })
      .from(schema.linkPreview)
      .where(
        sql`${schema.linkPreview.url} like 'http://169.254%' or ${schema.linkPreview.url} like 'http://localhost%' or ${schema.linkPreview.url} like 'http://127.%' or ${schema.linkPreview.url} like 'http://public.test/to-private'`,
      );
    expect(statuses.map((s) => s.status)).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
  });

  it('normalises links for the cache', () => {
    expect(normalizeLink('https://Example.com/a#x')).toBe('https://example.com/a');
    expect(normalizeLink('nonsense')).toBeNull();
    expect(hashLink('https://example.com/a')).toMatch(/^[0-9a-f]{64}$/);
  });
});
