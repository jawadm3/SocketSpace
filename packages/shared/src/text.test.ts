import { describe, expect, it } from 'vitest';

import { codePointLength, normalizeSingleLine, normalizeText } from './text';

describe('normalizeText', () => {
  it('composes Unicode to NFC so the same letter is stored one way', () => {
    const decomposed = 'Cafe\u0301'; // "e" + combining acute accent
    expect(normalizeText(decomposed)).toBe('Café');
    expect(normalizeText(decomposed)).toBe(normalizeText('Café'));
  });

  it('converts CRLF and CR line endings to LF', () => {
    expect(normalizeText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('removes control characters but keeps tabs and newlines', () => {
    expect(normalizeText('a\u0000b\u0007c\td\ne\u007f')).toBe('abc\td\ne');
  });

  it('removes bidi overrides used to disguise text ("Trojan Source")', () => {
    // Displays as "exe.txt" in some renderers, while the stored text ends in "txt.exe".
    const disguised = 'invoice\u202Etxt.exe';
    expect(normalizeText(disguised)).toBe('invoicetxt.exe');
    expect(normalizeText('a\u2066b\u2069c\u200Fd\uFEFF')).toBe('abcd');
  });

  it('keeps the zero-width joiner that emoji sequences need', () => {
    const family = '👩\u200D👩\u200D👧';
    expect(normalizeText(family)).toBe(family);
  });
});

describe('normalizeSingleLine', () => {
  it('folds all whitespace runs to one space and trims', () => {
    expect(normalizeSingleLine('  Ava \n\t Chen  ')).toBe('Ava Chen');
  });
});

describe('codePointLength', () => {
  it('counts emoji as one character, like PostgreSQL char_length', () => {
    expect('😀'.length).toBe(2);
    expect(codePointLength('😀')).toBe(1);
    expect(codePointLength('héllo')).toBe(5);
  });
});
