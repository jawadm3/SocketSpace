/**
 * Sign-in for SocketSpace, built on Better Auth 1.7 (decision D-012).
 *
 * `createAuth` builds the configuration from explicit dependencies, so integration tests can run
 * the real thing against an in-memory database and a memory mail driver. The app's own instance
 * lives in ./auth-instance.ts.
 *
 * Security choices (security.md 3.1, 3.2, 3.11):
 * - passwords 10 to 128 characters, checked against Have I Been Pwned (k-anonymity);
 * - email verification required to post (enforced by the realtime server), not to sign in;
 * - reset links single-use, 30-minute expiry, every session revoked after a reset;
 * - sign-in rate limits (3 per 10 s per IP) plus a per-account lockout with growing delays;
 * - accounts are linked by email only for providers whose email is trustworthy: Facebook and
 *   Microsoft never auto-link (D-022);
 * - suspended, banned and deleted accounts cannot start a session.
 */
import 'server-only';

import { createHmac } from 'node:crypto';

import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { anonymous, haveIBeenPwned, jwt, lastLoginMethod } from 'better-auth/plugins';

import {
  clearFailedSignIns,
  getLockoutRemainingMs,
  newId,
  recordFailedSignIn,
  resolveSignInStanding,
  schema,
  type Database,
} from '@socketspace/db';
import { LIMITS } from '@socketspace/shared/limits';
import { REALTIME_TOKEN_AUDIENCE } from '@socketspace/shared/realtime-token';
import { codePointLength, normalizeSingleLine } from '@socketspace/shared/text';

import type { EmailSender } from './email';
import { resetPasswordMessage, verifyEmailMessage } from './email/templates';
import type { WebEnv } from './env';
import type { Logger } from './log';
import type { RealtimeNotifier } from './realtime-events';

/**
 * What a person reads when they may not sign in. A suspended or banned person is told the
 * moderator's reason and, when there is one, the end (in UTC: the server does not know their
 * time zone). Only the person themselves gets this far: the password was already checked.
 */
