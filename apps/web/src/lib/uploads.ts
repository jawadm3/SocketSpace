/**
 * Uploading a picture from the browser (MSG-09, PROF-08).
 *
 * The file is checked here first (type from its first bytes, size), so most mistakes get an
 * answer at once without an upload. These checks are a convenience only: the server repeats them
 * and does the real work (apps/web/src/server/uploads).
 */
import { LIMITS } from '@socketspace/shared/limits';
import {
  sniffImageType,
  uploadResponseSchema,
  type AttachmentWire,
  type UploadKind,
} from '@socketspace/shared/media';

export type UploadResult =
  { ok: true; attachment: AttachmentWire } | { ok: false; message: string };

const MAX_MB = LIMITS.upload.maxBytes / (1024 * 1024);

/** The reason this file cannot be uploaded, or `null` if it looks fine. */
export async function precheckImage(file: Blob): Promise<string | null> {
  if (file.size === 0) return 'The file is empty.';
  if (file.size > LIMITS.upload.maxBytes) return `Pictures can be at most ${String(MAX_MB)} MB.`;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return sniffImageType(head)
    ? null
    : 'This file is not a picture we can use. Choose a JPEG, PNG, WebP or GIF.';
}

export async function uploadImage(
  file: Blob,
  kind: UploadKind,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const problem = await precheckImage(file);
  if (problem) return { ok: false, message: problem };
  let response: Response;
  try {
    response = await fetch(`/api/uploads?kind=${kind}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { ok: false, message: 'The picture could not be uploaded. Check your connection.' };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = uploadResponseSchema.safeParse(body);
    if (parsed.success) return { ok: true, attachment: parsed.data.attachment };
  }
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return {
    ok: false,
    message: typeof message === 'string' ? message : 'The picture could not be uploaded.',
  };
}
