/**
 * Names and avatars (owner decisions D-023 and D-024).
 *
 * - Nickname: unique (ignoring letter case), shown in chats and used for @mentions.
 * - Real name: optional, private by default; only sent to viewers allowed to see it.
 * - Avatar: a DiceBear preset or custom design (CC0 styles only, rendered locally), or a photo.
 */
import { z } from 'zod';

import { NAME_DISPLAYS, REAL_NAME_VISIBILITIES } from './domain';
import { LIMITS } from './limits';
import { MEDIA_PATH_PATTERN } from './media';
import { uuid } from './primitives';
import { codePointLength, normalizeSingleLine } from './text';

// Nicknames ------------------------------------------------------------------------------------

/** Same pattern as the database check `user_nickname_format`: 3 to 24 characters. */
export const NICKNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,22}[A-Za-z0-9]$/;

/** Nicknames nobody may take, because they could be mistaken for staff or system messages. */
export const RESERVED_NICKNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'all',
  'channel',
  'deleted',
  'deleted_user',
  'everyone',
  'here',
  'help',
  'me',
  'mod',
  'moderator',
  'moderators',
  'null',
  'official',
  'owner',
  'root',
  'security',
  'socketspace',
  'staff',
  'stranger',
  'support',
  'system',
  'team',
  'undefined',
  'you',
]);

export function isReservedNickname(nickname: string): boolean {
  return RESERVED_NICKNAMES.has(nickname.toLowerCase());
}

export const nicknameSchema = z
  .string()
  .trim()
  .min(LIMITS.profile.nicknameMin, 'Nickname must be at least 3 characters')
  .max(LIMITS.profile.nicknameMax, 'Nickname must be at most 24 characters')
  .regex(
    NICKNAME_PATTERN,
    'Use letters, numbers, dots, dashes and underscores, starting and ending with a letter or number',
  )
  .refine((value) => !isReservedNickname(value), 'That nickname is reserved');

/**
 * Turns any text (an email name, a real name) into something that can start a nickname:
 * accents removed, other characters dropped, 3 to 20 characters.
 */
export function nicknameBase(source: string): string {
  const ascii = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .slice(0, 20);
  // Too short on its own: add a friendly word (not "user": "ab" + "user" reads as "abuser").
  return ascii.length >= 3 ? ascii : `${ascii}friend`;
}

/**
 * Candidate nicknames for when the one someone wanted is taken. The database decides which are
 * actually free (`filterAvailableNicknames`). `random` is injectable for tests.
 */
export function suggestNicknames(
  wanted: string,
  count = 5,
  random: () => number = Math.random,
): string[] {
  const base = nicknameBase(wanted);
  const suffixes = ['_', '.', ''];
  const candidates = new Set<string>();
  let guard = 0;
  while (candidates.size < count * 3 && guard < 200) {
    guard += 1;
    const digits = String(Math.floor(random() * (guard < 40 ? 100 : 10_000)));
    const separator = suffixes[Math.floor(random() * suffixes.length)] ?? '';
    const candidate = `${base.slice(0, LIMITS.profile.nicknameMax - separator.length - digits.length)}${separator}${digits}`;
    if (nicknameSchema.safeParse(candidate).success) candidates.add(candidate);
  }
  return [...candidates];
}

// Real names ------------------------------------------------------------------------------------

/** Optional real name: single line, at most 60 characters; empty means "none". */
export const realNameSchema = z
  .string()
  .max(LIMITS.profile.realNameMax * 4)
  .transform(normalizeSingleLine)
  .refine(
    (value) => codePointLength(value) <= LIMITS.profile.realNameMax,
    `Real name must be at most ${String(LIMITS.profile.realNameMax)} characters`,
  );

export const realNameVisibilitySchema = z.enum(REAL_NAME_VISIBILITIES);
export const nameDisplaySchema = z.enum(NAME_DISPLAYS);

// Avatars ---------------------------------------------------------------------------------------

/**
 * DiceBear styles whose artwork is CC0 1.0 (no attribution needed). Checked against the licence
 * table in `@dicebear/styles` 10.6.0 (LICENSE.md) on 2026-10-02: 42 styles. Styles under
 * CC BY 4.0 or "free for personal and commercial use" are deliberately left out (D-023).
 */
