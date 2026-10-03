'use client';

/**
 * Privacy (DM-01, DM-02, SAFE-01): who may start a direct message with you, whether you share read
 * receipts, and the people you blocked.
 */
import { useActionState } from 'react';

import type { DmPolicy } from '@socketspace/shared/domain';
import type { PublicUser } from '@socketspace/shared/profile';

import { Button, buttonClasses } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';

import { savePrivacyAction, unblockUserAction, type SocialActionState } from '../../social-actions';

const POLICIES: { value: DmPolicy; label: string; help: string }[] = [
  { value: 'everyone', label: 'Anyone can message me', help: 'Anyone with an account.' },
  { value: 'contacts', label: 'Only my contacts', help: 'People in your contacts list.' },
  {
    value: 'nobody',
    label: 'No new conversations',
    help: 'Nobody can start one; existing conversations stay open.',
  },
];

export function PrivacyForm({
  dmPolicy,
  readReceipts,
}: {
  dmPolicy: DmPolicy;
  readReceipts: boolean;
}) {
  const [state, action, pending] = useActionState<SocialActionState, FormData>(
    savePrivacyAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">Privacy</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Who can send you direct messages</legend>
        {POLICIES.map((p) => (
          <label key={p.value} className="flex items-start gap-3">
            <input
              type="radio"
              name="dmPolicy"
              value={p.value}
              defaultChecked={p.value === dmPolicy}
              className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
            />
            <span>
              <span className="font-medium">{p.label}</span>
              <span className="block text-sm text-ink-2">{p.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="readReceipts"
          defaultChecked={readReceipts}
          className="mt-1 h-5 w-5 accent-[var(--color-accent)]"
        />
        <span>
          <span className="font-semibold">Read receipts</span>
          <span className="block text-sm text-ink-2">
            Show &quot;Delivered&quot; and &quot;Seen&quot; in direct messages. When this is off,
            you do not see them for others either.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save privacy settings'}
        </Button>
        <p role="status" className="text-sm text-ink-2">
          {state.message ?? ''}
        </p>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function UnblockButton({ person }: { person: PublicUser }) {
  const [, action, pending] = useActionState<SocialActionState, FormData>(unblockUserAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={person.id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Unblock ${person.nickname}`}
        className={buttonClasses('secondary', 'min-h-9 px-3')}
      >
        {pending ? 'Unblocking…' : 'Unblock'}
      </button>
    </form>
  );
}

export function BlockedList({ people }: { people: PublicUser[] }) {
  return (
    <section aria-labelledby="blocked-title" className="flex flex-col gap-3">
      <h2 id="blocked-title" className="text-lg font-bold">
        Blocked people
      </h2>
      {people.length === 0 ? (
        <p className="text-sm text-ink-2">
          Nobody. People you block cannot message you, their mentions do not notify you, and their
          room messages are folded away.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3">
              <UserAvatar user={person} size="sm" />
              <span className="flex-1 truncate">{person.nickname}</span>
              <UnblockButton person={person} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
