import { describe, expect, it } from 'vitest';

import { internalEventSchema, signInternalRequest, verifyInternalRequest } from './internal-events';

// A test-only value; real secrets live only in environment variables.
const SECRET = 'test-only-internal-events-secret-not-real';
const NOW = 1_790_000_000_000;

async function signed(body: string, timestamp = String(NOW)) {
  return { timestamp, signature: await signInternalRequest(SECRET, timestamp, body), body };
}

describe('internal request signatures', () => {
  it('accept a fresh, correctly signed request', async () => {
    const request = await signed('{"a":1}');
    expect(await verifyInternalRequest({ secret: SECRET, nowMs: NOW + 1000, ...request })).toEqual({
      ok: true,
    });
  });

  it('produce a 64-character hex HMAC-SHA256', async () => {
    const { signature } = await signed('x');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuse a changed body, a changed timestamp or the wrong secret', async () => {
    const request = await signed('{"a":1}');
    const check = (overrides: object) =>
      verifyInternalRequest({ secret: SECRET, nowMs: NOW, ...request, ...overrides });
    expect(await check({ body: '{"a":2}' })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await check({ timestamp: String(NOW - 1) })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(await check({ secret: `${SECRET}x` })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuse requests older than 60 seconds or from the future (replay window)', async () => {
    const request = await signed('{}');
    expect(
      await verifyInternalRequest({ secret: SECRET, nowMs: NOW + 60_001, ...request }),
    ).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(
      await verifyInternalRequest({ secret: SECRET, nowMs: NOW - 10_000, ...request }),
    ).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('refuse missing or malformed headers', async () => {
    const base = { secret: SECRET, nowMs: NOW, body: '{}' };
    expect(await verifyInternalRequest({ ...base, timestamp: undefined, signature: 'x' })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(await verifyInternalRequest({ ...base, timestamp: '12e3', signature: 'x' })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(
      await verifyInternalRequest({ ...base, timestamp: String(NOW), signature: undefined }),
    ).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('internalEventSchema', () => {
  it('accepts a session revocation and refuses unknown types and fields', () => {
    const event = {
      id: '0192a5f0-0000-7000-8000-000000000001',
      at: '2026-10-02T09:30:00.000Z',
      type: 'session.revoked',
      userId: '0192a5f0-0000-7000-8000-000000000002',
      sessionIds: ['0192a5f0-0000-7000-8000-000000000003'],
    };
    expect(internalEventSchema.safeParse(event).success).toBe(true);
    expect(internalEventSchema.safeParse({ ...event, type: 'user.promoted' }).success).toBe(false);
    expect(internalEventSchema.safeParse({ ...event, extra: 1 }).success).toBe(false);
    expect(internalEventSchema.safeParse({ ...event, sessionIds: [] }).success).toBe(false);
  });
});
