/**
 * Who may connect (RT-01, RT-08, SEC-04): signed token, allowed origin, live session, active
 * account, connection caps.
 */
import { generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, schema } from '@socketspace/db';
import { createTestRoom, createTestUser } from '@socketspace/db/testing';

import { helloOf, startHarness, type Harness } from './test/harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ MAX_CONNECTIONS_PER_USER: '3', MAX_CONNECTIONS_PER_IP: '8' });
});

afterAll(async () => {
  await h.close();
});

/** The refusal code the server attached to a failed connection. */
async function refusalCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const data = (error as { data?: { code?: string } }).data;
    return data?.code ?? (error as Error).message;
  }
  throw new Error('expected the connection to be refused');
}

describe('accepted connections', () => {
  it('accepts a valid token from an allowed origin and says hello with the user ID', async () => {
    const user = await createTestUser(h.db);
    const socket = await h.connectAs(user.id);
    expect(socket.connected).toBe(true);
    expect(helloOf(socket)).toMatchObject({ protocolVersion: 1, userId: user.id });
    socket.close();
  });

  it('accepts unverified accounts too (they can read; posting is refused later)', async () => {
    const user = await createTestUser(h.db, { emailVerified: false });
    const socket = await h.connectAs(user.id);
    expect(socket.connected).toBe(true);
    socket.close();
  });
});

describe('refused connections', () => {
  it('refuses a foreign origin (the v1 cross-origin test now fails to connect)', async () => {
    const user = await createTestUser(h.db);
    const sid = await h.createSession(user.id);
    const token = await h.signToken({ sub: user.id, sid });
    const message = await refusalCode(h.connect(token, { origin: 'https://evil.example' }));
    expect(message).toMatch(/websocket error|xhr poll error|Unexpected server response: 403/i);
  });

  it('refuses a handshake with no Origin at all', async () => {
    const user = await createTestUser(h.db);
    const sid = await h.createSession(user.id);
    const token = await h.signToken({ sub: user.id, sid });
    await expect(h.connect(token, { origin: null })).rejects.toThrow();
  });

  it('refuses a missing, malformed, expired, mis-addressed or forged token', async () => {
    const user = await createTestUser(h.db);
    const sid = await h.createSession(user.id);
    expect(await refusalCode(h.connect(undefined))).toBe('UNAUTHENTICATED');
    expect(await refusalCode(h.connect('not.a.token'))).toBe('UNAUTHENTICATED');
    const expired = await h.signToken({ sub: user.id, sid, expiresIn: -60 });
    expect(await refusalCode(h.connect(expired))).toBe('UNAUTHENTICATED');
    const wrongAudience = await h.signToken({ sub: user.id, sid, aud: 'someone-else' });
    expect(await refusalCode(h.connect(wrongAudience))).toBe('UNAUTHENTICATED');
    const wrongIssuer = await h.signToken({ sub: user.id, sid, iss: 'https://evil.example' });
    expect(await refusalCode(h.connect(wrongIssuer))).toBe('UNAUTHENTICATED');
    const { privateKey: otherKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const forged = await h.signToken({ sub: user.id, sid }, otherKey);
    expect(await refusalCode(h.connect(forged))).toBe('UNAUTHENTICATED');
  });

  it('refuses a token whose session has ended (signed out before the token expired)', async () => {
    const user = await createTestUser(h.db);
    const sid = await h.createSession(user.id);
    const token = await h.signToken({ sub: user.id, sid });
    await h.db.delete(schema.session).where(eq(schema.session.id, sid));
    expect(await refusalCode(h.connect(token))).toBe('UNAUTHENTICATED');
  });

  it("refuses a token for someone else's session", async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const samSession = await h.createSession(sam.id);
    const token = await h.signToken({ sub: ava.id, sid: samSession });
    expect(await refusalCode(h.connect(token))).toBe('UNAUTHENTICATED');
  });

  it('refuses suspended and banned accounts, and active global suspensions', async () => {
    const suspended = await createTestUser(h.db, { status: 'suspended' });
    expect(await refusalCode(h.connectAs(suspended.id))).toBe('FORBIDDEN');
    const banned = await createTestUser(h.db);
    await h.db.insert(schema.userSanction).values({
      userId: banned.id,
      kind: 'ban',
      scope: 'global',
      reason: 'test',
    });
    expect(await refusalCode(h.connectAs(banned.id))).toBe('FORBIDDEN');
  });
});

describe('connection caps (RT-08)', () => {
  it('refuses a connection beyond the per-user cap, and allows one again after a disconnect', async () => {
    const user = await createTestUser(h.db);
    const sockets = [];
    for (let i = 0; i < 3; i++) sockets.push(await h.connectAs(user.id));
    expect(await refusalCode(h.connectAs(user.id))).toBe('RATE_LIMITED');

    sockets[0]?.close();
    await new Promise((done) => setTimeout(done, 100));
    const again = await h.connectAs(user.id);
    expect(again.connected).toBe(true);
    for (const s of [...sockets, again]) s.close();
  });

  it('refuses a connection beyond the per-IP cap', async () => {
    const sockets = [];
    for (let i = 0; i < 8; i++) {
      const user = await createTestUser(h.db);
      sockets.push(await h.connectAs(user.id));
    }
    const extra = await createTestUser(h.db);
    expect(await refusalCode(h.connectAs(extra.id))).toBe('RATE_LIMITED');
    for (const s of sockets) s.close();
    await new Promise((done) => setTimeout(done, 100));
  });
});

describe('rooms joined on connect', () => {
  it('joins the private user room and one room per conversation', async () => {
    const user = await createTestUser(h.db);
    const a = await createTestRoom(h.db, user.id);
    const b = await createTestRoom(h.db, user.id);
    const socket = await h.connectAs(user.id);
    const [serverSocket] = await h.server.io.in(`user:${user.id}`).fetchSockets();
    expect(serverSocket?.rooms).toEqual(
      new Set([
        serverSocket?.id,
        `user:${user.id}`,
        `session:${serverSocket?.data.sessionId ?? ''}`,
        `conv:${a.id}`,
        `conv:${b.id}`,
      ]),
    );
    socket.close();
  });
});
