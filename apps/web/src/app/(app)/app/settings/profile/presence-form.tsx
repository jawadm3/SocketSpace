'use client';

/**
 * Invisible mode (PROF-02): one switch that saves as soon as it changes. Off means everyone sees
 * you as offline; you can still chat as usual.
 */
import { useActionState, useRef } from 'react';

import { setPresenceVisibilityAction, type PresenceVisibilityState } from './actions';

export function PresenceForm({ showPresence }: { showPresence: boolean }) {
  const [state, action, pending] = useActionState<PresenceVisibilityState, FormData>(
    setPresenceVisibilityAction,
    {},
  );
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">Online status</h2>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          name="showPresence"
          defaultChecked={showPresence}
          disabled={pending}
          aria-describedby="presence-help"
          onChange={() => {
            form.current?.requestSubmit();
          }}
          className="mt-1 h-5 w-5 accent-[var(--color-accent)]"
        />
        <span>
          <span className="font-semibold">Show when I&apos;m online</span>
          <span id="presence-help" className="block text-sm text-ink-2">
            When this is off, everyone sees you as offline. You can still read and chat as usual.
          </span>
        </span>
      </label>
      <p role="status" className="min-h-5 text-sm text-ink-2">
        {pending ? 'Saving…' : (state.message ?? '')}
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
