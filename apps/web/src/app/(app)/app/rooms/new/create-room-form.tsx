'use client';

import { useActionState, useState } from 'react';

import { LIMITS } from '@socketspace/shared/limits';
import { slugFromName } from '@socketspace/shared/rooms';

import { Alert, Button, TextField } from '@/components/ui';

import { createRoomAction, type RoomActionState } from '../../room-actions';

export function CreateRoomForm() {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(createRoomAction, {});
  const [name, setName] = useState(state.values?.name ?? '');
  const [slug, setSlug] = useState(state.values?.slug ?? '');
  // Suggest the address from the name until the person edits it themselves.
  const [slugEdited, setSlugEdited] = useState(Boolean(state.values?.slug));
  const shownSlug = slugEdited ? slug : slugFromName(name);
  const visibility = state.values?.visibility ?? 'public';

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <TextField
        id="name"
        name="name"
        label="Name"
        required
        maxLength={LIMITS.room.nameMax}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        error={state.fieldErrors?.name}
      />
      <TextField
        id="slug"
        name="slug"
        label="Address"
        required
        minLength={LIMITS.room.slugMin}
        maxLength={LIMITS.room.slugMax}
        value={shownSlug}
        onChange={(event) => {
          setSlugEdited(true);
          setSlug(event.target.value.toLowerCase());
        }}
        hint={
          <>
            Lower-case letters, numbers and dashes. The room will live at{' '}
            <span className="font-mono">/app/r/{shownSlug || 'your-room'}</span>.
          </>
        }
        error={state.fieldErrors?.slug}
      />
      <TextField
        id="topic"
        name="topic"
        label="Topic (optional)"
        maxLength={LIMITS.room.topicMax}
        defaultValue={state.values?.topic}
        hint="One line about what the room is for."
        error={state.fieldErrors?.topic}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Who can join?</legend>
        <label className="flex items-start gap-3 rounded-xl border border-line p-3 has-checked:border-accent">
          <input
            type="radio"
            name="visibility"
            value="public"
            defaultChecked={visibility === 'public'}
            className="mt-1"
          />
          <span>
            <span className="block font-semibold">Public</span>
            <span className="block text-sm text-ink-2">
              Listed in Explore. Anyone with an account can read and join.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-line p-3 has-checked:border-accent">
          <input
            type="radio"
            name="visibility"
            value="private"
            defaultChecked={visibility === 'private'}
            className="mt-1"
          />
          <span>
            <span className="block font-semibold">Private</span>
            <span className="block text-sm text-ink-2">
              Hidden. People join only with an invite link from a moderator or you.
            </span>
          </span>
        </label>
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create room'}
      </Button>
    </form>
  );
}
