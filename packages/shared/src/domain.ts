/**
 * The fixed vocabularies of SocketSpace, defined once.
 *
 * The database enums (packages/db) and the Zod contracts (this package) are both built from these
 * lists, so a value cannot exist in one place and be missing in the other.
 * Changing a list means writing a database migration too (see docs/architecture/data-model.md).
 */

// People
export const USER_ROLES = ['user', 'admin'] as const;
export const USER_STATUSES = ['active', 'suspended', 'banned', 'deleted'] as const;
export const REAL_NAME_VISIBILITIES = ['nobody', 'contacts', 'everyone'] as const;
export const NAME_DISPLAYS = ['nickname', 'real_name', 'both'] as const;
export const AVATAR_KINDS = ['preset', 'custom', 'photo'] as const;
export const DM_POLICIES = ['everyone', 'contacts', 'nobody'] as const;

// Appearance (D-021). Airmail is the default theme.
export const THEMES = ['airmail', 'signal', 'aurora'] as const;
export const COLOR_MODES = ['system', 'light', 'dark'] as const;
export const DEFAULT_THEME = 'airmail' satisfies (typeof THEMES)[number];

// Conversations
export const CONVERSATION_KINDS = ['room', 'dm'] as const;
export const CONVERSATION_VISIBILITIES = ['public', 'private'] as const;
export const MEMBER_ROLES = ['owner', 'moderator', 'member'] as const;
export const NOTIFY_LEVELS = ['all', 'mentions', 'none'] as const;

// Messages
export const MESSAGE_KINDS = ['text', 'system'] as const;
export const DELETED_BY = ['author', 'moderator'] as const;
export const MODERATION_STATES = ['visible', 'flagged', 'removed'] as const;
export const ATTACHMENT_STATUSES = ['pending', 'attached', 'removed'] as const;
export const LINK_PREVIEW_STATUSES = ['ok', 'blocked', 'error'] as const;

// Social
export const CONTACT_SOURCES = ['manual', 'random'] as const;
export const CONTACT_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export const NOTIFICATION_TYPES = [
  'mention',
  'reply',
  'dm',
  'invite',
  'contact_request',
  'moderation',
] as const;

// Random mode
export const RANDOM_END_REASONS = [
  'skip',
  'end',
  'disconnect',
  'report',
  'filter',
  'timeout',
] as const;

// Trust and safety
export const REPORT_TARGETS = ['message', 'user', 'room', 'random_session'] as const;
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'self_harm',
  'violence',
  'illegal',
  'underage',
  'other',
] as const;
export const REPORT_STATUSES = ['open', 'in_review', 'actioned', 'dismissed'] as const;
export const FLAG_SOURCES = ['wordlist', 'ai'] as const;
export const FLAG_SEVERITIES = ['low', 'medium', 'high'] as const;
export const MODERATION_ACTION_KINDS = [
  'warn',
  'mute',
  'unmute',
  'suspend',
  'unsuspend',
  'ban',
  'unban',
  'remove_message',
  'restore_message',
  'resolve_report',
  'dismiss_report',
  'role_change',
  'room_ban',
  // Added in Stage D (migration 0002): room-level actions by room owners and moderators.
  'room_unban',
  'room_remove',
  'room_delete',
  // Added in Stage E (migration 0003): random-mode timeouts, set by a moderator or automatically.
  'random_timeout',
  'random_timeout_lifted',
] as const;
export const SANCTION_KINDS = ['warn', 'mute', 'suspend', 'ban', 'random_timeout'] as const;
/** A warning is a record, not a restriction, so there is nothing to lift. */
export const LIFTABLE_SANCTION_KINDS = ['mute', 'suspend', 'ban', 'random_timeout'] as const;
export const SANCTION_SCOPES = ['global', 'random'] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type RealNameVisibility = (typeof REAL_NAME_VISIBILITIES)[number];
export type NameDisplay = (typeof NAME_DISPLAYS)[number];
export type AvatarKind = (typeof AVATAR_KINDS)[number];
export type DmPolicy = (typeof DM_POLICIES)[number];
export type Theme = (typeof THEMES)[number];
export type ColorMode = (typeof COLOR_MODES)[number];
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];
export type ConversationVisibility = (typeof CONVERSATION_VISIBILITIES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type DeletedBy = (typeof DELETED_BY)[number];
export type ModerationState = (typeof MODERATION_STATES)[number];
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number];
export type ModerationActionKind = (typeof MODERATION_ACTION_KINDS)[number];
export type SanctionKind = (typeof SANCTION_KINDS)[number];
export type LiftableSanctionKind = (typeof LIFTABLE_SANCTION_KINDS)[number];
export type SanctionScope = (typeof SANCTION_SCOPES)[number];
