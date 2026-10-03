/**
 * The word-list filter (SAFE-02): what it must catch ("misses" would be the failure) and what it
 * must let through ("false positives" would be the failure).
 *
 * Disguised spellings that need characters outside ASCII are built from code points, so this
 * file shows exactly which characters are used.
 */
import { describe, expect, it } from 'vitest';

import { compileWordList, maskText, MASK_CHAR, moderateText, scanText } from './filter';
import { foldToken, runsOf, stretches, tokenize } from './normalize';
import { ALLOWED, FILTER_CATEGORIES, WORD_LIST } from './wordlist';

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const CYRILLIC_A = cp(0x0430);
const CYRILLIC_O = cp(0x043e);
const CYRILLIC_E = cp(0x0435);
const CYRILLIC_I = cp(0x0456);
const ZERO_WIDTH_JOINER = cp(0x200d);
const SOFT_HYPHEN = cp(0x00ad);
const COMBINING_ACUTE = cp(0x0301);
/** ASCII letters as full-width forms ("fullwidth latin small letter"). */
const fullWidth = (word: string) =>
  Array.from(word, (c) => cp((c.codePointAt(0) ?? 0) - 0x61 + 0xff41)).join('');

const severityOf = (text: string) => scanText(text).severity;

describe('the normaliser', () => {
  it('folds letter case, width, accents and invisible characters', () => {
    expect(foldToken('SHIT')).toEqual(['shit']);
    expect(foldToken(fullWidth('shit'))).toEqual(['shit']);
    expect(foldToken(`shi${COMBINING_ACUTE}t`)).toEqual(['shit']);
    expect(foldToken(`sh${ZERO_WIDTH_JOINER}it`)).toEqual(['shit']);
    expect(foldToken(`sh${SOFT_HYPHEN}it`)).toEqual(['shit']);
  });

  it('folds look-alike letters from other alphabets', () => {
    expect(foldToken(`${CYRILLIC_A}ss`)).toEqual(['ass']);
    expect(foldToken(`c${CYRILLIC_O}ck`)).toEqual(['cock']);
  });

  it('reads leet-speak only in tokens that contain a letter', () => {
    expect(foldToken('a$$')).toEqual(['ass']);
    expect(foldToken('@ss')).toEqual(['ass']);
    expect(foldToken('sh1t')).toEqual(['shit', 'shlt']);
    expect(foldToken('455')).toEqual(['455']);
    expect(foldToken('2026')).toEqual(['2026']);
  });

  it('offers a reading without punctuation at the edges', () => {
    expect(foldToken('shit!')).toContain('shit');
    expect(foldToken('!!!')).toEqual(['!!!']);
  });

  it('remembers where each token was', () => {
    expect(tokenize('oh, shit.').map((t) => [t.start, t.end])).toEqual([
      [0, 2],
      [4, 8],
    ]);
  });

  it('compares runs of repeated letters', () => {
    expect(runsOf('asss')).toEqual({ key: 'as', lengths: [1, 3] });
    expect(stretches(runsOf('shiiiit'), runsOf('shit'))).toBe(true);
    expect(stretches(runsOf('asss'), runsOf('ass'))).toBe(true);
    // A doubled letter in a listed word must stay at least doubled.
    expect(stretches(runsOf('as'), runsOf('ass'))).toBe(false);
  });
});

