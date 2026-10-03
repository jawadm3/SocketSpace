/**
 * `GET /api/media/<id>`: serves one stored picture, to people who may see it (MSG-09, PROF-08).
 *
 * Every request is checked: a picture in a message needs the right to read that conversation, an
 * unused upload belongs to its uploader, a profile photo needs a signed-in account. Missing,
 * deleted and "not yours" all answer "not found". Browsers keep a copy for an hour and then ask
 * again; that request is checked too, and answered "not changed" without reading the file.
 *
 * The stored file is always a WebP we encoded ourselves (image.ts); it is sent with a fixed
 * content type, "nosniff", and a policy that allows it nothing if opened as a page.
 */
import 'server-only';

import {
  deleteAttachmentRows,
  getAttachmentForViewer,
  listAttachmentGarbage,
  type Database,
} from '@socketspace/db';
import { uuid } from '@socketspace/shared/primitives';

import { SESSION_ABSOLUTE_MS, type Auth } from '../auth';
import type { Logger } from '../log';
import type { StorageDriver } from '../storage';
import { STORED_MIME } from './image';

export interface MediaDeps {
  auth: Auth;
  db: Database;
  storage: StorageDriver;
  logger?: Logger;
}

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** How long a browser may show its copy before asking again (and being checked again). */
export const MEDIA_MAX_AGE_SECONDS = 3600;

export async function serveMedia(request: Request, id: string, deps: MediaDeps): Promise<Response> {
  const current = await deps.auth.api.getSession({ headers: request.headers });
  if (!current || Date.now() - current.session.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    return new Response('Please sign in again.', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (current.user.isAnonymous || !uuid.safeParse(id).success) return notFound();

  const found = await getAttachmentForViewer(deps.db, current.user.id, id.toLowerCase());
  if (!found) return notFound();

  const headers = {
    'Cache-Control': `private, max-age=${String(MEDIA_MAX_AGE_SECONDS)}`,
    ETag: `"${found.sha256.slice(0, 32)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (request.headers.get('if-none-match') === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }

  let bytes: Buffer | null;
  try {
    bytes = await deps.storage.get(found.storageKey);
  } catch (cause) {
    deps.logger?.error('media storage read failed', { driver: deps.storage.name, error: cause });
    return new Response('Pictures cannot be loaded right now.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (!bytes) {
    deps.logger?.warn('stored picture is missing', { driver: deps.storage.name });
    return notFound();
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...headers,
      'Content-Type': STORED_MIME,
      'Content-Length': String(bytes.length),
      'Content-Disposition': 'inline; filename="picture.webp"',
    },
  });
}

/**
 * The clean-up job's work for pictures: delete the files of removed pictures and of uploads that
 * were never used, then their rows. Returns how many were deleted. (Scheduled with the retention
 * job in Stage E.)
 */
export async function collectAttachmentGarbage(
  deps: Pick<MediaDeps, 'db' | 'storage'>,
  limit = 200,
): Promise<number> {
  const garbage = await listAttachmentGarbage(deps.db, limit);
  if (garbage.length === 0) return 0;
  // Files first: a row without a file is harmless, a file without a row would stay for ever.
  await deps.storage.delete(garbage.map((g) => g.storageKey));
  await deleteAttachmentRows(
    deps.db,
    garbage.map((g) => g.id),
  );
  return garbage.length;
}
