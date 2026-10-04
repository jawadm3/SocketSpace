import { getAuth } from '@/server/auth-instance';
import { getDb } from '@/server/db';
import { getLogger } from '@/server/logger-instance';
import { getStorage } from '@/server/storage/instance';
import { serveMedia } from '@/server/uploads/media';

export const runtime = 'nodejs';

/** One stored picture, for people who may see it (MSG-09, PROF-08). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return serveMedia(request, id, {
    auth: getAuth(),
    db: getDb(),
    storage: getStorage(),
    logger: getLogger(),
  });
}
