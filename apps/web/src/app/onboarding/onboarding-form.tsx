'use client';

import { useActionState, useState } from 'react';

import { LIMITS } from '@socketspace/shared/limits';

import { AvatarPicker, type PresetChoice } from '@/components/avatar-picker';
import { NameFields, type NameValues } from '@/components/name-fields';
import { Alert, Button, TextField } from '@/components/ui';
import type { BuilderStyle } from '@/lib/avatar-builder';

import { completeOnboardingAction, type OnboardingState } from './actions';

export function OnboardingForm({
  presets,
  builder,
  names,
  canUpload,
}: {
  presets: PresetChoice[];
  builder: BuilderStyle[];
  /** A photo needs a confirmed email address. */
  canUpload: boolean;
  /** Pre-filled from a social sign-in when there is one; visibility starts at "nobody". */
  names: NameValues;
}) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    completeOnboardingAction,
    {},
  );
  const [nickname, setNickname] = useState(state.values?.nickname ?? '');

  return (
    <form action={action} className="mt-6 flex flex-col gap-8" noValidate>
      {state.errors?.form ? <Alert tone="error">{state.errors.form}</Alert> : null}

      <section aria-labelledby="step-name" className="flex flex-col gap-4">
        <h2 id="step-name" className="text-lg font-bold">
          1. Your name
        </h2>
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
            hint="3 to 24 letters, numbers, dots, dashes or underscores. Unique on SocketSpace; people @mention you with it."
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
        <NameFields values={state.values ?? names} error={state.errors?.realName} />
      </section>

      <section aria-labelledby="step-picture" className="flex flex-col gap-3">
        <h2 id="step-picture" className="text-lg font-bold">
          2. Your picture
        </h2>
        <p className="text-sm text-muted">
          Pick one from the gallery, make your own, or upload a photo.
        </p>
        <AvatarPicker
          presets={presets}
          builder={builder}
          initial={null}
          error={state.errors?.avatar}
          canUpload={canUpload}
        />
      </section>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Continue'}
      </Button>
    </form>
  );
}
