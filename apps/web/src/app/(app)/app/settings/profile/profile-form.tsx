'use client';

import { useActionState, useState } from 'react';

import { LIMITS } from '@socketspace/shared/limits';

import { AvatarPicker, type PickedAvatar, type PresetChoice } from '@/components/avatar-picker';
import { NameFields, type NameValues } from '@/components/name-fields';
import { Alert, Button, TextField } from '@/components/ui';
import type { BuilderStyle } from '@/lib/avatar-builder';

import { updateProfileAction, type ProfileState } from './actions';

export function ProfileForm({
  nickname: initialNickname,
  names,
  bio,
  avatar,
  presets,
  builder,
  canUpload,
}: {
  /** A photo needs a confirmed email address. */
  canUpload: boolean;
  nickname: string;
  names: NameValues;
  bio: string;
  avatar: PickedAvatar | null;
  presets: PresetChoice[];
  builder: BuilderStyle[];
}) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfileAction, {});
  const [nickname, setNickname] = useState(initialNickname);

  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      {state.errors?.form ? <Alert tone="error">{state.errors.form}</Alert> : null}

      <section aria-labelledby="profile-names" className="flex flex-col gap-4">
        <h2 id="profile-names" className="text-lg font-bold">
          Names
        </h2>
        <TextField
          id="nickname"
          name="nickname"
          label="Nickname"
          required
          minLength={LIMITS.profile.nicknameMin}
          maxLength={LIMITS.profile.nicknameMax}
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value);
          }}
          hint="Shown in chats and used for @mentions."
          error={state.errors?.nickname}
        />
        {state.suggestions && state.suggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Free right now:</span>
            {state.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="rounded-full border border-line bg-surface-2 px-3 py-1 font-semibold"
                onClick={() => {
                  setNickname(suggestion);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <NameFields values={names} error={state.errors?.realName} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bio" className="text-sm font-semibold">
            Bio (optional)
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={2}
            maxLength={LIMITS.profile.bioMax}
            defaultValue={bio}
            aria-describedby={state.errors?.bio ? 'bio-error' : 'bio-hint'}
            className="rounded-xl border border-line bg-card px-3 py-2 text-base"
          />
          {state.errors?.bio ? (
            <p id="bio-error" className="text-sm font-medium text-danger">
              {state.errors.bio}
            </p>
          ) : (
            <p id="bio-hint" className="text-sm text-muted">
              Up to {LIMITS.profile.bioMax} characters, shown on your profile card.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="profile-picture" className="flex flex-col gap-3">
        <h2 id="profile-picture" className="text-lg font-bold">
          Picture
        </h2>
        <AvatarPicker
          presets={presets}
          builder={builder}
          initial={avatar}
          error={state.errors?.avatar}
          canUpload={canUpload}
        />
      </section>

      <div className="flex flex-col gap-3">
        {state.message ? <Alert tone="success">{state.message}</Alert> : null}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
