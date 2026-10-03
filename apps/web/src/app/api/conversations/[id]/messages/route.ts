import { getAuth } from '@/server/auth-instance';
import { getDb } from '@/server/db';
import { loadRoomHistory } from '@/server/room-history';

/** Older messages of a room or DM, for infinite scroll (HIST-02). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return loadRoomHistory(request, id, { auth: getAuth(), db: getDb() });
}
