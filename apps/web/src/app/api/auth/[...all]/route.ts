/**
 * Every Better Auth endpoint (/api/auth/*): sign-up, sign-in, sign-out, verification, password
 * reset, social sign-in callbacks, passkeys, guest sessions and the JWKS public keys.
 */
import { getAuth } from '@/server/auth-instance';

const handle = (request: Request) => getAuth().handler(request);

export const GET = handle;
export const POST = handle;