export const AVATAR_STYLES = [
  'blobs',
  'cameo',
  'clay',
  'constellation',
  'critters',
  'cutouts',
  'disco',
  'gaze',
  'glass',
  'identicon',
  'initial-face',
  'initials',
  'landscape',
  'line-face',
  'loops',
  'lorelei',
  'lorelei-neutral',
  'marbles',
  'moods',
  'notionists',
  'notionists-neutral',
  'open-peeps',
  'patchwork',
  'pixel-art',
  'pixel-art-neutral',
  'pixelbot',
  'planets',
  'rings',
  'shadows',
  'shape-grid',
  'shapes',
  'slice',
  'sprouts',
  'squircles',
  'stack',
  'stripes',
  'thumbs',
  'triangles',
  'voxel-art',
  'voxel-bot',
  'waves',
  'weave',
] as const;

export type AvatarStyle = (typeof AVATAR_STYLES)[number];

const optionKey = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/);
const optionValue = z.union([
  z.string().max(64),
  z.number(),
  z.boolean(),
  z.array(z.string().max(64)).max(16),
]);

/**
 * A preset or custom avatar, stored as settings rather than an image (no storage cost, no
 * third-party request when shown). DiceBear validates the individual options when rendering.
 */
export const avatarConfigSchema = z.strictObject({
  style: z.enum(AVATAR_STYLES),
  seed: z.string().min(1).max(64),
  options: z
    .record(optionKey, optionValue)
    .refine((value) => Object.keys(value).length <= 24, 'Too many avatar options')
    .optional(),
});

export type AvatarConfig = z.infer<typeof avatarConfigSchema>;

/** What the database keeps for a photo avatar: the stored picture's ID (PROF-08). */
export const photoAvatarSchema = z.strictObject({ attachmentId: uuid });

/**
 * How an avatar travels to browsers: settings to render locally, or a photo. A photo is always a
 * path on our own server (`/api/media/<id>`), never another site's address.
 */
export const avatarWireSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('generated'), config: avatarConfigSchema }),
  z.strictObject({ kind: z.literal('photo'), url: z.string().regex(MEDIA_PATH_PATTERN) }),
]);

export type AvatarWire = z.infer<typeof avatarWireSchema>;

// People in payloads ------------------------------------------------------------------------------

/**
 * Every person sent to a browser has this shape (realtime-protocol.md, "People in payloads").
 * `realName` is present only when this particular viewer may see it and the person chose to show
 * it in chats. Broadcasts to many viewers never include it.
 */
export const publicUserSchema = z.strictObject({
  id: uuid,
  nickname: z.string(),
  avatar: avatarWireSchema.nullable(),
  realName: z.string().optional(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;

export interface RealNameSource {
  name: string;
  realNameVisibility: (typeof REAL_NAME_VISIBILITIES)[number];
  nameDisplay: (typeof NAME_DISPLAYS)[number];
}

export interface ViewerRelation {
  /** The viewer is the person themselves. */
  isSelf: boolean;
  /** The viewer is one of the person's contacts. */
  isContact: boolean;
}

/**
 * The real name to include for one viewer, or `undefined`. This is the server-side rule that keeps
 * a hidden real name from ever reaching a browser that may not show it (security.md 3.12).
 *
 * `visibility` decides who may see the real name at all (for example on a profile page).
 * In `chat` context the person must also have chosen to show it in chats (`nameDisplay`).
 */
export function realNameForViewer(
  person: RealNameSource,
  viewer: ViewerRelation,
  context: 'chat' | 'profile',
): string | undefined {
  const name = person.name.trim();
  if (name === '') return undefined;
  if (viewer.isSelf) return name;
  if (context === 'chat' && person.nameDisplay === 'nickname') return undefined;
  switch (person.realNameVisibility) {
    case 'everyone':
      return name;
    case 'contacts':
      return viewer.isContact ? name : undefined;
    case 'nobody':
      return undefined;
  }
}
