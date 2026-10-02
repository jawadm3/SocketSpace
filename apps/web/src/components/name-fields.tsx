/**
 * The optional real name and who may see it (D-024, PROF-04): used in onboarding and settings.
 * Plain radio buttons inside fieldsets, so they work without JavaScript and read well aloud.
 */
import { LIMITS } from '@socketspace/shared/limits';

import { TextField } from './ui';

export interface NameValues {
  realName: string;
  realNameVisibility: 'nobody' | 'contacts' | 'everyone';
  nameDisplay: 'nickname' | 'real_name' | 'both';
}

function RadioCard({
  name,
  value,
  checked,
  title,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex flex-1 items-start gap-2 rounded-xl border border-line p-3 has-checked:border-accent">
      <input type="radio" name={name} value={value} defaultChecked={checked} className="mt-1" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-ink-2">{hint}</span>
      </span>
    </label>
  );
}

export function NameFields({ values, error }: { values: NameValues; error?: string | undefined }) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        id="realName"
        name="realName"
        label="Real name (optional)"
        autoComplete="name"
        maxLength={LIMITS.profile.realNameMax}
        defaultValue={values.realName}
        hint="Only shown to the people you choose below. Leave it empty if you prefer."
        error={error}
      />
      <fieldset>
        <legend className="text-sm font-semibold">Who can see your real name?</legend>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <RadioCard
            name="realNameVisibility"
            value="nobody"
            checked={values.realNameVisibility === 'nobody'}
            title="Nobody"
            hint="Only you."
          />
          <RadioCard
            name="realNameVisibility"
            value="contacts"
            checked={values.realNameVisibility === 'contacts'}
            title="My contacts"
            hint="People you have added."
          />
          <RadioCard
            name="realNameVisibility"
            value="everyone"
            checked={values.realNameVisibility === 'everyone'}
            title="Everyone"
            hint="Anyone on SocketSpace."
          />
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold">
          What should chats show next to your messages?
        </legend>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <RadioCard
            name="nameDisplay"
            value="nickname"
            checked={values.nameDisplay === 'nickname'}
            title="Nickname"
            hint="Just your nickname."
          />
          <RadioCard
            name="nameDisplay"
            value="both"
            checked={values.nameDisplay === 'both'}
            title="Both"
            hint="Nickname, then your real name to people allowed to see it."
          />
          <RadioCard
            name="nameDisplay"
            value="real_name"
            checked={values.nameDisplay === 'real_name'}
            title="Real name"
            hint="Your real name to people allowed to see it; your nickname to everyone else."
          />
        </div>
      </fieldset>
    </div>
  );
}
