/**
 * Checking the 5-minute connection token a browser presents (realtime-protocol.md, "Connecting").
 * The signature is checked against the web app's public keys (JWKS), which are fetched once and
 * cached; then issuer, audience, expiry and the claim shapes are checked.
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

import {
  realtimeTokenClaimsSchema,
  type RealtimeTokenClaims,
} from '@socketspace/shared/realtime-token';

export type KeySource = JWTVerifyGetKey;

/** The web app's JWKS endpoint, cached for 10 minutes; new keys are fetched when one is unknown. */
export function remoteKeySource(jwksUrl: string): KeySource {
  return createRemoteJWKSet(new URL(jwksUrl), {
    cacheMaxAge: 10 * 60_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });
}

export type TokenCheck =
  | { ok: true; claims: RealtimeTokenClaims }
  | { ok: false; reason: 'missing' | 'expired' | 'invalid' | 'keys_unavailable' };

export async function verifyConnectionToken(
  token: unknown,
  keys: KeySource,
  expected: { issuer: string; audience: string },
): Promise<TokenCheck> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return { ok: false, reason: 'missing' };
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: expected.issuer,
      audience: expected.audience,
      algorithms: ['EdDSA'],
      clockTolerance: 5,
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    const claims = realtimeTokenClaimsSchema.safeParse(payload);
    return claims.success ? { ok: true, claims: claims.data } : { ok: false, reason: 'invalid' };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
    if (error instanceof errors.JWKSTimeout || isFetchFailure(error)) {
      return { ok: false, reason: 'keys_unavailable' };
    }
    return { ok: false, reason: 'invalid' };
  }
}

function isFetchFailure(error: unknown): boolean {
  return error instanceof TypeError && /fetch/i.test(error.message);
}
