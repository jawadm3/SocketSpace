/**
 * Pictures and link previews as browsers receive them (MSG-08, MSG-09, PROF-08).
 *
 * - A picture travels as its ID and size only. Browsers load it from our own `/api/media/<id>`,
 *   which checks on every request that this viewer may see it; no storage address ever reaches a
 *   browser.
 * - A link preview is text only (title, description, site name): no image, so showing a preview
 *   never makes a browser contact the linked site.
 * - The file type is decided from the first bytes of the file ("magic bytes"), never from its name
 *   or from what the browser claims.
 */
import { z } from 'zod';

import { LIMITS } from './limits';
import { uuid } from './primitives';

export const IMAGE_TYPES = ['jpeg', 'png', 'webp', 'gif'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** What the file picker offers. The server decides from the bytes, whatever was picked. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((value, index) => bytes[offset + index] === value);

/**
 * The picture format these bytes start with, or `null` when it is not one we accept. Only the
 * signature is read here; the server then decodes the whole file, which is the real test.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // "GIF87a" or "GIF89a"
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'gif';
  }
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp';
  return null;
}

/** What an upload is for: a picture in a message, or a profile photo. */
export const UPLOAD_KINDS = ['message', 'avatar'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** A stored picture attached to a message. */
export const attachmentWireSchema = z.strictObject({
  id: uuid,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type AttachmentWire = z.infer<typeof attachmentWireSchema>;

/** The answer of `POST /api/uploads`. */
export const uploadResponseSchema = z.strictObject({ attachment: attachmentWireSchema });
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

/** Where browsers load a stored picture from: always our own server. */
export const MEDIA_PATH_PATTERN =
  /^\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function mediaPath(attachmentId: string): string {
  return `/api/media/${attachmentId.toLowerCase()}`;
}

/** A text-only link preview. */
export const linkPreviewWireSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  title: z.string().max(LIMITS.linkPreview.titleMax),
  description: z.string().max(LIMITS.linkPreview.descriptionMax).nullable(),
  siteName: z.string().max(LIMITS.linkPreview.siteNameMax).nullable(),
});
export type LinkPreviewWire = z.infer<typeof linkPreviewWireSchema>;

/** The answer of `GET /api/messages/<id>/previews`. */
export const linkPreviewsResponseSchema = z.strictObject({
  previews: z.array(linkPreviewWireSchema).max(LIMITS.linkPreview.perMessage),
  /** A link is being fetched for someone else right now: ask again in a moment. */
  pending: z.boolean().optional(),
});
export type LinkPreviewsResponse = z.infer<typeof linkPreviewsResponseSchema>;
