/**
 * The word-list filter (SAFE-02, security.md 4.2): finds listed words in a text, says how severe
 * the worst one is, and decides what happens to the text in each mode.
 *
 * Matching is done on whole tokens, which is what avoids the "Scunthorpe problem" (an innocent
 * word that happens to contain a listed one). Four things are looked for:
 *
 * 1. a token that is a listed word, with letters possibly repeated and an optional plural ending;
 * 2. a token that contains a `*` entry ("anywhere" entries), unless the token is in ALLOWED;
 * 3. single letters with separators between them ("s h i t", "s.h.i.t") that spell a listed word;
 * 4. a listed phrase as consecutive tokens ("kill yourself").
 *
 * It is a baseline, not a judge: it cannot read context, and a determined person can get round
 * it. Reports (SAFE-01) and moderators cover what it misses.
 */
import { foldLetter, runsOf, stretches, tokenize, type Runs, type Token } from './normalize';
import {
  ALLOWED,
  WORD_LIST,
  type FilterCategory,
  type FilterSeverity,
  type WordListEntry,
} from './wordlist';

export interface FilterMatch {
  /** Position in the original text (UTF-16 units, like `String.prototype.slice`). */
  start: number;
  end: number;
  severity: FilterSeverity;
  category: FilterCategory;
}

export interface FilterResult {
  /** The highest severity found; 0 when nothing matched. */
  severity: 0 | FilterSeverity;
  /** Categories of the matches, most severe first, each once. */
  categories: FilterCategory[];
  matches: FilterMatch[];
}

interface Listed {
  runs: Runs;
  severity: FilterSeverity;
  category: FilterCategory;
}

interface Phrase {
  words: Runs[];
  severity: FilterSeverity;
  category: FilterCategory;
}

interface Anywhere {
  pattern: RegExp;
  /** The same pattern for finding every occurrence in a long string. */
  global: RegExp;
  severity: FilterSeverity;
  category: FilterCategory;
}

interface Compiled {
  /** Whole-token entries by their key (the word with repeated letters written once). */
  words: Map<string, Listed[]>;
  /** Phrases by the key of their first word. */
  phrases: Map<string, Phrase[]>;
  anywhere: Anywhere[];
  allowed: Set<string>;
}

/** Longest run of spaced-out single letters that is read as one word. */
const SPELLED_MAX = 16;
const SPELLED_MIN = 3;
/** Characters allowed between spaced-out letters ("s h i t", "s. h. i. t"). */
const SPELLED_GAP = 3;

function add<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function compileWordList(
  list: readonly WordListEntry[],
  allowed: readonly string[] = [],
): Compiled {
  const compiled: Compiled = {
    words: new Map(),
    phrases: new Map(),
    anywhere: [],
    allowed: new Set(allowed.map((word) => runsOf(word).key)),
  };
  for (const { term, severity, category } of list) {
    if (term.endsWith('*')) {
      const runs = runsOf(term.slice(0, -1));
      // Letters only (checked by a test), so nothing needs escaping. A doubled letter must stay
      // at least doubled: "nigger*" does not match "Nigeria".
      const source = Array.from(runs.key)
        .map((char, index) => `${char}${(runs.lengths[index] ?? 1) > 1 ? '{2,}' : '+'}`)
        .join('');
      compiled.anywhere.push({
        pattern: new RegExp(source),
        global: new RegExp(source, 'g'),
        severity,
        category,
      });
      continue;
    }
    // Phrases are split exactly like messages, so "i'll" in the list is "i" + "ll" in both.
    const words = tokenize(term).map((token) => runsOf(token.forms[0] ?? ''));
    const first = words[0];
    if (!first) continue;
    if (words.length === 1) add(compiled.words, first.key, { runs: first, severity, category });
    else add(compiled.phrases, first.key, { words, severity, category });
  }
  return compiled;
}

const DEFAULT_LIST = compileWordList(WORD_LIST, ALLOWED);

/** The readings of a word without a plural ending: "bitches" gives "bitch", "asses" gives "ass". */
function singulars(form: string): string[] {
  const out: string[] = [];
  const s = /s+$/.exec(form);
  if (s && s.index > 0) out.push(form.slice(0, s.index));
  const es = /e+s+$/.exec(form);
  if (es && es.index > 0) {
    const stem = form.slice(0, es.index);
    // "es" is a plural only after these endings: "spices" is not "spic" + "es".
    if (/(?:s|x|z|ch|sh)$/.test(stem)) out.push(stem);
  }
  return out;
}

