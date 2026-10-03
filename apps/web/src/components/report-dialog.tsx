'use client';

/**
 * The "Report" dialog (SAFE-01, PROF-08): the same form for a message, a person or a room. The
 * reporter picks a reason and may add a few words; the server keeps its own copy of what is
 * reported, so there is nothing to paste or screenshot.
 *
 * A native modal `<dialog>`: focus stays inside while it is open, Esc closes it, and focus goes
 * back to the button that opened it.
 */
import { Flag } from 'lucide-react';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { REPORT_REASONS } from '@socketspace/shared/domain';
import { LIMITS } from '@socketspace/shared/limits';
import {
  REPORT_ASPECT_LABELS,
  REPORT_ASPECTS,
  REPORT_REASON_LABELS,
} from '@socketspace/shared/reports';
import { codePointLength } from '@socketspace/shared/text';

import { submitReportAction, type ReportActionState } from '@/app/(app)/app/report-actions';

import { Alert, Button } from './ui';

export type ReportTarget =
  | { type: 'message'; messageId: string; authorName: string }
  | { type: 'user'; userId: string; name: string; conversationId?: string }
  | { type: 'room'; conversationId: string; name: string };

function titleOf(target: ReportTarget): string {
  switch (target.type) {
    case 'message':
      return `Report a message from ${target.authorName}`;
    case 'user':
      return `Report ${target.name}`;
    case 'room':
      return `Report the room ${target.name}`;
  }
}

function Choices({
  legend,
  name,
  options,
}: {
  legend: string;
  name: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-ink">{legend}</legend>
      {/* Two columns where there is room, so the whole form fits on a laptop screen. */}
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {options.map(([value, label], index) => (
          <label key={value} className="flex min-h-9 items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name={name}
              value={value}
              required
              defaultChecked={name === 'aspect' && index === 0}
              className="h-4 w-4 shrink-0 accent-accent"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ReportDialog({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const detailsId = useId();
  const [state, action, pending] = useActionState<ReportActionState, FormData>(
    submitReportAction,
    {},
  );
  const [details, setDetails] = useState('');
  const length = codePointLength(details);
  const tooLong = length > LIMITS.report.detailsMax;

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-line bg-card p-0 text-ink shadow-lg backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="flex items-center gap-2 text-lg font-extrabold">
          <Flag aria-hidden="true" className="h-5 w-5 text-danger" />
          {titleOf(target)}
        </h2>
        {state.done ? (
          <>
            <Alert tone="success">
              Thank you. A moderator will look at it. You will not be told what they decide about
              someone else, but your report is kept with a copy of what you reported.
            </Alert>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  dialog.current?.close();
                }}
              >
                Close
              </Button>
            </div>
          </>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="targetType" value={target.type} />
            {target.type === 'message' ? (
              <input type="hidden" name="messageId" value={target.messageId} />
            ) : null}
            {target.type === 'user' ? (
              <input type="hidden" name="userId" value={target.userId} />
            ) : null}
            {target.type !== 'message' && target.conversationId ? (
              <input type="hidden" name="conversationId" value={target.conversationId} />
            ) : null}
            {target.type === 'user' ? (
              <Choices
                legend="What is this about?"
                name="aspect"
                options={REPORT_ASPECTS.map((aspect) => [aspect, REPORT_ASPECT_LABELS[aspect]])}
              />
            ) : null}
            <Choices
              legend="What is wrong?"
              name="reason"
              options={REPORT_REASONS.map((reason) => [reason, REPORT_REASON_LABELS[reason]])}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={detailsId} className="text-sm font-semibold text-ink">
                Anything a moderator should know? (optional)
              </label>
              <textarea
                id={detailsId}
                name="details"
                rows={3}
                value={details}
                onChange={(event) => {
                  setDetails(event.target.value);
                }}
                aria-invalid={tooLong ? true : undefined}
                aria-describedby={`${detailsId}-hint`}
                className="rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink aria-invalid:border-danger"
              />
              <p id={`${detailsId}-hint`} className="text-sm text-muted">
                {target.type === 'message'
                  ? 'We keep a copy of the message and the few messages around it.'
                  : target.type === 'user'
                    ? 'We keep a copy of their profile as you see it now.'
                    : 'We keep a copy of the room’s name and topic.'}{' '}
                {length > LIMITS.report.detailsMax - 200
                  ? `${String(length)} / ${String(LIMITS.report.detailsMax)}`
                  : ''}
              </p>
            </div>
            {state.error ? <Alert tone="error">{state.error}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  dialog.current?.close();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={pending || tooLong}>
                {pending ? 'Sending…' : 'Send report'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
