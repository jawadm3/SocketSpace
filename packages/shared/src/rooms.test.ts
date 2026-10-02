import { describe, expect, it } from 'vitest';

import {
  createInviteSchema,
  createRoomSchema,
  INVITE_CODE_PATTERN,
  moderationReasonSchema,
  roomMuteSchema,
  roomNameSchema,
  roomSlugSchema,
  roomTopicSchema,
  slugFromName,
} from './rooms';

const ID = '0192f0c1-7a3b-7c4d-8e5f-0a1b2c3d4e5f';

describe('roomSlugSchema', () => {
  it('accepts lower-case words joined by single dashes, and lower-cases input', () => {
    expect(roomSlugSchema.parse('design-talk')).toBe('design-talk');
    expect(roomSlugSchema.parse('  Design-Talk ')).toBe('design-talk');
    expect(roomSlugSchema.parse('abc')).toBe('abc');
    expect(roomSlugSchema.parse('a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('refuses bad shapes, double dashes and reserved app words', () => {
    for (const bad of ['ab', 'a'.repeat(33), '-abc', 'abc-', 'a_b_c', 'a b c', 'a--b', 'café']) {
      expect(roomSlugSchema.safeParse(bad).success, bad).toBe(false);
    }
    for (const reserved of ['new', 'explore', 'Settings', 'admin']) {
      expect(roomSlugSchema.safeParse(reserved).success, reserved).toBe(false);
    }
  });
});

describe('slugFromName', () => {
  it('turns a name into a usable address', () => {
    expect(slugFromName('Design Talk!')).toBe('design-talk');
    expect(slugFromName('  Café   Crème  ')).toBe('cafe-creme');
    expect(slugFromName('C++ & Rust')).toBe('c-rust');
  });

  it('keeps addresses within 32 characters without a trailing dash', () => {
    const slug = slugFromName('The quick brown fox jumps over the lazy dog');
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug.endsWith('-')).toBe(false);
    expect(roomSlugSchema.safeParse(slug).success).toBe(true);
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(slugFromName('🎲🎲')).toBe('');
    expect(slugFromName('ab')).toBe('');
  });
});

describe('room names and topics', () => {
  it('fold names to one line and refuse empty or long ones', () => {
    expect(roomNameSchema.parse('  Design\n talk ')).toBe('Design talk');
    expect(roomNameSchema.safeParse('   ').success).toBe(false);
    expect(roomNameSchema.safeParse('x'.repeat(51)).success).toBe(false);
    // 50 emoji are 50 characters (code points), not 100.
    expect(roomNameSchema.safeParse('🎲'.repeat(50)).success).toBe(true);
  });

  it('allow an empty topic and refuse one over 200 characters', () => {
    expect(roomTopicSchema.parse('')).toBe('');
    expect(roomTopicSchema.safeParse('t'.repeat(201)).success).toBe(false);
  });
});

describe('createRoomSchema', () => {
  it('accepts a complete form and refuses unknown fields', () => {
    const valid = { name: 'Design', slug: 'design', topic: '', visibility: 'private' };
    expect(createRoomSchema.parse(valid)).toEqual(valid);
    expect(createRoomSchema.safeParse({ ...valid, ownerId: ID }).success).toBe(false);
    expect(createRoomSchema.safeParse({ ...valid, visibility: 'secret' }).success).toBe(false);
  });
});

describe('invites', () => {
  it('codes are exactly 22 base64url characters (128 bits)', () => {
    expect(INVITE_CODE_PATTERN.test('A'.repeat(22))).toBe(true);
    expect(INVITE_CODE_PATTERN.test('A'.repeat(21))).toBe(false);
    expect(INVITE_CODE_PATTERN.test(`${'A'.repeat(21)}+`)).toBe(false);
  });

  it('offer only the listed lifetimes and use limits', () => {
    expect(
      createInviteSchema.safeParse({ conversationId: ID, expiresIn: '1d', maxUses: '1' }).success,
    ).toBe(true);
    expect(
      createInviteSchema.safeParse({ conversationId: ID, expiresIn: '1y', maxUses: '1' }).success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({ conversationId: ID, expiresIn: '1d', maxUses: '1000' })
        .success,
    ).toBe(false);
  });
});

describe('room moderation', () => {
  it('requires a reason of 3 to 500 characters', () => {
    expect(moderationReasonSchema.safeParse('no').success).toBe(false);
    expect(moderationReasonSchema.parse('  spamming\nlinks ')).toBe('spamming links');
    expect(moderationReasonSchema.safeParse('r'.repeat(501)).success).toBe(false);
  });

  it('offers only the listed mute lengths', () => {
    const base = { conversationId: ID, userId: ID, reason: 'flooding the room' };
    expect(roomMuteSchema.safeParse({ ...base, duration: '10m' }).success).toBe(true);
    expect(roomMuteSchema.safeParse({ ...base, duration: '100y' }).success).toBe(false);
  });
});
