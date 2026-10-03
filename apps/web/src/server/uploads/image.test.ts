/**
 * The image pipeline with friendly and hostile files (MSG-09, SEC-12, journey J9): real types are
 * decided from the bytes, limits hold, and what comes out is a fresh WebP with nothing carried
 * over from the original.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { LIMITS } from '@socketspace/shared/limits';

import { processImage } from './image';

const solid = (width: number, height: number, colour = { r: 200, g: 40, b: 40 }) =>
  sharp({ create: { width, height, channels: 3, background: colour } });

/** A JPEG as a phone would make it: camera details and a GPS position in its EXIF. */
const jpegWithGps = () =>
  solid(640, 480)
    .withExif({
      IFD0: { Make: 'SocketCam', Model: 'Test 1', Software: 'secret-firmware' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 2646/100',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 3995/100',
      },
    })
    .jpeg()
    .toBuffer();

async function accepted(input: Buffer, kind: 'message' | 'avatar' = 'message') {
  const result = await processImage(input, kind);
  if (!result.ok) throw new Error(`expected the picture to be accepted, got "${result.reason}"`);
  return result.image;
}

describe('what comes out', () => {
  it('turns a JPEG with GPS EXIF into a WebP with no metadata at all (J9)', async () => {
    const original = await jpegWithGps();
    const before = await sharp(original).metadata();
    // The test file really carries the data we want gone.
    expect(before.exif).toBeDefined();
    expect(original.includes('SocketCam')).toBe(true);
    expect(original.includes('secret-firmware')).toBe(true);

    const image = await accepted(original);
    const after = await sharp(image.bytes).metadata();
    expect(after.format).toBe('webp');
    expect(image.mime).toBe('image/webp');
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    for (const trace of ['Exif', 'SocketCam', 'secret-firmware', 'GPS']) {
      expect(image.bytes.includes(trace)).toBe(false);
    }
    expect(image.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect([image.width, image.height]).toEqual([640, 480]);
  });

  it('accepts PNG, WebP and GIF too, always storing WebP', async () => {
    for (const input of [
      await solid(50, 40).png().toBuffer(),
      await solid(50, 40).webp().toBuffer(),
      await solid(50, 40).gif().toBuffer(),
    ]) {
      const image = await accepted(input);
      expect((await sharp(image.bytes).metadata()).format).toBe('webp');
      expect([image.width, image.height]).toEqual([50, 40]);
    }
  });

  it('applies the camera orientation before dropping it', async () => {
    // Stored sideways (orientation 6 = "turn 90 degrees to view").
    const sideways = await solid(300, 100).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const image = await accepted(sideways);
    expect([image.width, image.height]).toEqual([100, 300]);
    expect((await sharp(image.bytes).metadata()).orientation).toBeUndefined();
  });

  it('scales a large picture down to fit and never enlarges a small one', async () => {
    const large = await accepted(await solid(4000, 2000).jpeg().toBuffer());
    expect([large.width, large.height]).toEqual([LIMITS.upload.imageMaxEdge, 800]);
    const small = await accepted(await solid(20, 10).png().toBuffer());
    expect([small.width, small.height]).toEqual([20, 10]);
  });

  it('crops an avatar to a square of the avatar size', async () => {
    const edge = LIMITS.upload.avatarEdge;
    const wide = await accepted(await solid(900, 300).jpeg().toBuffer(), 'avatar');
    expect([wide.width, wide.height]).toEqual([edge, edge]);
    const tiny = await accepted(await solid(40, 60).png().toBuffer(), 'avatar');
    expect([tiny.width, tiny.height]).toEqual([edge, edge]);
  });

  it('keeps only the first frame of an animation', async () => {
    const frame = (colour: { r: number; g: number; b: number }) =>
      solid(30, 30, colour).png().toBuffer();
    const animated = await sharp(
      [await frame({ r: 0, g: 0, b: 255 }), await frame({ r: 0, g: 255, b: 0 })],
      { join: { animated: true } },
    )
      .gif({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    const image = await accepted(animated);
    expect([image.width, image.height]).toEqual([30, 30]);
    expect((await sharp(image.bytes, { animated: true }).metadata()).pages ?? 1).toBe(1);
  });

  it('throws away anything hidden after the picture (a "polyglot" file)', async () => {
    const script = '<?php system($_GET["c"]); ?><script>alert(1)</script>';
    const polyglot = Buffer.concat([await solid(64, 64).jpeg().toBuffer(), Buffer.from(script)]);
    const image = await accepted(polyglot);
    expect(image.bytes.includes('<?php')).toBe(false);
    expect(image.bytes.includes('<script>')).toBe(false);
  });
});

describe('what is refused', () => {
  const refusal = async (input: Buffer, kind: 'message' | 'avatar' = 'message') => {
    const result = await processImage(input, kind);
    return result.ok ? 'accepted' : result.reason;
  };

  it('a PHP file renamed to .png (J9): the name plays no part, the bytes decide', async () => {
    expect(await refusal(Buffer.from('<?php system($_GET["c"]); ?>'))).toBe('not_an_image');
  });

  it.each([
    [
      'an SVG with a script',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ],
    ['an HTML page', '<!doctype html><html><body><img src=x onerror=alert(1)></body></html>'],
    ['a PDF', '%PDF-1.7\n1 0 obj\n<<>>\nendobj'],
    ['a ZIP archive', 'PK\u0003\u0004 some archive bytes'],
    ['a Windows program', 'MZ\u0090\u0000 this program cannot be run in DOS mode'],
    ['plain text', 'just some words'],
  ])('%s', async (_name, content) => {
    expect(await refusal(Buffer.from(content, 'latin1'))).toBe('not_an_image');
  });

  it('files that only start like a picture', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await refusal(Buffer.concat([png, Buffer.from('<?php echo 1; ?>')]))).toBe('unreadable');
    expect(await refusal(Buffer.from('GIF89a<script>alert(1)</script>'))).toBe('unreadable');
    expect(
      await refusal(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])),
    ).toBe('unreadable');
    expect(await refusal(Buffer.from('RIFF\u0010\u0000\u0000\u0000WEBPnot really', 'latin1'))).toBe(
      'unreadable',
    );
  });

  it('a picture cut off half way', async () => {
    const whole = await solid(800, 800).jpeg().toBuffer();
    expect(await refusal(whole.subarray(0, Math.floor(whole.length / 2)))).toBe('unreadable');
  });

  it('a 30-megapixel picture (J9)', async () => {
    const huge = await solid(6000, 5000).png({ compressionLevel: 1 }).toBuffer();
    expect(huge.length).toBeLessThan(LIMITS.upload.maxBytes);
    expect(await refusal(huge)).toBe('too_many_pixels');
  });

  it('a tiny file that claims enormous dimensions (a decompression bomb)', async () => {
    const png = await solid(8, 8).png().toBuffer();
    // The size is written in the first chunk (IHDR): 4 bytes of width and of height at 16 and 20.
    const forged = Buffer.from(png);
    forged.writeUInt32BE(60_000, 16);
    forged.writeUInt32BE(60_000, 20);
    expect(['too_many_pixels', 'unreadable']).toContain(await refusal(forged));
  });

  it('a 6 MB file (J9) and an empty one', async () => {
    const big = Buffer.concat([
      await solid(10, 10).png().toBuffer(),
      Buffer.alloc(6 * 1024 * 1024),
    ]);
    expect(await refusal(big)).toBe('too_large');
    expect(await refusal(Buffer.alloc(0))).toBe('empty');
  });
});
