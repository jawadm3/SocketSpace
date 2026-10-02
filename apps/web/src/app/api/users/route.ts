import { getAuth } from '@/server/auth-instance';
import { getDb } from '@/server/db';
import { lookUpPeople } from '@/server/people-lookup';

export function GET(request: Request) {
  return lookUpPeople(request, { auth: getAuth(), db: getDb() });
}