export function inactiveAccountMessage(standing: {
  status: 'suspended' | 'banned' | 'deleted';
  until: Date | null;
  reason: string | null;
}): string {
  if (standing.status === 'deleted' || standing.reason === null) {
    return 'This account is suspended or closed.';
  }
  const until = standing.until
    ? ` until ${standing.until.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : '';
  const what = standing.status === 'banned' ? 'banned' : 'suspended';
  return `This account is ${what}${until}. Reason: ${standing.reason}`;
}

/** Guests get a placeholder address on a domain that can never receive mail (RFC 2606). */
export const GUEST_EMAIL_DOMAIN = 'guest.socketspace.invalid';

/** Providers whose email addresses Better Auth's documentation calls trustworthy. */
export const TRUSTED_LINK_PROVIDERS = ['google', 'github', 'discord', 'linkedin'];

/** Sessions end after 7 days without use, and 30 days after sign-in at the latest. */
export const SESSION_IDLE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthDeps {
  db: Database;
  env: WebEnv;
  email: EmailSender;
  notifier: RealtimeNotifier;
  logger: Logger;
  /** Runs work after the response is sent (Next.js `after`); tests run it straight away. */
  defer: (task: () => Promise<void>) => void;
}

export type SocialProviderId =
  'google' | 'facebook' | 'github' | 'discord' | 'microsoft' | 'linkedin';

/** The social providers whose credentials are configured, in the order the sign-in page shows them. */
export function enabledSocialProviders(env: WebEnv): SocialProviderId[] {
  const pairs: [SocialProviderId, string | undefined, string | undefined][] = [
    ['google', env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
    ['facebook', env.FACEBOOK_CLIENT_ID, env.FACEBOOK_CLIENT_SECRET],
    ['github', env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET],
    ['discord', env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET],
    ['microsoft', env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET],
    ['linkedin', env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET],
  ];
  return pairs.filter(([, id, secret]) => Boolean(id && secret)).map(([provider]) => provider);
}

/** Facebook and Microsoft emails are never treated as verified, so they never auto-link (D-022). */
const untrustedEmail = () => ({ emailVerified: false });

function socialProviders(env: WebEnv) {
  const enabled = new Set(enabledSocialProviders(env));
  const credentials = (id: string | undefined, secret: string | undefined) => ({
    clientId: id ?? '',
    clientSecret: secret ?? '',
  });
  return {
    ...(enabled.has('google') && {
      google: {
        ...credentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
        prompt: 'select_account' as const,
      },
    }),
    ...(enabled.has('facebook') && {
      facebook: {
        ...credentials(env.FACEBOOK_CLIENT_ID, env.FACEBOOK_CLIENT_SECRET),
        mapProfileToUser: untrustedEmail,
      },
    }),
    ...(enabled.has('github') && {
      github: credentials(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    }),
    ...(enabled.has('discord') && {
      discord: credentials(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET),
    }),
    ...(enabled.has('microsoft') && {
      microsoft: {
        ...credentials(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET),
        tenantId: env.MICROSOFT_TENANT_ID,
        mapProfileToUser: untrustedEmail,
      },
    }),
    ...(enabled.has('linkedin') && {
      linkedin: credentials(env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET),
    }),
  };
}

/** A real name from a provider or form: one line, at most 60 characters, "" when absent. */
export function cleanRealName(name: unknown): string {
  if (typeof name !== 'string') return '';
  const clean = normalizeSingleLine(name);
  if (codePointLength(clean) <= LIMITS.profile.realNameMax) return clean;
  return Array.from(clean).slice(0, LIMITS.profile.realNameMax).join('').trim();
}

/** Paths that start a new session. */
const SESSION_STARTING_PATHS = [
  '/sign-in',
  '/sign-up',
  '/callback',
  '/verify-email',
  '/passkey/verify-authentication',
];

/** A Cookie header without the named cookies (including chunked parts such as `name.0`). */
function withoutCookies(header: string, names: readonly string[]): string {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      const name = part.slice(0, part.indexOf('=')).trim();
      return part !== '' && !names.some((n) => name === n || name.startsWith(`${n}.`));
    })
    .join('; ');
}

/** The email field of a sign-in request body (the body is not typed at this point). */
function emailFromBody(body: unknown): string {
  const value = (body as { email?: unknown } | undefined)?.email;
  return typeof value === 'string' ? value : '';
}

export function createAuth(deps: AuthDeps) {
  const { db, env, email, notifier, logger, defer } = deps;
  const authOrigin = new URL(env.BETTER_AUTH_URL);

  /** HMAC of the lower-cased email, so the lockout table never stores addresses. */
  const lockoutKey = (address: string) =>
    createHmac('sha256', env.BETTER_AUTH_SECRET)
      .update(`lockout:${address.trim().toLowerCase()}`)
      .digest('hex');

  const sendLater = (message: Parameters<EmailSender['send']>[0]) => {
    // Sending after the response keeps "reset link sent" equally fast for known and unknown
    // addresses (no account enumeration by timing).
    defer(async () => {
      try {
        await email.send(message);
      } catch (error) {
        logger.error('email not sent', { kind: message.kind, error });
      }
    });
  };

  const notifyLater = (event: Parameters<RealtimeNotifier['notify']>[0]) => {
    defer(async () => {
      try {
        await notifier.notify(event);
      } catch (error) {
        logger.error('realtime notification failed', { type: event.type, error });
      }
    });
  };

  return betterAuth({
    appName: 'SocketSpace',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [authOrigin.origin],
    telemetry: { enabled: false },

    database: drizzleAdapter(db, { provider: 'pg', schema }),

    // Endpoints the app does not offer over HTTP. Profile edits go through validated server
    // actions; session revocation goes through server actions that also disconnect live sockets;
    // provider access tokens are never handed to the browser.
    disabledPaths: [
      '/update-user',
      '/update-session',
      '/change-email',
      '/delete-user',
      '/delete-user/callback',
      '/revoke-session',
      '/revoke-sessions',
      '/revoke-other-sessions',
      '/get-access-token',
      '/refresh-token',
      '/account-info',
      '/verify-password',
      '/token',
    ],

    advanced: {
      database: { generateId: () => newId() },
      ipAddress: { ipAddressHeaders: [env.CLIENT_IP_HEADER] },
      useSecureCookies: authOrigin.protocol === 'https:',
      cookiePrefix: 'ss',
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },

    user: {
      additionalFields: {
        nickname: { type: 'string', required: false, input: false },
        onboardedAt: { type: 'date', required: false, input: false },
        avatarKind: { type: 'string', required: false, input: false },
        role: { type: 'string', required: false, input: false },
        status: { type: 'string', required: false, input: false },
        theme: { type: 'string', required: false, input: false },
        colorMode: { type: 'string', required: false, input: false },
        realNameVisibility: { type: 'string', required: false, input: false },
        nameDisplay: { type: 'string', required: false, input: false },
      },
    },

    session: {
      expiresIn: SESSION_IDLE_SECONDS,
      // Extend the idle timer at most once a day.
      updateAge: 24 * 60 * 60,
    },

    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: TRUSTED_LINK_PROVIDERS,
        allowDifferentEmails: false,
      },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: LIMITS.password.min,
      maxPasswordLength: LIMITS.password.max,
      requireEmailVerification: false,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => {
        sendLater(resetPasswordMessage(user.email, url));
        return Promise.resolve();
      },
      onPasswordReset: ({ user }) => {
        notifyLater({ type: 'user.sessions_revoked', userId: user.id });
        return Promise.resolve();
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: ({ user, url }) => {
        if (!user.email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)) {
          sendLater(verifyEmailMessage(user.email, url));
        }
        return Promise.resolve();
      },
    },

    socialProviders: socialProviders(env),

    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT_ENABLED,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 10, max: 3 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/sign-in/anonymous': { window: 60, max: 10 },
      },
    },

    databaseHooks: {
      user: {
        create: {
          // Provider pictures are not used: everyone picks an avatar at onboarding (D-023).
          // Provider names become the optional real name, hidden by default (D-024).
          // Guests have no real name (the anonymous plugin would otherwise store "Anonymous").
          before: (user) =>
            Promise.resolve({
              data: {
                ...user,
                image: null,
                name: (user as { isAnonymous?: boolean }).isAnonymous
                  ? ''
                  : cleanRealName(user.name),
              },
            }),
        },
      },
      session: {
        create: {
          before: async (session) => {
            // A suspension or ban ends every session, so this is the one way back in. If the
            // sanction has run out, the account is put back to normal here (ADMIN-03).
            const standing = await resolveSignInStanding(db, session.userId);
            if (!standing.allowed) {
              throw APIError.from('FORBIDDEN', {
                code: 'ACCOUNT_INACTIVE',
                message: inactiveAccountMessage(standing),
              });
            }
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Better Auth checks the Origin only when the request carries cookies. Refusing every
        // cross-origin state change also blocks "login CSRF" (another site signing a visitor
        // into an account the attacker controls). Non-browser clients send no Origin and no
        // Sec-Fetch-Site, so they are unaffected.
        const request = ctx.request;
        if (request && request.method !== 'GET' && request.method !== 'HEAD') {
          const origin = request.headers.get('origin');
          const site = request.headers.get('sec-fetch-site');
          if ((origin !== null && origin !== authOrigin.origin) || site === 'cross-site') {
            throw APIError.from('FORBIDDEN', {
              code: 'INVALID_ORIGIN',
              message: 'This request must come from SocketSpace itself.',
            });
          }
        }

        if (ctx.path === '/sign-in/email') {
          const address = emailFromBody(ctx.body);
          const remaining = await getLockoutRemainingMs(db, lockoutKey(address));
          if (remaining > 0) {
            const minutes = Math.ceil(remaining / 60_000);
            throw APIError.from('TOO_MANY_REQUESTS', {
              code: 'ACCOUNT_LOCKED',
              message: `Too many failed attempts. Try again in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`,
            });
          }
        }
        if (ctx.path === '/sign-out') {
          const current = await getSessionFromCtx(ctx);
          if (current) {
            notifyLater({
              type: 'session.revoked',
              userId: current.user.id,
              sessionIds: [current.session.id],
            });
          }
        }

        // Last, so the checks above always run first.
        // A browser can still hold the cookie of a session that has since ended (for example
        // after a password reset on another device). When such a request signs in, Better Auth's
        // guest plugin looks that old session up after sign-in, finds nothing, and appends
        // "delete the session cookie" headers that cancel the fresh one, so the person is
        // silently signed out again. Dropping a dead session cookie from the request first
        // avoids that; a live (guest) session cookie is kept for the guest-to-account upgrade.
        if (SESSION_STARTING_PATHS.some((p) => ctx.path.startsWith(p))) {
          const cookies = ctx.context.authCookies;
          const token = await ctx.getSignedCookie(cookies.sessionToken.name, ctx.context.secret);
          if (token) {
            const live = await ctx.context.internalAdapter.findSession(token);
            if (!live || live.session.expiresAt < new Date()) {
              const header = ctx.headers?.get('cookie') ?? '';
              return {
                context: {
                  headers: new Headers({
                    cookie: withoutCookies(header, [
                      cookies.sessionToken.name,
                      cookies.sessionData.name,
                      cookies.dontRememberToken.name,
                    ]),
                  }),
                },
              };
            }
          }
        }
        return undefined;
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const address = emailFromBody(ctx.body);
        const returned = ctx.context.returned;
        if (isAPIError(returned)) {
          // 401 = wrong email or password. Other errors (rate limit, lockout) are not attempts.
          if (returned.statusCode === 401) await recordFailedSignIn(db, lockoutKey(address));
        } else if (returned) {
          await clearFailedSignIns(db, lockoutKey(address));
        }
      }),
    },

    plugins: [
      haveIBeenPwned({
        enabled: env.HIBP_ENABLED,
        customPasswordCompromisedMessage:
          'This password has appeared in a known data breach, so it is easy to guess. Please choose a different one.',
      }),
      jwt({
        jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
        jwt: {
          issuer: authOrigin.origin,
          audience: REALTIME_TOKEN_AUDIENCE,
          expirationTime: `${String(LIMITS.realtimeToken.ttlSeconds)}s`,
          // Only what the realtime server needs; never the email or name.
          definePayload: ({ user, session }) => ({
            sid: session.id,
            role: (user as { role?: string }).role ?? 'user',
            guest: Boolean((user as { isAnonymous?: boolean }).isAnonymous),
          }),
        },
        disableSettingJwtHeader: true,
      }),
      anonymous({ emailDomainName: GUEST_EMAIL_DOMAIN, generateName: () => '' }),
      passkey({
        rpID: env.PASSKEY_RP_ID ?? authOrigin.hostname,
        rpName: env.PASSKEY_RP_NAME,
        origin: authOrigin.origin,
      }),
      lastLoginMethod(),
      // Must be last: lets server actions set Better Auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
