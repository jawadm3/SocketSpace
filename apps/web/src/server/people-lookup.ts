/**
 * `GET /api/users?ids=a,b,...`: people as the signed-in viewer may see them (realtime-protocol.md,
 * "People in payloads"). Broadcasts carry nicknames only; a browser fetches each person here once,
 * and receives a real name only if that viewer is allowed to see it (D-024, security.md 3.12).
 */
import 'server-only';

import { getPublicUsers, hitRateLimit, type Database } from '@socketspace/db';
import { uuid } from '@socketspace/shared/primitives';

import { SESSION_ABSOLUTE_MS, type Auth } from './auth';

export const PEOPLE_PER_LOOKUP = 100;
export const PEOPLE_LOOKUPS_PER_MINUTE = 120;

function error(status: number, code: string, message: string, retryAfterMs?: number) {
  return Response.json(
    { error: retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function lookUpPeople(
  request: Request,
  deps: { auth: Auth; db: Database },
): Promise<Response> {
  const current = await deps.auth.api.getSession({ headers: request.headers });
  if (!current || Date.now() - current.session.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    return error(401, 'UNAUTHENTICATED', 'Please sign in again.');
  }
  if (current.user.isAnonymous || !current.user.onboardedAt) {
    return error(403, 'FORBIDDEN', 'Finish setting up your account first.');
  }

  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = raw === '' ? [] : raw.split(',');
  if (
    ids.length === 0 ||
    ids.length > PEOPLE_PER_LOOKUP ||
    !ids.every((id) => uuid.safeParse(id).success)
  ) {
    return error(400, 'VALIDATION', `Ask for 1 to ${String(PEOPLE_PER_LOOKUP)} valid user IDs.`);
  }

  const limit = await hitRateLimit(
    deps.db,
    `people:${current.user.id}`,
    PEOPLE_LOOKUPS_PER_MINUTE,
    60,
  );
  if (!limit.allowed) {
    return error(
      429,
      'RATE_LIMITED',
      'Too many requests. Please wait a moment.',
      limit.retryAfterMs,
    );
  }

  const users = await getPublicUsers(deps.db, current.user.id, ids, 'chat');
  return Response.json({ users }, { headers: { 'Cache-Control': 'private, no-store' } });
}
