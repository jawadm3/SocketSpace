/**
 * Rooms, invites and room moderation (ROOM-01 to ROOM-06): the rules for names, addresses and
 * durations, shared by the web app's forms and server actions and the database checks.
 */
import { z } from 'zod';

import { CONVERSATION_VISIBILITIES } from './domain';
import { LIMITS } from './limits';
import { uuid } from './primitives';
import { codePointLength, normalizeSingleLine } from './text';

// Room addresses ("slugs") -----------------------------------------------------------------------

/** Same pattern as the database check `conversation_slug_format`: 3 to 32 characters. */
export const ROOM_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/** Addresses nobody may take: app words, and names that could pass for staff rooms. */
export const RESERVED_ROOM_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'announcements',
  'api',
  'app',
  'explore',
  'help',
  'invite',
  'moderators',
  'new',
  'official',
  'random',
  'search',
  'security',
  'settings',
  'socketspace',
  'staff',
  'support',
  'system',
]);

export const roomSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.room.slugMin, 'The address must be at least 3 characters')
  .max(LIMITS.room.slugMax, 'The address must be at most 32 characters')
  .regex(
    ROOM_SLUG_PATTERN,
    'Use lower-case letters, numbers and dashes, starting and ending with a letter or number',
  )
  .refine((value) => !value.includes('--'), 'Use single dashes only')
  .refine((value) => !RESERVED_ROOM_SLUGS.has(value), 'That address is reserved');

/**
 * Suggests an address from a room name: "Design Talk!" becomes "design-talk". Returns '' when
 * nothing usable is left (for example a name made only of emoji); the form then asks for one.
 */
export function slugFromName(name: string): string {
  const slug = normalizeSingleLine(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.room.slugMax)
    .replace(/-+$/g, '');
  return slug.length >= LIMITS.room.slugMin ? slug : '';
}

// Names and topics -------------------------------------------------------------------------------

export const roomNameSchema = z
  .string()
  .max(LIMITS.room.nameMax * 4)
  .transform(normalizeSingleLine)
  .refine((value) => value.length > 0, 'Give the room a name')
  .refine(
    (value) => codePointLength(value) <= LIMITS.room.nameMax,
    `The name must be at most ${String(LIMITS.room.nameMax)} characters`,
  );

export const roomTopicSchema = z
  .string()
  .max(LIMITS.room.topicMax * 4)
  .transform(normalizeSingleLine)
  .refine(
    (value) => codePointLength(value) <= LIMITS.room.topicMax,
    `The topic must be at most ${String(LIMITS.room.topicMax)} characters`,
  );

export const roomVisibilitySchema = z.enum(CONVERSATION_VISIBILITIES);

export const createRoomSchema = z.strictObject({
  name: roomNameSchema,
  slug: roomSlugSchema,
  topic: roomTopicSchema,
  visibility: roomVisibilitySchema,
});

export const updateRoomSchema = z.strictObject({
  name: roomNameSchema,
  topic: roomTopicSchema,
});

// Invites -------------------------------------------------------------------------------------------

/** An invite code: 16 random bytes (128 bits) in base64url, so 22 characters. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const inviteCodeSchema = z
  .string()
  .regex(INVITE_CODE_PATTERN, 'This invite link is not valid');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Invite lifetimes offered in room settings. `null` means it never expires. */
export const INVITE_EXPIRY_CHOICES = {
  '30m': 30 * MINUTE,
  '1d': DAY,
  '7d': 7 * DAY,
  never: null,
} as const;

/** How many people an invite admits. `null` means no limit. */
export const INVITE_USE_CHOICES = { '1': 1, '5': 5, '25': 25, unlimited: null } as const;

export const createInviteSchema = z.strictObject({
  conversationId: uuid,
  expiresIn: z.enum(Object.keys(INVITE_EXPIRY_CHOICES) as [keyof typeof INVITE_EXPIRY_CHOICES]),
  maxUses: z.enum(Object.keys(INVITE_USE_CHOICES) as [keyof typeof INVITE_USE_CHOICES]),
});

// Room moderation -------------------------------------------------------------------------------

/** Mute lengths offered to room moderators. */
export const ROOM_MUTE_CHOICES = {
  '10m': 10 * MINUTE,
  '1h': HOUR,
  '1d': DAY,
  '7d': 7 * DAY,
} as const;

/** Room ban lengths. `null` is permanent (until a moderator lifts it). */
export const ROOM_BAN_CHOICES = {
  '1d': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  permanent: null,
} as const;

/** Every room moderation action carries a reason, shown to the person and kept in the audit log. */
export const moderationReasonSchema = z
  .string()
  .max(2000)
  .transform(normalizeSingleLine)
  .refine((value) => value.length >= 3, 'Give a short reason (at least 3 characters)')
  .refine((value) => codePointLength(value) <= 500, 'The reason must be at most 500 characters');

export const roomMuteSchema = z.strictObject({
  conversationId: uuid,
  userId: uuid,
  duration: z.enum(Object.keys(ROOM_MUTE_CHOICES) as [keyof typeof ROOM_MUTE_CHOICES]),
  reason: moderationReasonSchema,
});

export const roomBanSchema = z.strictObject({
  conversationId: uuid,
  userId: uuid,
  duration: z.enum(Object.keys(ROOM_BAN_CHOICES) as [keyof typeof ROOM_BAN_CHOICES]),
  reason: moderationReasonSchema,
});

export const roomRemoveSchema = z.strictObject({
  conversationId: uuid,
  userId: uuid,
  reason: moderationReasonSchema,
});

/** Owners promote members to moderator or demote them; ownership moves with `transfer`. */
export const roomRoleSchema = z.strictObject({
  conversationId: uuid,
  userId: uuid,
  role: z.enum(['moderator', 'member']),
});