describe('the word list', () => {
  it('is written in the form the matcher expects', () => {
    for (const { term, severity, category } of WORD_LIST) {
      expect(term, term).toMatch(/^[a-z]+(?:[ '][a-z]+)*\*?$/);
      expect([1, 2, 3]).toContain(severity);
      expect(FILTER_CATEGORIES).toContain(category);
    }
    expect(new Set(WORD_LIST.map((e) => e.term)).size).toBe(WORD_LIST.length);
    for (const word of ALLOWED) expect(word).toMatch(/^[a-z]+$/);
  });

  it('finds every entry as it is written, with its own severity', () => {
    for (const { term, severity } of WORD_LIST) {
      const text = term.endsWith('*') ? term.slice(0, -1) : term;
      expect(severityOf(text), term).toBeGreaterThanOrEqual(severity);
    }
  });
});

describe('what the filter catches', () => {
  it.each([
    ['plain', 'what a shit day', 1],
    ['capitals', 'SHIT', 1],
    ['with punctuation', 'oh shit!', 1],
    ['plural', 'those bitches', 1],
    ['plural after s', 'asses', 1],
    ['repeated letters', 'shiiiiit', 1],
    ['repeated letters in a doubled word', 'asssss', 1],
    ['leet digits', 'sh1t', 1],
    ['leet signs', 'a$$hole', 1],
    ['leet at the start', '@sshole', 1],
    ['an accent', `sh${cp(0x00ed)}t`, 1],
    ['full-width letters', fullWidth('shit'), 1],
    ['a zero-width joiner inside', `sh${ZERO_WIDTH_JOINER}it`, 1],
    ['look-alike letters', `c${CYRILLIC_O}ck`, 1],
    ['letters spaced out', 's h i t', 1],
    ['letters with dots', 's.h.i.t', 1],
    ['letters with dashes', 's-h-i-t', 1],
    ['spaced out with a leet digit', 's h 1 t', 1],
    ['spaced out after another letter', 'u r a s h i t', 1],
    ['inside a longer word (anywhere entry)', 'motherfucker', 1],
    ['anywhere entry with repeats', 'fuuuuuck', 1],
    ['anywhere entry with an ending', 'fucking', 1],
    ['medium word', 'you slut', 2],
    ['medium phrase', 'send me a dick pic', 2],
    ['medium phrase with repeats', 'blow jobbb', 2],
    ['medium, leet', 'r3tard', 2],
    ['a phrase', 'just kill yourself', 3],
    ['a phrase across punctuation', 'kill... yourself', 3],
    ['a phrase with an apostrophe', "I'll kill you", 3],
    ['a phrase in capitals with repeats', 'KILL YOURSELFFF', 3],
    ['an abbreviation', 'kys', 3],
    ['an abbreviation spaced out', 'k y s', 3],
    ['a phrase about minors', 'looking for child porn', 3],
  ])('%s: %j', (_name, text, severity) => {
    expect(severityOf(text)).toBe(severity);
  });

  it('catches disguised high-severity slurs', () => {
    const slur = WORD_LIST.find((e) => e.term === 'nigger*');
    expect(slur?.severity).toBe(3);
    const word = 'nigger';
    const disguises = [
      word.toUpperCase(),
      `${word}s`,
      word.replace('i', '1'),
      word.replace('i', '!'),
      word.replace('e', '3'),
      word.replace('i', CYRILLIC_I).replace('e', CYRILLIC_E),
      word.replace('i', 'iiii'),
      word.replace('gg', 'gggg'),
      Array.from(word).join('.'),
      Array.from(word).join(' '),
      Array.from(word).join(ZERO_WIDTH_JOINER),
      `xx${word}xx`,
      fullWidth(word),
    ];
    for (const text of disguises) expect(severityOf(`you ${text}`), text).toBe(3);
  });

  it('reports the most severe match, the categories and the positions', () => {
    const text = 'shit, you slut';
    const result = scanText(text);
    expect(result.severity).toBe(2);
    expect(result.categories).toEqual(['harassment', 'profanity']);
    expect(result.matches.map((m) => text.slice(m.start, m.end))).toEqual(['slut', 'shit']);
  });
});

describe('what the filter lets through', () => {
  it.each([
    // The classic: place names and surnames that contain a listed word.
    'I grew up in Scunthorpe',
    'Penistone is near Sheffield',
    'Mr Cockburn and Mrs Hancock',
    'Essex, Sussex and Middlesex',
    'Arsenal won again',
    // Ordinary words that contain a listed word.
    'the class passed the bass to the assassin',
    'cocktails and a shuttlecock',
    'an analyst wrote the title of the document',
    'shiitake mushrooms',
    'the therapist will see you now',
    'grapes and drapes',
    'fire retardant paint',
    'spices and a pinch of cumin',
    'a peacock in the basement',
    'cumulative results, scum of the earth',
    // A doubled letter must stay doubled: these are not the listed word.
    'as I was saying, as usual',
    'Niger and Nigeria are countries',
    // ALLOWED: innocent words that contain an "anywhere" entry.
    'he tried not to snigger',
    'a niggardly amount',
    // Apostrophes split words; they never glue two words into a listed one.
    "who're you talking to?",
    // Numbers are not leet-speak.
    'room 455, call 5318008',
    'see you at 5 or 5:30',
    '1 2 3 4 5 6',
    // Single letters that spell nothing listed.
    'a b c d e f g',
    'e.g. the U S A',
    // Phrases need their words next to each other, in order.
    'yourself? I could kill for a coffee',
    'this workout will kill you',
    'kill the process yourself',
    // Other languages and emoji.
    `${cp(0x043d, 0x0435, 0x0442)} ${cp(0x0441, 0x043e, 0x043a)}`,
    `${cp(0x1f469)}${ZERO_WIDTH_JOINER}${cp(0x1f4bb)} hello`,
    '',
  ])('%j', (text) => {
    expect(scanText(text)).toEqual({ severity: 0, categories: [], matches: [] });
  });

  it('keeps "es" as a plural only where English does', () => {
    // "spic" is listed; "spices" must not be read as its plural, "spics" is.
    expect(severityOf('spices')).toBe(0);
    expect(severityOf('spics')).toBe(2);
  });
});

describe('masking', () => {
  it('replaces matched words with mask characters of the same length', () => {
    const text = 'you slut, what a shit day';
    const { matches } = scanText(text);
    expect(maskText(text, matches, 2)).toBe(`you ${MASK_CHAR.repeat(4)}, what a shit day`);
    expect(maskText(text, matches, 1)).toBe(
      `you ${MASK_CHAR.repeat(4)}, what a ${MASK_CHAR.repeat(4)} day`,
    );
  });

  it('keeps the spaces of a spaced-out word and of a phrase', () => {
    const text = 'k y s now';
    expect(maskText(text, scanText(text).matches, 1)).toBe(
      `${MASK_CHAR} ${MASK_CHAR} ${MASK_CHAR} now`,
    );
  });

  it('counts positions correctly after an emoji', () => {
    const text = `${cp(0x1f600)} shit`;
    expect(maskText(text, scanText(text).matches, 1)).toBe(`${cp(0x1f600)} ${MASK_CHAR.repeat(4)}`);
  });

  it('uses a character that is not a markdown-lite marker', () => {
    expect('*_~`>[]\\@').not.toContain(MASK_CHAR);
  });
});

describe('what happens to a text in each mode (security.md 4.2)', () => {
  it('community: low is allowed, medium is masked and flagged, high is blocked', () => {
    expect(moderateText('nice to meet you', 'community')).toEqual({
      action: 'allow',
      severity: 0,
      categories: [],
      text: 'nice to meet you',
      flag: false,
    });
    expect(moderateText('what a shit day', 'community')).toMatchObject({
      action: 'allow',
      severity: 1,
      text: 'what a shit day',
      flag: false,
    });
    expect(moderateText('shit, you slut', 'community')).toMatchObject({
      action: 'mask',
      severity: 2,
      // Low-severity words stay as written in community mode.
      text: `shit, you ${MASK_CHAR.repeat(4)}`,
      flag: true,
    });
    expect(moderateText('kill yourself', 'community')).toMatchObject({
      action: 'block',
      severity: 3,
      categories: ['self_harm'],
      text: '',
      flag: true,
    });
  });

  it('random mode: low is masked too', () => {
    expect(moderateText('what a shit day', 'random')).toMatchObject({
      action: 'mask',
      severity: 1,
      text: `what a ${MASK_CHAR.repeat(4)} day`,
      flag: false,
    });
    expect(moderateText('shit, you slut', 'random')).toMatchObject({
      action: 'mask',
      text: `${MASK_CHAR.repeat(4)}, you ${MASK_CHAR.repeat(4)}`,
      flag: true,
    });
    expect(moderateText('kys', 'random').action).toBe('block');
  });
});

describe('a custom list', () => {
  it('can be compiled and used instead of the built-in one', () => {
    const list = compileWordList(
      [
        { term: 'grue', severity: 2, category: 'harassment' },
        { term: 'eaten by a grue', severity: 3, category: 'threat' },
        { term: 'zork*', severity: 1, category: 'profanity' },
      ],
      ['zorkmid'],
    );
    expect(scanText('a gruesome grue', list).matches).toHaveLength(1);
    expect(scanText('you will be eaten by a grue', list).severity).toBe(3);
    expect(scanText('zorking', list).severity).toBe(1);
    expect(scanText('one zorkmid', list).severity).toBe(0);
    expect(scanText('shit', list).severity).toBe(0);
  });

  it('stays fast on the longest message', () => {
    const text = 'a s h i t '.repeat(400);
    const started = performance.now();
    expect(scanText(text).severity).toBe(1);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
