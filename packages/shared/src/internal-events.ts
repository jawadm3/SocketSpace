/**
 * Internal events: how the web app tells the realtime server that something changed
 * (realtime-protocol.md, "Internal events").
 *
 * `POST {REALTIME_INTERNAL_URL}/internal/events` with two headers:
 *   x-ss-timestamp: milliseconds since 1970 (UTC) when the request was signed
 *   x-ss-signature: hex HMAC-SHA256(INTERNAL_EVENTS_SECRET, timestamp + "." + body)
 * Requests older than 60 seconds, or with an event ID already seen, are refused, so a captured
 * request cannot be replayed later.
 */
import { z } from 'zod';

import { LIFTABLE_SANCTION_KINDS, MEMBER_ROLES, SANCTION_KINDS } from './domain';
import { isoDateTime, uuid } from './primitives';

export const INTERNAL_TIMESTAMP_HEADER = 'x-ss-timestamp';
export const INTERNAL_SIGNATURE_HEADER = 'x-ss-signature';
export const INTERNAL_MAX_AGE_MS = 60_000;

const base = { id: uuid, at: isoDateTime };

export const internalEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('session.revoked'),
    userId: uuid,
    sessionIds: z.array(uuid).min(1).max(100),
  }),
  /** Every session of the user ended (sign out everywhere, password reset). */
  z.strictObject({ ...base, type: z.literal('user.sessions_revoked'), userId: uuid }),
  z.strictObject({ ...base, type: z.literal('user.deleted'), userId: uuid }),
  /** Nickname or avatar changed: people who share a conversation see it at once (PROF-01). */
  z.strictObject({ ...base, type: z.literal('user.updated'), userId: uuid }),
  z.strictObject({
    ...base,
    type: z.literal('user.sanctioned'),
    userId: uuid,
    kind: z.enum(SANCTION_KINDS),
    reason: z.string().max(1000),
    until: isoDateTime.nullable(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('user.unsanctioned'),
    userId: uuid,
    kind: z.enum(LIFTABLE_SANCTION_KINDS),
  }),
  z.strictObject({
    ...base,
    type: z.literal('member.added'),
    conversationId: uuid,
    userId: uuid,
    role: z.enum(MEMBER_ROLES),
  }),
  z.strictObject({
    ...base,
    type: z.literal('member.removed'),
    conversationId: uuid,
    userId: uuid,
    /** Why: they left, a moderator removed them, or they were banned (default: left). */
    cause: z.enum(['left', 'removed', 'banned']).optional(),
    reason: z.string().max(500).optional(),
    /** For bans: when it ends (`null`: until lifted). */
    until: isoDateTime.nullable().optional(),
  }),
  /** A room mute was set (`until`) or lifted (`until: null`). */
  z.strictObject({
    ...base,
    type: z.literal('member.muted'),
    conversationId: uuid,
    userId: uuid,
    until: isoDateTime.nullable(),
    reason: z.string().max(500),
  }),
  z.strictObject({
    ...base,
    type: z.literal('member.role_changed'),
    conversationId: uuid,
    userId: uuid,
    role: z.enum(MEMBER_ROLES),
  }),
  z.strictObject({ ...base, type: z.literal('conversation.updated'), conversationId: uuid }),
  z.strictObject({ ...base, type: z.literal('conversation.deleted'), conversationId: uuid }),
  z.strictObject({
    ...base,
    type: z.literal('message.moderated'),
    conversationId: uuid,
    messageId: uuid,
  }),
  z.strictObject({ ...base, type: z.literal('block.created'), blockerId: uuid, blockedId: uuid }),
]);

export type InternalEvent = z.infer<typeof internalEventSchema>;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in time that does not depend on where they first differ. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export function signInternalRequest(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  return hmacHex(secret, `${timestamp}.${body}`);
}

export type SignatureCheck =
  { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'bad_signature' };

/** Checks the timestamp window and the signature of an incoming internal request. */
export async function verifyInternalRequest(options: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
  nowMs: number;
  maxAgeMs?: number;
}): Promise<SignatureCheck> {
  const { timestamp, signature } = options;
  if (!timestamp || !signature || !/^\d{1,16}$/.test(timestamp)) {
    return { ok: false, reason: 'missing' };
  }
  const age = options.nowMs - Number(timestamp);
  const maxAge = options.maxAgeMs ?? INTERNAL_MAX_AGE_MS;
  // A small allowance for clocks that run slightly ahead of ours.
  if (age > maxAge || age < -5_000) return { ok: false, reason: 'stale' };
  const expected = await hmacHex(options.secret, `${timestamp}.${options.body}`);
  return constantTimeEqual(expected, signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}
