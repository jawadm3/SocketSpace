/**
 * Pictures and link previews in the shared contracts (MSG-08, MSG-09, PROF-08): what counts as a
 * picture by its first bytes, what a message with pictures may look like, and how photo avatars
 * and previews travel.
 */
import { describe, expect, it } from 'vitest';

import { messageSendSchema, messageWireSchema } from './events';
import { extractLinks } from './markdown';
import {
  attachmentWireSchema,
  linkPreviewWireSchema,
  MEDIA_PATH_PATTERN,
  mediaPath,
  sniffImageType,
} from './media';
import { avatarWireSchema, photoAvatarSchema } from './profile';

const ID = '0192a5f0-0000-7000-8000-000000000001';
const ID2 = '0192a5f0-0000-7000-8000-000000000002';
const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((v) => (typeof v === 'number' ? [v] : Array.from(v, (c) => c.charCodeAt(0)))),
  );

describe('sniffImageType', () => {
  it('recognises the four accepted formats by their first bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('jpeg');
    expect(sniffImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('png');
    expect(sniffImageType(bytes('GIF89a', 1, 0))).toBe('gif');
    expect(sniffImageType(bytes('GIF87a', 1, 0))).toBe('gif');
    expect(sniffImageType(bytes('RIFF', 1, 2, 3, 4, 'WEBPVP8 '))).toBe('webp');
  });

  it('refuses everything else, whatever it is called', () => {
    for (const content of [
      bytes('<?php echo 1; ?>'),
      bytes('<svg xmlns="http://www.w3.org/2000/svg">'),
      bytes('<!doctype html>'),
      bytes('%PDF-1.7'),
      bytes('PK', 3, 4),
      bytes('BM', 0, 0, 0, 0),
      bytes('GIF88a'),
      bytes('RIFF', 1, 2, 3, 4, 'WAVE'),
      bytes(0xff, 0xd8),
      bytes(),
    ]) {
      expect(sniffImageType(content)).toBeNull();
    }
  });
});

describe('message:send with pictures', () => {
  const base = { conversationId: ID, clientId: ID2 };

  it('allows an empty body only when a picture is attached', () => {
    expect(messageSendSchema.safeParse({ ...base, body: '', attachmentIds: [ID] }).success).toBe(
      true,
    );
    expect(messageSendSchema.safeParse({ ...base, body: '  ', attachmentIds: [] }).success).toBe(
      false,
    );
    expect(messageSendSchema.safeParse({ ...base, body: '' }).success).toBe(false);
    expect(messageSendSchema.parse({ ...base, body: ' hi ', attachmentIds: [ID] }).body).toBe('hi');
  });

  it('refuses the same picture twice and anything that is not an ID', () => {
    expect(
      messageSendSchema.safeParse({ ...base, body: 'x', attachmentIds: [ID, ID] }).success,
    ).toBe(false);
    expect(
      messageSendSchema.safeParse({ ...base, body: 'x', attachmentIds: ['../etc/passwd'] }).success,
    ).toBe(false);
  });
});

describe('wire shapes', () => {
  it('a message carries its pictures as ID and size only', () => {
    const message = {
      id: ID,
      conversationId: ID,
      seq: 1,
      eventSeq: 1,
      authorId: ID,
      clientId: ID2,
      kind: 'text',
      body: '',
      replyToId: null,
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
      moderationState: 'visible',
      createdAt: '2026-10-03T10:00:00.000Z',
      reactions: [],
    };
    const attachment = { id: ID2, width: 640, height: 480 };
    expect(messageWireSchema.safeParse({ ...message, attachments: [attachment] }).success).toBe(
      true,
    );
    expect(messageWireSchema.safeParse(message).success).toBe(false);
    expect(
      attachmentWireSchema.safeParse({ ...attachment, url: 'https://elsewhere.example/x.webp' })
        .success,
    ).toBe(false);
    expect(attachmentWireSchema.safeParse({ ...attachment, width: 0 }).success).toBe(false);
  });

  it('a photo avatar is always a path on our own server', () => {
    expect(mediaPath(ID.toUpperCase())).toBe(`/api/media/${ID}`);
    expect(MEDIA_PATH_PATTERN.test(mediaPath(ID))).toBe(true);
    expect(avatarWireSchema.safeParse({ kind: 'photo', url: mediaPath(ID) }).success).toBe(true);
    for (const url of [
      'https://tracker.example/pixel.png',
      '//tracker.example/pixel.png',
      `/api/media/${ID}/../../users`,
      `/api/media/${ID}?next=https://evil.example`,
      'javascript:alert(1)',
    ]) {
      expect(avatarWireSchema.safeParse({ kind: 'photo', url }).success).toBe(false);
    }
    expect(photoAvatarSchema.safeParse({ attachmentId: ID }).success).toBe(true);
    expect(photoAvatarSchema.safeParse({ attachmentId: ID, url: 'x' }).success).toBe(false);
  });

  it('a link preview is text with an http(s) address, within its length limits', () => {
    const preview = { url: 'https://example.com/', title: 'T', description: null, siteName: null };
    expect(linkPreviewWireSchema.safeParse(preview).success).toBe(true);
    expect(
      linkPreviewWireSchema.safeParse({ ...preview, url: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(linkPreviewWireSchema.safeParse({ ...preview, title: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(linkPreviewWireSchema.safeParse({ ...preview, image: 'https://x/y.png' }).success).toBe(
      false,
    );
  });
});

describe('extractLinks', () => {
  it('finds http(s) links in order, once each, outside code, up to the limit', () => {
    const body = [
      'see https://one.example/a, [two](https://two.example/b) and https://one.example/a again',
      '`https://code.example/inline`',
      '```',
      'https://code.example/block',
      '```',
      '> quoted http://three.example/c',
      'javascript:alert(1) ftp://four.example https://user:pw@five.example/',
      'https://six.example/d',
    ].join('\n');
    expect(extractLinks(body, 10)).toEqual([
      'https://one.example/a',
      'https://two.example/b',
      'http://three.example/c',
      'https://six.example/d',
    ]);
    expect(extractLinks(body)).toHaveLength(3);
    expect(extractLinks('no links here')).toEqual([]);
  });
});
