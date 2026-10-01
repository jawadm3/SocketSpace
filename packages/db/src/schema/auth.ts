/**
 * Accounts: Better Auth's tables (user, session, account, verification, jwks, passkey, rateLimit),
 * with SocketSpace's own profile and safety columns added to `user`.
 *
 * Better Auth finds tables by their key in the schema object (`user`, `session`, ...) and columns
 * by their JavaScript property name (`emailVerified`, `credentialID`, ...). Those names must match
 * Better Auth 1.7's field names exactly; the SQL column names are snake_case.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { LIMITS } from '@socketspace/shared/limits';

import {
  avatarKindEnum,
  colorModeEnum,
  createdAtColumn,
  dmPolicyEnum,
  idColumn,
  nameDisplayEnum,
  realNameVisibilityEnum,
  themeEnum,
  tstz,
  updatedAtColumn,
  userRoleEnum,
  userStatusEnum,
} from './_common';

export const user = pgTable(
  'user',
  {
    id: idColumn(),
    /**
     * The optional real name (D-024). Better Auth requires this column, so "no real name" is an
     * empty string. Filled from Google/Facebook when available; hidden by default.
     */
    name: text('name').notNull().default(''),
    /** Lower-cased by Better Auth before it is stored. Guests get a placeholder address. */
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    /** For `avatar_kind = 'photo'`: storage key of the re-encoded image. */
    image: text('image'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    /** Guest account (random mode only), from Better Auth's anonymous plugin (D-025). */
    isAnonymous: boolean('is_anonymous').notNull().default(false),

    /** Unique nickname shown in chats and used for @mentions (D-024). Null until onboarding. */
    nickname: text('nickname'),
    realNameVisibility: realNameVisibilityEnum('real_name_visibility').notNull().default('nobody'),
    nameDisplay: nameDisplayEnum('name_display').notNull().default('nickname'),
    /** Required before onboarding completes (D-023). */
    avatarKind: avatarKindEnum('avatar_kind'),
    /** For preset/custom avatars: DiceBear style, seed and options. */
    avatarConfig: jsonb('avatar_config'),
    theme: themeEnum('theme').notNull().default('airmail'),
    colorMode: colorModeEnum('color_mode').notNull().default('system'),
    onboardedAt: tstz('onboarded_at'),
    bio: text('bio').notNull().default(''),
    role: userRoleEnum('role').notNull().default('user'),
    status: userStatusEnum('status').notNull().default('active'),
    dmPolicy: dmPolicyEnum('dm_policy').notNull().default('everyone'),
    showPresence: boolean('show_presence').notNull().default(true),
    readReceipts: boolean('read_receipts').notNull().default(true),
    adultConfirmedAt: tstz('adult_confirmed_at'),
    randomTermsVersion: text('random_terms_version'),
    randomTermsAcceptedAt: tstz('random_terms_accepted_at'),
    lastSeenAt: tstz('last_seen_at'),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    // Case-insensitive uniqueness: "Ava" and "ava" cannot both exist.
    uniqueIndex('user_nickname_lower_uq').on(sql`lower(${t.nickname})`),
    check(
      'user_nickname_format',
      sql`${t.nickname} IS NULL OR ${t.nickname} ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,22}[A-Za-z0-9]$'`,
    ),
    check(
      'user_bio_length',
      sql`char_length(${t.bio}) <= ${sql.raw(String(LIMITS.profile.bioMax))}`,
    ),
    // An onboarded account always has a nickname and a chosen avatar (D-023, D-024).
    check(
      'user_onboarded_complete',
      sql`${t.onboardedAt} IS NULL OR (${t.nickname} IS NOT NULL AND ${t.avatarKind} IS NOT NULL)`,
    ),
  ],
);

export const session = pgTable(
  'session',
  {
    id: idColumn(),
    expiresAt: tstz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    /** Shown in the "active sessions" list; deleted with the session. */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: idColumn(),
    accountId: text('account_id').notNull(),
    /** `credential` for email + password, otherwise the social provider's ID (`google`, ...). */
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    /** Password hash (scrypt), only for `credential` accounts. */
    password: text('password'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('account_user_id_idx').on(t.userId),
    // One provider identity belongs to exactly one SocketSpace account.
    uniqueIndex('account_provider_account_uq').on(t.providerId, t.accountId),
  ],
);

/** Email verification and password reset tokens. */
export const verification = pgTable(
  'verification',
  {
    id: idColumn(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** Signing keys for realtime connection tokens (Better Auth JWT plugin). */
export const jwks = pgTable('jwks', {
  id: idColumn(),
  publicKey: text('public_key').notNull(),
  /** Encrypted by Better Auth with BETTER_AUTH_SECRET before it is stored. */
  privateKey: text('private_key').notNull(),
  createdAt: createdAtColumn(),
  expiresAt: tstz('expires_at'),
  alg: text('alg'),
  crv: text('crv'),
});

/** WebAuthn passkeys (Better Auth passkey plugin). */
export const passkey = pgTable(
  'passkey',
  {
    id: idColumn(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: tstz('created_at').defaultNow(),
    aaguid: text('aaguid'),
  },
  (t) => [
    index('passkey_user_id_idx').on(t.userId),
    uniqueIndex('passkey_credential_id_uq').on(t.credentialID),
  ],
);

/** Better Auth's rate-limit counters (database storage works across serverless instances). */
export const rateLimit = pgTable('rate_limit', {
  id: idColumn(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

/**
 * Per-account sign-in lockout with growing delays (security.md 3.1).
 * Keyed by a hash of the lower-cased email, so the table holds no email addresses.
 */
export const authLockout = pgTable('auth_lockout', {
  keyHash: text('key_hash').primaryKey(),
  failures: integer('failures').notNull().default(0),
  firstFailureAt: tstz('first_failure_at').notNull().defaultNow(),
  lockedUntil: tstz('locked_until'),
  updatedAt: updatedAtColumn(),
});
