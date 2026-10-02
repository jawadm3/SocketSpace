/**
 * Random-match events (realtime-protocol.md, "Events: random-match mode"). Text only.
 * The link and contact-detail filter runs on the server after this schema (Stage E), because it
 * needs the same normalisation as the word-list filter.
 */
import { z } from 'zod';

import { RANDOM_END_REASONS, REPORT_REASONS } from '../domain';
import { LIMITS } from '../limits';
import { isoDateTime, uuid } from '../primitives';
import { avatarWireSchema } from '../profile';
import { codePointLength, normalizeSingleLine, normalizeText } from '../text';

const interest = z
  .string()
  .max(LIMITS.random.interestMaxChars * 4)
  .transform((value) => normalizeSingleLine(value).toLowerCase())
  .refine(
    (value) =>
      codePointLength(value) >= LIMITS.random.interestMinChars &&
      codePointLength(value) <= LIMITS.random.interestMaxChars,
    'Each interest must be 2 to 24 characters',
  );

export const randomTextSchema = z
  .string()
  .max(LIMITS.random.textMaxChars * 2)
  .transform((value) => normalizeText(value).trim())
  .refine((value) => value.length > 0, 'Message is empty')
  .refine(
    (value) => codePointLength(value) <= LIMITS.random.textMaxChars,
    `Message is longer than ${String(LIMITS.random.textMaxChars)} characters`,
  );

export const RANDOM_OFFERS = ['share_profile', 'add_contact'] as const;

// Client → server
export const randomJoinSchema = z.strictObject({
  interests: z
    .array(interest)
    .max(LIMITS.random.interestsMax)
    .transform((list) => [...new Set(list)]),
});
export const randomLeaveSchema = z.strictObject({});
export const randomMessageSchema = z.strictObject({
  sessionId: uuid,
  clientId: uuid,
  text: randomTextSchema,
});
export const randomTypingSchema = z.strictObject({ sessionId: uuid, typing: z.boolean() });
export const randomSessionSchema = z.strictObject({ sessionId: uuid });
export const randomReportSchema = z.strictObject({
  sessionId: uuid,
  reason: z.enum(REPORT_REASONS),
  details: z
    .string()
    .max(LIMITS.report.detailsMax * 2)
    .transform((value) => normalizeText(value).trim())
    .refine((value) => codePointLength(value) <= LIMITS.report.detailsMax, 'Details are too long')
    .optional(),
});
export const randomOfferSchema = z.strictObject({ sessionId: uuid, offer: z.enum(RANDOM_OFFERS) });

// Acknowledgement data
export const randomQueuedAckSchema = z.strictObject({ queued: z.literal(true) });
export const randomMessageAckSchema = z.strictObject({ clientId: uuid });
export const randomReportAckSchema = z.strictObject({ reportId: uuid });

// Server → client
export const randomWaitingSchema = z.strictObject({ since: isoDateTime });
export const randomMatchedSchema = z.strictObject({
  sessionId: uuid,
  partner: z.strictObject({ alias: z.literal('Stranger'), sharedInterests: z.array(z.string()) }),
});
export const randomMessageEventSchema = z.strictObject({
  sessionId: uuid,
  clientId: uuid,
  text: z.string(),
  from: z.enum(['me', 'them']),
  at: isoDateTime,
});
export const randomTypingEventSchema = z.strictObject({ sessionId: uuid, typing: z.boolean() });
export const randomOfferedSchema = z.strictObject({
  sessionId: uuid,
  offer: z.enum(RANDOM_OFFERS),
});
export const randomSharedSchema = z.strictObject({
  sessionId: uuid,
  profile: z.strictObject({
    id: uuid,
    nickname: z.string(),
    avatar: avatarWireSchema.nullable(),
  }),
});
export const randomContactAddedSchema = z.strictObject({ sessionId: uuid });
export const randomEndedSchema = z.strictObject({
  sessionId: uuid,
  reason: z.enum(RANDOM_END_REASONS),
});
export const randomSuggestionSchema = z.strictObject({
  rooms: z
    .array(
      z.strictObject({ id: uuid, slug: z.string(), name: z.string(), memberCount: z.number() }),
    )
    .max(5),
});
