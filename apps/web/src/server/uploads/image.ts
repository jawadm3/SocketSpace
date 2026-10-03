/**
 * The image pipeline (MSG-09, PROF-08, SEC-12; security.md 3.7). Every uploaded picture goes
 * through here before anything is stored:
 *
 * 1. Size: at most 4 MB.
 * 2. Type: decided from the file's first bytes ("magic bytes"), never its name or the browser's
 *    claim. Only JPEG, PNG, WebP and GIF are accepted.
 * 3. Decoding: the picture must really decode as that type, with at most 25 million pixels (a
 *    tiny file can claim to be enormous: a "decompression bomb").
 * 4. Re-encoding: the pixels are drawn again into a brand-new WebP file. Nothing else from the
 *    original survives: no EXIF (camera, date, GPS location), no colour profile, no comments, and
 *    no extra data hidden after the picture (a "polyglot" file that is also a script or archive).
 *
 * Only the new file is stored and served. The original is dropped.
 */
import 'server-only';

import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { LIMITS } from '@socketspace/shared/limits';
import { sniffImageType, type UploadKind } from '@socketspace/shared/media';

// One picture at a time and no cache: predictable memory on a small server.
sharp.cache(false);
sharp.concurrency(1);

export const STORED_MIME = 'image/webp';
const WEBP_QUALITY = 82;
/** A picture that takes longer than this to process is refused. */
const PROCESS_SECONDS = 10;

export type ImageRefusal =
  'empty' | 'too_large' | 'not_an_image' | 'too_many_pixels' | 'unreadable';

/** What the person is told. Plain words, no internals. */
export const IMAGE_REFUSAL_MESSAGE: Record<ImageRefusal, string> = {
  empty: 'The file is empty.',
  too_large: `Pictures can be at most ${String(LIMITS.upload.maxBytes / (1024 * 1024))} MB.`,
  not_an_image: 'This file is not a picture we can use. Choose a JPEG, PNG, WebP or GIF.',
  too_many_pixels: `This picture is too large (more than ${String(LIMITS.upload.maxPixels / 1_000_000)} megapixels).`,
  unreadable: 'This picture could not be read. It may be damaged.',
};

export interface ProcessedImage {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
  mime: typeof STORED_MIME;
}

export type ProcessResult =
  { ok: true; image: ProcessedImage } | { ok: false; reason: ImageRefusal };

const refuse = (reason: ImageRefusal): ProcessResult => ({ ok: false, reason });

function open(input: Buffer, limitInputPixels: number | false = LIMITS.upload.maxPixels) {
  return sharp(input, {
    // Refuse damaged and cut-off files instead of guessing at the missing part.
    failOn: 'error',
    limitInputPixels,
    sequentialRead: true,
    // GIF and WebP animations: the first frame only.
    animated: false,
  });
}

/** Checks and re-encodes one uploaded file. Never throws for bad input. */
export async function processImage(input: Buffer, kind: UploadKind): Promise<ProcessResult> {
  if (input.length === 0) return refuse('empty');
  if (input.length > LIMITS.upload.maxBytes) return refuse('too_large');
  const sniffed = sniffImageType(input);
  if (!sniffed) return refuse('not_an_image');

  let width: number;
  let height: number;
  try {
    // Reading the header decodes no pixels, so no pixel limit is needed here; the size it
    // states is checked below, and the decoder enforces the same limit again.
    const metadata = await open(input, false).metadata();
    // The decoder must agree with the signature (a file starting like one type but built as
    // another is not something to trust).
    if (metadata.format !== sniffed) return refuse('not_an_image');
    width = metadata.width;
    height = metadata.height;
  } catch {
    return refuse('unreadable');
  }
  if (!(width > 0 && height > 0)) return refuse('unreadable');
  if (width * height > LIMITS.upload.maxPixels) return refuse('too_many_pixels');

  try {
    const pipeline = open(input)
      // Turn the picture the way the camera meant it (EXIF orientation), then forget the EXIF.
      .autoOrient()
      .timeout({ seconds: PROCESS_SECONDS });
    const sized =
      kind === 'avatar'
        ? pipeline.resize({
            width: LIMITS.upload.avatarEdge,
            height: LIMITS.upload.avatarEdge,
            fit: 'cover',
            position: 'centre',
          })
        : pipeline.resize({
            width: LIMITS.upload.imageMaxEdge,
            height: LIMITS.upload.imageMaxEdge,
            fit: 'inside',
            withoutEnlargement: true,
          });
    // sharp writes no metadata unless asked to, so the output carries only pixels.
    const { data, info } = await sized
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      image: {
        bytes: data,
        width: info.width,
        height: info.height,
        sha256: createHash('sha256').update(data).digest('hex'),
        mime: STORED_MIME,
      },
    };
  } catch {
    return refuse('unreadable');
  }
}
