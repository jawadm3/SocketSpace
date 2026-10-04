import { getAuth } from '@/server/auth-instance';
import { getDb } from '@/server/db';
import { getWebEnv } from '@/server/env';
import { getLogger } from '@/server/logger-instance';
import { getStorage } from '@/server/storage/instance';
import { handleUpload } from '@/server/uploads/upload';

// sharp (the image library) needs the Node.js runtime.
export const runtime = 'nodejs';

/** Stores one picture for a message or a profile (MSG-09, PROF-08). */
export function POST(request: Request) {
  return handleUpload(request, {
    auth: getAuth(),
    db: getDb(),
    env: getWebEnv(),
    storage: getStorage(),
    logger: getLogger(),
  });
}
