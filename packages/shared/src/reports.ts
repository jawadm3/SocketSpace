/**
 * Reports (SAFE-01, security.md 4.1): what a person sends when they report a message, a person
 * or a room. The server adds the evidence itself (a snapshot of what was reported), so nothing a
 * reporter types can pretend to be what someone else wrote.
 *
 * Reports of a random chat travel over the realtime connection instead (`random:report`).
 */
import { z } from 'zod';

import { REPORT_REASONS, type ReportReason } from './domain';
import { LIMITS } from './limits';
import { uuid } from './primitives';
import { codePointLength, normalizeText } from './text';

/** What about a person is being reported (PROF-08: profile pictures can be reported). */
export const REPORT_ASPECTS = ['behaviour', 'profile_picture', 'profile_text'] as const;
export type ReportAspect = (typeof REPORT_ASPECTS)[number];

/** Optional free text from the reporter: normalised, at most 1,000 code points. */
export const reportDetails = z
  .string()
  .max(LIMITS.report.detailsMax * 2, 'That is too long')
  .transform((value) => normalizeText(value).trim())
  .refine(
    (value) => codePointLength(value) <= LIMITS.report.detailsMax,
    `Please keep it under ${String(LIMITS.report.detailsMax)} characters`,
  );

const common = { reason: z.enum(REPORT_REASONS), details: reportDetails };

export const reportCreateSchema = z.discriminatedUnion('targetType', [
  z.strictObject({ ...common, targetType: z.literal('message'), messageId: uuid }),
  z.strictObject({
    ...common,
    targetType: z.literal('user'),
    userId: uuid,
    aspect: z.enum(REPORT_ASPECTS),
    /** Where the reporter was when they reported the person, if anywhere. */
    conversationId: uuid.optional(),
  }),
  z.strictObject({ ...common, targetType: z.literal('room'), conversationId: uuid }),
]);

export type ReportCreate = z.infer<typeof reportCreateSchema>;

/** The reasons as people read them, in the order they are offered. */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam or advertising',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  sexual: 'Sexual content',
  self_harm: 'Self-harm or suicide',
  violence: 'Violence or threats',
  illegal: 'Something illegal',
  underage: 'Someone who seems under 18',
  other: 'Something else',
};

export const REPORT_ASPECT_LABELS: Record<ReportAspect, string> = {
  behaviour: 'How they behave',
  profile_picture: 'Their profile picture',
  profile_text: 'Their name or bio',
};
