'use client';

import { useActionState, useState } from 'react';

import { LIMITS } from '@socketspace/shared/limits';

import { Alert, Button, TextField } from '@/components/ui';
import type { PresetAvatar } from '@/server/avatar';

import { completeOnboardingAction, type OnboardingState } from './actions';

export function OnboardingForm({ presets }: { presets: PresetAvatar[] }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    completeOnboardingAction,
    {},
  );
  const [nickname, setNickname] = useState(state.nickname ?? '');

  return (
    <form action={action} className="mt-6 flex flex-col gap-6" noValidate>
      {state.errors?.form ? <Alert tone="error">{state.errors.form}</Alert> : null}

      <div className="flex flex-col gap-3">
        <TextField
          id="nickname"
          name="nickname"
          label="Nickname"
          autoComplete="nickname"
          required
          minLength={LIMITS.profile.nicknameMin}
          maxLength={LIMITS.profile.nicknameMax}
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value);
          }}
          hint="3 to 24 letters, numbers, dots, dashes or underscores. Unique on SocketSpace."
          error={state.errors?.nickname}
        />
        {state.suggestions && state.suggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Free right now:</span>
            {state.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="rounded-full border border-line bg-surface-2 px-3 py-1 font-semibold text-ink hover:bg-accent-soft"
                onClick={() => {
                  setNickname(suggestion);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <fieldset aria-describedby={state.errors?.avatar ? 'avatar-error' : undefined}>
        <legend className="text-sm font-semibold text-ink">Profile picture</legend>
        <p className="mt-1 text-sm text-muted">
          Choose one to continue. More styles, a builder and photo upload arrive soon.
        </p>
        <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-8">
          {presets.map((preset, index) => (
            <label
              key={`${preset.config.style}-${preset.config.seed}`}
              className="cursor-pointer rounded-2xl border-2 border-transparent bg-surface-2 p-1 has-checked:border-accent has-focus-visible:outline-3 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name="avatar"
                value={JSON.stringify(preset.config)}
                className="sr-only"
                required
              />
              {/* SVG generated on our server; an <img> cannot run scripts inside it. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- data URI, nothing to optimise */}
              <img
                src={preset.dataUri}
                alt={`Picture ${String(index + 1)} (${preset.config.style} style)`}
                width={72}
                height={72}
                className="h-auto w-full rounded-xl"
              />
            </label>
          ))}
        </div>
        {state.errors?.avatar ? (
          <p id="avatar-error" className="mt-2 text-sm font-medium text-danger">
            {state.errors.avatar}
          </p>
        ) : null}
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Continue'}
      </Button>
    </form>
  );
}
