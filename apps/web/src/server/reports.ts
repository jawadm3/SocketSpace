/**
 * Filing a report from the app (SAFE-01): the payload is checked against the shared contract, the
 * reporter's hourly limit is counted, and the database stores the report with its own snapshot of
 * what was reported (packages/db `createReport`). Nothing the reporter typed is logged.
 */
import 'server-only';

import { createReport, hitRateLimit, type Database, type ReportTargetInput } from '@socketspace/db';
import { LIMITS } from '@socketspace/shared/limits';
import { reportCreateSchema, type ReportCreate } from '@socketspace/shared/reports';

export type FileReportResult =
  | {
      ok: true;
      /** The same thing was already reported by this person and is still open. */ duplicate: boolean;
    }
  | {
      ok: false;
      code: 'VALIDATION' | 'RATE_LIMITED' | 'NOT_FOUND' | 'FORBIDDEN';
      /** Plain words, safe to show to the person. */
      message: string;
      retryAfterMs?: number;
    };

function targetOf(input: ReportCreate): ReportTargetInput {
  switch (input.targetType) {
    case 'message':
      return { type: 'message', messageId: input.messageId };
    case 'user':
      return {
        type: 'user',
        userId: input.userId,
        aspect: input.aspect,
        conversationId: input.conversationId,
      };
    case 'room':
      return { type: 'room', conversationId: input.conversationId };
  }
}

export async function fileReport(
  db: Database,
  reporterId: string,
  input: unknown,
): Promise<FileReportResult> {
  const parsed = reportCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: parsed.error.issues[0]?.message ?? 'That report is not complete.',
    };
  }
  // Every attempt counts, also for things that turn out not to exist, so reports cannot be used
  // to test which IDs are real.
  const rate = await hitRateLimit(db, `report:${reporterId}`, LIMITS.report.perHour, 3600);
  if (!rate.allowed) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `You can send ${String(LIMITS.report.perHour)} reports an hour. Please try again later.`,
      retryAfterMs: rate.retryAfterMs,
    };
  }
  const result = await createReport(db, {
    reporterId,
    target: targetOf(parsed.data),
    reason: parsed.data.reason,
    details: parsed.data.details,
  });
  if (result.ok) return { ok: true, duplicate: result.duplicate };
  switch (result.reason) {
    case 'not_found':
      return { ok: false, code: 'NOT_FOUND', message: 'That is no longer there to report.' };
    case 'self':
      return { ok: false, code: 'VALIDATION', message: 'You cannot report yourself.' };
    case 'reporter_inactive':
      return { ok: false, code: 'FORBIDDEN', message: 'This account cannot send reports.' };
  }
}