function worst<T extends { severity: FilterSeverity }>(found: readonly T[]): T | undefined {
  return found.reduce<T | undefined>(
    (best, item) => (!best || item.severity > best.severity ? item : best),
    undefined,
  );
}

/** The most severe entry a single word (in any of its readings) matches, if any. */
function matchWord(
  compiled: Compiled,
  forms: readonly string[],
): { severity: FilterSeverity; category: FilterCategory } | undefined {
  const found: { severity: FilterSeverity; category: FilterCategory }[] = [];
  for (const form of forms) {
    const runs = runsOf(form);
    for (const candidate of [runs, ...singulars(form).map(runsOf)]) {
      for (const listed of compiled.words.get(candidate.key) ?? []) {
        if (stretches(candidate, listed.runs)) {
          found.push({ severity: listed.severity, category: listed.category });
        }
      }
    }
    if (!compiled.allowed.has(runs.key)) {
      for (const entry of compiled.anywhere) {
        if (entry.pattern.test(form)) {
          found.push({ severity: entry.severity, category: entry.category });
        }
      }
    }
  }
  return worst(found);
}

function matchPhrases(compiled: Compiled, tokens: readonly Token[], at: number): FilterMatch[] {
  const matches: FilterMatch[] = [];
  const first = tokens[at];
  if (!first) return matches;
  const equals = (token: Token | undefined, word: Runs) =>
    token?.forms.some((form) => stretches(runsOf(form), word)) ?? false;
  for (const key of new Set(first.forms.map((form) => runsOf(form).key))) {
    for (const phrase of compiled.phrases.get(key) ?? []) {
      const last = tokens[at + phrase.words.length - 1];
      if (last && phrase.words.every((word, offset) => equals(tokens[at + offset], word))) {
        matches.push({
          start: first.start,
          end: last.end,
          severity: phrase.severity,
          category: phrase.category,
        });
      }
    }
  }
  return matches;
}

/**
 * Single letters with at most a few separator characters between them: "s h i t", "s.h.i.t".
 *
 * Every stretch of 3 to 16 such letters is read as one word. The work per letter is a few map
 * look-ups (the run of repeated letters is extended one letter at a time), so a message made of
 * nothing but single letters stays cheap.
 */
function matchSpelled(compiled: Compiled, text: string, tokens: readonly Token[]): FilterMatch[] {
  const matches: FilterMatch[] = [];
  const isLetter = (token: Token) => token.forms.every((form) => form.length === 1);
  let runStart = 0;
  while (runStart < tokens.length) {
    const head = tokens[runStart];
    if (!head || !isLetter(head)) {
      runStart += 1;
      continue;
    }
    let runEnd = runStart + 1;
    for (; runEnd < tokens.length; runEnd++) {
      const previous = tokens[runEnd - 1];
      const next = tokens[runEnd];
      if (!previous || !next || !isLetter(next)) break;
      const gap = text.slice(previous.end, next.start);
      if (gap.length > SPELLED_GAP || gap.includes('\n')) break;
    }
    const letters = tokens.slice(runStart, runEnd);
    if (letters.length >= SPELLED_MIN) {
      // Read as part of a word, so "s h 1 t" is read like "sh1t" ("1" as "i", then as "l").
      const readings = new Map<string, string[]>();
      for (const oneAs of ['i', 'l'] as const) {
        const reading = letters.map((t) => foldLetter(text.slice(t.start, t.end), oneAs));
        readings.set(reading.join(''), reading);
      }
      for (const [joined, reading] of readings) {
        matches.push(...spelledWords(compiled, letters, reading));
        matches.push(...spelledAnywhere(compiled, letters, reading, joined));
      }
    }
    runStart = runEnd;
  }
  return matches;
}

function spelledWords(
  compiled: Compiled,
  letters: readonly Token[],
  reading: readonly string[],
): FilterMatch[] {
  const matches: FilterMatch[] = [];
  for (let from = 0; from + SPELLED_MIN <= letters.length; from++) {
    const runs: Runs = { key: '', lengths: [] };
    let previous = '';
    const limit = Math.min(letters.length, from + SPELLED_MAX);
    for (let to = from; to < limit; to++) {
      for (const char of reading[to] ?? '') {
        if (char === previous) {
          runs.lengths[runs.lengths.length - 1] = (runs.lengths[runs.lengths.length - 1] ?? 0) + 1;
        } else {
          runs.key += char;
          runs.lengths.push(1);
          previous = char;
        }
      }
      if (to - from + 1 < SPELLED_MIN) continue;
      const first = letters[from];
      const last = letters[to];
      for (const listed of compiled.words.get(runs.key) ?? []) {
        if (first && last && stretches(runs, listed.runs)) {
          matches.push({
            start: first.start,
            end: last.end,
            severity: listed.severity,
            category: listed.category,
          });
        }
      }
    }
  }
  return matches;
}

