import { describe, expect, it } from 'vitest';

import {
  AVATAR_STYLES,
  avatarConfigSchema,
  nicknameBase,
  nicknameSchema,
  realNameForViewer,
  realNameSchema,
  suggestNicknames,
  type RealNameSource,
} from './profile';

describe('nicknameSchema', () => {
  it.each(['ava', 'Sam_O', 'night.owl', 'k-9', 'a'.repeat(24), 'abc123'])('accepts %j', (value) => {
    expect(nicknameSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['ab', 'too short'],
    ['a'.repeat(25), 'too long'],
    ['_ava', 'starts with punctuation'],
    ['ava-', 'ends with punctuation'],
    ['a va', 'space'],
    ['ava!', 'symbol'],
    ['аva', 'Cyrillic look-alike letter'],
    ['Admin', 'reserved (any case)'],
    ['SocketSpace', 'reserved brand name'],
    ['stranger', 'reserved random-mode alias'],
  ])('refuses %j (%s)', (value) => {
    expect(nicknameSchema.safeParse(value).success).toBe(false);
  });

  it('trims surrounding spaces before checking', () => {
    expect(nicknameSchema.parse('  maple  ')).toBe('maple');
  });
});

describe('nickname suggestions', () => {
  it('derives a usable base from names and email parts', () => {
    expect(nicknameBase('Zoë Ångström')).toBe('ZoeAngstrom');
    expect(nicknameBase('ab')).toBe('abfriend');
    expect(nicknameBase('')).toBe('friend');
    expect(nicknameBase('__x__')).toMatch(/^[A-Za-z0-9]/);
  });

  it('produces only valid, distinct candidates', () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const suggestions = suggestNicknames('maple', 5, random);
    expect(suggestions.length).toBeGreaterThanOrEqual(5);
    expect(new Set(suggestions).size).toBe(suggestions.length);
    for (const s of suggestions) {
      expect(nicknameSchema.safeParse(s).success).toBe(true);
      expect(s.startsWith('maple')).toBe(true);
    }
  });

  it('keeps long bases within 24 characters', () => {
    for (const s of suggestNicknames('a'.repeat(40))) expect(s.length).toBeLessThanOrEqual(24);
  });
});

describe('realNameSchema', () => {
  it('normalises to one line and allows empty (no real name)', () => {
    expect(realNameSchema.parse('  Ava \n Chen ')).toBe('Ava Chen');
    expect(realNameSchema.parse('')).toBe('');
  });

  it('refuses more than 60 characters', () => {
    expect(realNameSchema.safeParse('x'.repeat(61)).success).toBe(false);
  });
});

describe('avatarConfigSchema', () => {
  it('accepts a CC0 style with a seed and simple options', () => {
    const config = { style: 'notionists', seed: 'maple', options: { flip: true, scale: 90 } };
    expect(avatarConfigSchema.parse(config)).toEqual(config);
  });

  it('refuses styles outside the CC0 list and unknown fields', () => {
    expect(avatarConfigSchema.safeParse({ style: 'adventurer', seed: 'x' }).success).toBe(false);
    expect(avatarConfigSchema.safeParse({ style: 'avataaars', seed: 'x' }).success).toBe(false);
    expect(
      avatarConfigSchema.safeParse({ style: 'lorelei', seed: 'x', url: 'https://x' }).success,
    ).toBe(false);
  });

  it('refuses option keys that could reach object internals', () => {
    expect(
      avatarConfigSchema.safeParse({ style: 'lorelei', seed: 'x', options: { __proto__x: 1 } })
        .success,
    ).toBe(false);
  });

  it('lists exactly the 42 CC0 styles', () => {
    expect(AVATAR_STYLES).toHaveLength(42);
    expect(new Set(AVATAR_STYLES).size).toBe(42);
  });
});

describe('realNameForViewer (D-024)', () => {
  const stranger = { isSelf: false, isContact: false };
  const contact = { isSelf: false, isContact: true };
  const self = { isSelf: true, isContact: false };
  const person = (overrides: Partial<RealNameSource>): RealNameSource => ({
    name: 'Ava Chen',
    realNameVisibility: 'nobody',
    nameDisplay: 'both',
    ...overrides,
  });

  // [visibility, display, viewer, context, expected]
  const TABLE = [
    ['nobody', 'both', stranger, 'chat', undefined],
    ['nobody', 'both', contact, 'profile', undefined],
    ['contacts', 'both', stranger, 'chat', undefined],
    ['contacts', 'both', contact, 'chat', 'Ava Chen'],
    ['contacts', 'nickname', contact, 'chat', undefined],
    ['contacts', 'nickname', contact, 'profile', 'Ava Chen'],
    ['everyone', 'real_name', stranger, 'chat', 'Ava Chen'],
    ['everyone', 'nickname', stranger, 'chat', undefined],
    ['everyone', 'nickname', stranger, 'profile', 'Ava Chen'],
    ['nobody', 'nickname', self, 'chat', 'Ava Chen'],
  ] as const;

  it.each(TABLE)(
    'visibility=%s display=%s → %#',
    (visibility, display, viewer, context, expected) => {
      expect(
        realNameForViewer(
          person({ realNameVisibility: visibility, nameDisplay: display }),
          viewer,
          context,
        ),
      ).toBe(expected);
    },
  );

  it('never returns an empty real name', () => {
    expect(
      realNameForViewer(
        person({ name: '  ', realNameVisibility: 'everyone' }),
        stranger,
        'profile',
      ),
    ).toBeUndefined();
  });
});
