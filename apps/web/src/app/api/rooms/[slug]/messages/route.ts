import { getAuth } from '@/server/auth-instance';
import { getDb } from '@/server/db';
import { loadRoomHistory } from '@/server/room-history';

/** Older messages of a room, for infinite scroll (HIST-02). */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return loadRoomHistory(request, slug, { auth: getAuth(), db: getDb() });
}
