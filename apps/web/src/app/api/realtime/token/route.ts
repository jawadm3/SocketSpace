import { getAuth } from '@/server/auth-instance';
import { getDb } from '@/server/db';
import { getWebEnv } from '@/server/env';
import { issueRealtimeToken } from '@/server/realtime-token';

export function POST(request: Request) {
  return issueRealtimeToken(request, { auth: getAuth(), db: getDb(), env: getWebEnv() });
}
