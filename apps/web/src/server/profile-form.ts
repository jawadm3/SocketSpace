/**
 * Reading profile fields from a submitted form, for onboarding and settings. Everything is checked
 * here, on the server, whatever the browser sent.
 */
import 'server-only';

import { z } from 'zod';

import { LIMITS } from '@socketspace/shared/limits';
import {
  avatarConfigSchema,
  nameDisplaySchema,
  realNameSchema,
  realNameVisibilitySchema,
  type AvatarConfig,
} from '@socketspace/shared/profile';
import { codePointLength, normalizeText } from '@socketspace/shared/text';

import { formText } from '@/lib/forms';

import { sanitizeAvatarConfig } from './avatar';

export interface ParsedAvatar {
  kind: 'preset' | 'custom';
  config: AvatarConfig;
}

/** The picked picture, or `null` when missing or not a real choice. */
export function parseAvatarField(form: FormData): ParsedAvatar | null {
  const raw = formText(form, 'avatar');
  const kind = formText(form, 'avatarKind');
  if (raw === '' || raw.length > 4000 || (kind !== 'preset' && kind !== 'custom')) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = avatarConfigSchema.safeParse(json);
  if (!parsed.success) return null;
  // A preset is exactly a gallery picture: a style and a seed, nothing else.
  if (kind === 'preset' && parsed.data.options !== undefined) return null;
  const config = sanitizeAvatarConfig(parsed.data);
  return config ? { kind, config } : null;
}

const namesSchema = z.object({
  realName: realNameSchema,
  realNameVisibility: realNameVisibilitySchema,
  nameDisplay: nameDisplaySchema,
});

export type NameChoicesResult =
  { ok: true; names: z.output<typeof namesSchema> } | { ok: false; error: string };

export function parseNameChoices(form: FormData): NameChoicesResult {
  const parsed = namesSchema.safeParse({
    realName: formText(form, 'realName'),
    realNameVisibility: formText(form, 'realNameVisibility') || 'nobody',
    nameDisplay: formText(form, 'nameDisplay') || 'nickname',
  });
  return parsed.success
    ? { ok: true, names: parsed.data }
    : { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your real name.' };
}

/** A short bio: one paragraph, at most 160 characters. */
export function parseBio(form: FormData): { ok: true; bio: string } | { ok: false; error: string } {
  const bio = normalizeText(formText(form, 'bio')).replace(/\s+/g, ' ').trim();
  return codePointLength(bio) <= LIMITS.profile.bioMax
    ? { ok: true, bio }
    : { ok: false, error: `Keep your bio to ${String(LIMITS.profile.bioMax)} characters.` };
}
