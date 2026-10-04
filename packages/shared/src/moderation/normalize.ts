/**
 * The normaliser of the word-list filter (SAFE-02, security.md 4.2): it undoes the common ways of
 * disguising a word, so the list itself can hold plain lower-case words.
 *
 * - Letter case and width: capitals and full-width letters become plain lower-case letters
 *   (Unicode NFKC, lower case).
 * - Accents and invisible characters: an accented vowel, or a zero-width joiner inside a word.
 * - Look-alike letters from other alphabets: a Cyrillic or Greek letter inside a Latin word.
 * - "Leet-speak": "sh1t", "a$$", "@ss". Only in tokens that contain a letter, so a plain number
 *   such as 455 is never read as a word.
 * - Repeated letters are handled by the matcher (`runsOf`): "shiiit" matches "shit", but "as"
 *   does not match "ass", because a doubled letter in a listed word must stay at least doubled.
 *
 * This file is plain ASCII on purpose: the look-alike table is built from code points, so nobody
 * has to tell a Cyrillic letter from a Latin one by eye.
 */

/** Characters that make up a token: letters, digits, marks, invisible format characters, leet signs. */
const TOKEN = /[\p{L}\p{N}\p{M}\p{Cf}@$!|]+/gu;
const MARKS_AND_INVISIBLE = /[\p{M}\p{Cf}]/gu;
const HAS_LETTER = /\p{L}/u;
/** "!" and "|" are usually punctuation at the edges of a word ("shit!"). */
const EDGE_PUNCTUATION = /^[!|]+|[!|]+$/g;

/** Look-alike letters: [code point, the Latin letter it resembles]. */
const LOOK_ALIKES: readonly (readonly [number, string])[] = [
  // Cyrillic
  [0x0430, 'a'],
  [0x0432, 'b'],
  [0x0435, 'e'],
  [0x0451, 'e'],
  [0x043a, 'k'],
  [0x043c, 'm'],
  [0x043d, 'h'],
  [0x043e, 'o'],
  [0x0440, 'p'],
  [0x0441, 'c'],
  [0x0442, 't'],
  [0x0443, 'y'],
  [0x0445, 'x'],
  [0x0456, 'i'],
  [0x0455, 's'],
  [0x0458, 'j'],
  [0x0501, 'd'],
  [0x051b, 'q'],
  [0x051d, 'w'],
  // Greek
  [0x03b1, 'a'],
  [0x03b5, 'e'],
  [0x03b9, 'i'],
  [0x03ba, 'k'],
  [0x03bd, 'v'],
  [0x03bf, 'o'],
  [0x03c1, 'p'],
  [0x03c4, 't'],
  [0x03c5, 'u'],
  [0x03c7, 'x'],
  // Latin letters that survive accent removal
  [0x00f8, 'o'],
  [0x0131, 'i'],
  [0x0142, 'l'],
  [0x00df, 's'],
];

const LOOK_ALIKE_MAP: ReadonlyMap<string, string> = new Map(
  LOOK_ALIKES.map(([code, latin]) => [String.fromCodePoint(code), latin]),
);

/** Leet-speak signs with one reading. "1" and "|" have two (i or l) and are handled separately. */
const LEET: Readonly<Record<string, string>> = {
  '@': 'a',
  '4': 'a',
  '0': 'o',
  '3': 'e',
  '5': 's',
  $: 's',
  '7': 't',
  '!': 'i',
};

export interface Token {
  /** Position in the original text (UTF-16 units, like `String.prototype.slice`). */
  start: number;
  end: number;
  /** The readings of this token after normalising (one to four, never empty strings). */
  forms: string[];
}

function fold(raw: string, oneAs: 'i' | 'l', inWord = false): string {
  const plain = raw
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(MARKS_AND_INVISIBLE, '');
  const leet = inWord || HAS_LETTER.test(plain);
  let out = '';
  for (const char of plain) {
    const alike = LOOK_ALIKE_MAP.get(char);
    if (alike !== undefined) out += alike;
    else if (!leet) out += char;
    else if (char === '1' || char === '|') out += oneAs;
    else out += LEET[char] ?? char;
  }
  return out;
}

/**
 * Case, width, accents, invisible characters and look-alike letters undone, with digits and
 * punctuation kept as they are (no leet-speak). Used where digits matter: links, phone numbers.
 */
export function foldPlain(raw: string): string {
  const plain = raw
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(MARKS_AND_INVISIBLE, '');
  let out = '';
  for (const char of plain) out += LOOK_ALIKE_MAP.get(char) ?? char;
  return out;
}

/** One character of a spaced-out word ("s h 1 t"): read as part of a word, so leet applies. */
export function foldLetter(raw: string, oneAs: 'i' | 'l'): string {
  return fold(raw, oneAs, true);
}

/** Every reading of one raw token: with and without edge punctuation, "1" as "i" and as "l". */
export function foldToken(raw: string): string[] {
  const forms = new Set<string>();
  for (const candidate of [raw, raw.replace(EDGE_PUNCTUATION, '')]) {
    if (candidate === '') continue;
    for (const oneAs of ['i', 'l'] as const) {
      const folded = fold(candidate, oneAs);
      if (folded !== '') forms.add(folded);
    }
  }
  return [...forms];
}

/** Splits text into tokens, remembering where each one was. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const forms = foldToken(match[0]);
    if (forms.length === 0) continue;
    tokens.push({ start: match.index, end: match.index + match[0].length, forms });
  }
  return tokens;
}

export interface Runs {
  /** The word with every run of a repeated letter written once: "shiiit" and "shit" give "shit". */
  key: string;
  /** How long each run was: "ass" gives [1, 2]. */
  lengths: number[];
}

export function runsOf(word: string): Runs {
  let key = '';
  const lengths: number[] = [];
  let previous = '';
  for (const char of word) {
    if (char === previous) {
      lengths[lengths.length - 1] = (lengths[lengths.length - 1] ?? 0) + 1;
    } else {
      key += char;
      lengths.push(1);
      previous = char;
    }
  }
  return { key, lengths };
}

/**
 * True when `candidate` is `listed` with letters possibly repeated more often: same letters in
 * the same order, and every run at least as long as in the listed word.
 */
export function stretches(candidate: Runs, listed: Runs): boolean {
  if (candidate.key !== listed.key) return false;
  return listed.lengths.every((length, index) => (candidate.lengths[index] ?? 0) >= length);
}
