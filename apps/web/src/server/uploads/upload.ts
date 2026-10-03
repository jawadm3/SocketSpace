/**
 * `POST /api/uploads?kind=message|avatar`: stores one picture (MSG-09, PROF-08, SEC-12).
 *
 * The browser sends the file as the request body. The answer is the stored picture's ID and
 * size; a message then names that ID (`attachmentIds`), or the profile form does.
 *
 * In order: the request must come from our own pages; the person must be signed in with a
 * confirmed email address; at most 20 uploads an hour; at most 4 MB is read; the image pipeline
 * (image.ts) checks and re-encodes the file; only then is anything stored.
 */
import 'server-only';

import {
  createAttachment,
  getConnectionProfile,
  hitRateLimit,
  type Database,
} from '@socketspace/db';
import { LIMITS } from '@socketspace/shared/limits';
import { UPLOAD_KINDS, type UploadKind, type UploadResponse } from '@socketspace/shared/media';

import { SESSION_ABSOLUTE_MS, type Auth } from '../auth';
import type { WebEnv } from '../env';
import type { Logger } from '../log';
import { newStorageKey, type StorageDriver } from '../storage';
import { IMAGE_REFUSAL_MESSAGE, processImage, type ImageRefusal } from './image';

export interface UploadDeps {
  auth: Auth;
  db: Database;
  env: Pick<WebEnv, 'BETTER_AUTH_URL'>;
  storage: StorageDriver;
  logger?: Logger;
}

function error(status: number, code: string, message: string, retryAfterMs?: number) {
  return Response.json(
    { error: retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs } },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(retryAfterMs === undefined
          ? {}
          : { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }),
      },
    },
  );
}

const REFUSAL_STATUS: Record<ImageRefusal, number> = {
  empty: 400,
  too_large: 413,
  not_an_image: 415,
  too_many_pixels: 422,
  unreadable: 422,
};

/** Reads the body, giving up as soon as it is larger than `maxBytes` (`null`). */
async function readLimited(request: Request, maxBytes: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export async function handleUpload(request: Request, deps: UploadDeps): Promise<Response> {
  const { auth, db, env, storage } = deps;

  // Only our own pages may upload (CSRF defence; browsers always send Origin on POST).
  const ownOrigin = new URL(env.BETTER_AUTH_URL).origin;
  const site = request.headers.get('sec-fetch-site');
  if (request.headers.get('origin') !== ownOrigin || (site !== null && site !== 'same-origin')) {
    return error(403, 'FORBIDDEN', 'This request must come from SocketSpace itself.');
  }

  const current = await auth.api.getSession({ headers: request.headers });
  if (!current || Date.now() - current.session.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    return error(401, 'UNAUTHENTICATED', 'Please sign in again.');
  }
  const profile = await getConnectionProfile(db, current.user.id);
  if (profile?.status !== 'active') {
    return error(403, 'FORBIDDEN', 'This account is suspended or closed.');
  }
  if (profile.isAnonymous) {
    return error(403, 'FORBIDDEN', 'Guest accounts cannot upload pictures.');
  }
  if (!profile.emailVerified) {
    return error(403, 'FORBIDDEN', 'Confirm your email address before uploading pictures.');
  }

  const kind = new URL(request.url).searchParams.get('kind') as UploadKind | null;
  if (kind === null || !UPLOAD_KINDS.includes(kind)) {
    return error(400, 'VALIDATION', 'Say what the picture is for: "message" or "avatar".');
  }
  // A profile photo can be chosen during onboarding; pictures in messages need a finished profile.
  if (kind === 'message' && !profile.onboarded) {
    return error(403, 'FORBIDDEN', 'Finish setting up your profile first.');
  }

  // Refuse an oversized upload before reading it, when the browser says how large it is.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LIMITS.upload.maxBytes) {
    return error(413, 'VALIDATION', IMAGE_REFUSAL_MESSAGE.too_large);
  }

  // Every attempt counts, so hostile files cannot be used to keep the server busy.
  const rate = await hitRateLimit(db, `upload:${current.user.id}`, LIMITS.upload.perHour, 3600);
  if (!rate.allowed) {
    return error(
      429,
      'RATE_LIMITED',
      `You can upload ${String(LIMITS.upload.perHour)} pictures an hour. Please try again later.`,
      rate.retryAfterMs,
    );
  }

  const input = await readLimited(request, LIMITS.upload.maxBytes);
  if (input === null) return error(413, 'VALIDATION', IMAGE_REFUSAL_MESSAGE.too_large);

  const processed = await processImage(input, kind);
  if (!processed.ok) {
    return error(
      REFUSAL_STATUS[processed.reason],
      'VALIDATION',
      IMAGE_REFUSAL_MESSAGE[processed.reason],
    );
  }

  const { image } = processed;
  const storageKey = newStorageKey(kind);
  try {
    await storage.put(storageKey, image.bytes, image.mime);
  } catch (cause) {
    deps.logger?.error('upload storage failed', { driver: storage.name, error: cause });
    return error(503, 'UNAVAILABLE', 'Pictures cannot be stored right now. Please try again.');
  }
  try {
    const row = await createAttachment(db, {
      uploaderId: current.user.id,
      storageKey,
      mime: image.mime,
      width: image.width,
      height: image.height,
      bytes: image.bytes.length,
      sha256: image.sha256,
    });
    const body: UploadResponse = {
      attachment: { id: row.id, width: row.width, height: row.height },
    };
    return Response.json(body, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    // Nothing points at the stored file: remove it again.
    await storage.delete([storageKey]).catch(() => undefined);
    throw cause;
  }
}
