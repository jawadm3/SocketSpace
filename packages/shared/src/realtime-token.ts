/**
 * The short-lived signed token a browser uses to connect to the realtime server
 * (realtime-protocol.md, "Connecting"; security.md 3.6).
 *
 * The web app signs it with its private key (Better Auth's JWT plugin, EdDSA); the realtime server
 * verifies the signature with the public keys from the web app's JWKS endpoint, then checks these
 * claims.
 */
import { z } from 'zod';

import { USER_ROLES } from './domain';
import { LIMITS } from './limits';
import { uuid } from './primitives';

export const REALTIME_TOKEN_AUDIENCE = LIMITS.realtimeToken.audience;

export const realtimeTokenClaimsSchema = z.object({
  /** User ID. */
  sub: uuid,
  /** Session ID: lets the server disconnect exactly the sockets of a revoked session. */
  sid: uuid,
  role: z.enum(USER_ROLES),
  /** Guest (anonymous) account: random mode only. */
  guest: z.boolean(),
  iss: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type RealtimeTokenClaims = z.infer<typeof realtimeTokenClaimsSchema>;
