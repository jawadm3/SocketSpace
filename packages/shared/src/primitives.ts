/**
 * Small reusable schemas for payload fields.
 */
import { z } from 'zod';

import { LIMITS } from './limits';
import { codePointLength, normalizeText } from './text';

/** Any UUID (IDs are v7, client IDs may be v4 from `crypto.randomUUID()`). */
export const uuid = z.uuid();

/** A timestamp as sent over the wire: ISO 8601 in UTC, for example `2026-10-02T09:30:00.000Z`. */
export const isoDateTime = z.iso.datetime();

/** A non-negative whole number (sequence numbers, counts). */
export const seqNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * The text of a community message: normalised, trimmed, at most 4,000 code points (the same limit
 * as the database check). `messageBody` must also not be empty; `messageBodyOrEmpty` is for a
 * message that may consist of pictures only.
 */
export const messageBodyOrEmpty = z
  .string()
  // Cheap guard before any work: 4,000 code points can never need more than 8,000 UTF-16 units.
  .max(LIMITS.message.bodyMaxChars * 2, 'Message is too long')
  .transform((value) => normalizeText(value).trim())
  .refine(
    (value) => codePointLength(value) <= LIMITS.message.bodyMaxChars,
    `Message is longer than ${String(LIMITS.message.bodyMaxChars)} characters`,
  );

export const messageBody = messageBodyOrEmpty.refine(
  (value) => value.length > 0,
  'Message is empty',
);
