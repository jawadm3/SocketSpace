/**
 * The reply shape for every acknowledged real-time event (realtime-protocol.md, "Message shapes").
 */
import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION', // payload failed the schema
  'UNAUTHENTICATED', // token missing, invalid or expired
  'FORBIDDEN', // not a member, blocked, banned, muted, wrong role
  'NOT_FOUND',
  'RATE_LIMITED', // includes retryAfterMs
  'CONTENT_BLOCKED', // word filter (high severity) or a link in random mode
  'CONFLICT', // for example editing a deleted message
  'UNAVAILABLE', // database or dependency down: safe to retry
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Codes after which the same request may succeed if simply retried later. */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set(['RATE_LIMITED', 'UNAVAILABLE']);

export interface AckError {
  code: ErrorCode;
  /** Plain-English explanation, safe to show to the person. Never contains internal details. */
  message: string;
  /** For RATE_LIMITED (and some FORBIDDEN cases such as a mute): when trying again can work. */
  retryAfterMs?: number;
}

export type Ack<T> = { ok: true; data: T } | { ok: false; error: AckError };

export function ackOk<T>(data: T): Ack<T> {
  return { ok: true, data };
}

export function ackError(code: ErrorCode, message: string, retryAfterMs?: number): Ack<never> {
  return {
    ok: false,
    error: retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs },
  };
}

export const ackErrorSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: z.string().max(500),
  retryAfterMs: z.number().int().nonnegative().optional(),
});

/** Builds the schema of an `Ack<T>` from the schema of `T` (used by tests and the client). */
export function ackSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), data }),
    z.strictObject({ ok: z.literal(false), error: ackErrorSchema }),
  ]);
}
