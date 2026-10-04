'use server';

/**
 * The server action behind every "Report" button (SAFE-01): messages, people (including their
 * profile picture, PROF-08) and rooms. The form names what is reported and why; the server takes
 * its own snapshot of it as evidence (apps/web/src/server/reports.ts).
 */
import { redirect } from 'next/navigation';

import { formText } from '@/lib/forms';
import { getDb } from '@/server/db';
import { fileReport } from '@/server/reports';
import { getCurrentSession } from '@/server/session';

export interface ReportActionState {
  /** Set when the report was stored. */
  done?: boolean;
  error?: string;
}

export async function submitReportAction(
  _previous: ReportActionState,
  form: FormData,
): Promise<ReportActionState> {
  const current = await getCurrentSession();
  if (!current) redirect('/sign-in');
  if (current.user.isAnonymous) redirect('/sign-in?guest=1');
  if (!current.user.onboardedAt) redirect('/onboarding');

  const targetType = formText(form, 'targetType');
  const common = { reason: formText(form, 'reason'), details: formText(form, 'details') };
  const conversationId = formText(form, 'conversationId');
  // Only the fields that belong to this kind of report are passed on; the shared contract
  // refuses anything else.
  const input =
    targetType === 'message'
      ? { ...common, targetType, messageId: formText(form, 'messageId') }
      : targetType === 'user'
        ? {
            ...common,
            targetType,
            userId: formText(form, 'userId'),
            aspect: formText(form, 'aspect'),
            ...(conversationId ? { conversationId } : {}),
          }
        : { ...common, targetType, conversationId };

  const result = await fileReport(getDb(), current.user.id, input);
  return result.ok ? { done: true } : { error: result.message };
}