function spelledAnywhere(
  compiled: Compiled,
  letters: readonly Token[],
  reading: readonly string[],
  joined: string,
): FilterMatch[] {
  const matches: FilterMatch[] = [];
  // Which letter each character of the joined word came from.
  const owner: number[] = [];
  reading.forEach((chars, index) => {
    for (const _ of chars) owner.push(index);
  });
  for (const entry of compiled.anywhere) {
    for (const found of joined.matchAll(entry.global)) {
      const first = letters[owner[found.index] ?? 0];
      const last = letters[owner[found.index + found[0].length - 1] ?? 0];
      if (first && last) {
        matches.push({
          start: first.start,
          end: last.end,
          severity: entry.severity,
          category: entry.category,
        });
      }
    }
  }
  return matches;
}

const SEVERITY_ORDER = (a: FilterMatch, b: FilterMatch) =>
  b.severity - a.severity || a.start - b.start;

/** Finds listed words and phrases in `text`. Never throws; an empty text gives severity 0. */
export function scanText(text: string, compiled: Compiled = DEFAULT_LIST): FilterResult {
  const tokens = tokenize(text);
  const matches: FilterMatch[] = [];
  tokens.forEach((token, index) => {
    const hit = matchWord(compiled, token.forms);
    if (hit) matches.push({ start: token.start, end: token.end, ...hit });
    matches.push(...matchPhrases(compiled, tokens, index));
  });
  matches.push(...matchSpelled(compiled, text, tokens));
  matches.sort(SEVERITY_ORDER);
  const top = matches[0];
  return {
    severity: top ? top.severity : 0,
    categories: [...new Set(matches.map((m) => m.category))],
    matches,
  };
}

/** The character matched words are replaced with. Not a markdown-lite marker, unlike "*". */
export const MASK_CHAR = String.fromCodePoint(0x2022);

/** Replaces every match of at least `minSeverity` with mask characters of the same length. */
export function maskText(
  text: string,
  matches: readonly FilterMatch[],
  minSeverity: FilterSeverity,
): string {
  const chars = Array.from(text);
  // Matches are in UTF-16 units; walk the code points with a running UTF-16 position.
  const masked: boolean[] = [];
  let position = 0;
  chars.forEach((char, index) => {
    masked[index] = matches.some(
      (m) => m.severity >= minSeverity && position >= m.start && position < m.end,
    );
    position += char.length;
  });
  return chars
    .map((char, index) => (masked[index] && !/\s/.test(char) ? MASK_CHAR : char))
    .join('');
}

export const MODERATION_MODES = ['community', 'random'] as const;
export type ModerationMode = (typeof MODERATION_MODES)[number];

export interface TextVerdict {
  /** `allow`: show as written. `mask`: show `text` (masked). `block`: do not deliver at all. */
  action: 'allow' | 'mask' | 'block';
  severity: 0 | FilterSeverity;
  categories: FilterCategory[];
  /** What other people may see: the original text, or the masked text. Empty when blocked. */
  text: string;
  /** Medium and high matches are put in front of a moderator. */
  flag: boolean;
}

/** Lowest severity that is masked in each mode (security.md 4.2); high is always blocked. */
const MASK_FROM: Record<ModerationMode, FilterSeverity> = { community: 2, random: 1 };

/**
 * What the filter decides for a text (security.md 4.2):
 *
 * | Severity | Community rooms and DMs | Random mode         |
 * | -------- | ----------------------- | ------------------- |
 * | low      | allowed                 | masked              |
 * | medium   | masked, flagged         | masked, flagged     |
 * | high     | blocked, flagged        | blocked, flagged    |
 */
export function moderateText(text: string, mode: ModerationMode): TextVerdict {
  const { severity, categories, matches } = scanText(text);
  const flag = severity >= 2;
  if (severity === 3) return { action: 'block', severity, categories, text: '', flag };
  if (severity >= MASK_FROM[mode]) {
    return {
      action: 'mask',
      severity,
      categories,
      text: maskText(text, matches, MASK_FROM[mode]),
      flag,
    };
  }
  return { action: 'allow', severity, categories, text, flag };
}
