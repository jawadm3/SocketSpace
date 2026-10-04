/**
 * Links and contact details in random mode (RAND-01, security.md 4.3).
 *
 * Random chat is text only, and strangers are not meant to be moved to places nobody moderates.
 * So a random-mode message may not contain a link, an email address, a phone number or a
 * username on another app. This file finds them, including the usual disguises
 * ("example dot com", "name (at) mail (dot) com", digits spelled as words).
 *
 * Like the word list it is a baseline, not a judge: it cannot catch everything, and it is tuned
 * to leave ordinary sentences alone (see the innocent cases in contact.test.ts). The text is
 * read after `foldPlain`, so capitals, full-width letters, accents, invisible characters and
 * look-alike letters do not hide anything.
 */
import { foldPlain } from './normalize';

export type ContactKind = 'link' | 'email' | 'phone' | 'handle';

/** Endings that are not ordinary words: "something.com" is a link wherever it stands. */
const STRONG_TLDS = [
  'com',
  'net',
  'org',
  'io',
  'co',
  'gg',
  'ly',
  'app',
  'dev',
  'xyz',
  'info',
  'biz',
  'uk',
  'fr',
  'ru',
  'nl',
  'eu',
  'ca',
  'au',
  'jp',
  'cn',
  'br',
  'pl',
  'tv',
  'cc',
  'ws',
  'edu',
  'gov',
  'ai',
  'sh',
  'fm',
  'onion',
  'xxx',
];

/**
 * Endings that are also ordinary words in some language ("it", "me", "no", "de", "live").
 * A forgotten space after a full stop ("fun.in the sun") must not look like a link, so these
 * count only when a path follows: "t.me/name", "youtu.be/abc".
 */
const WORD_TLDS = [
  'me',
  'to',
  'in',
  'it',
  'is',
  'so',
  'no',
  'be',
  'at',
  'do',
  'us',
  'am',
  'as',
  'my',
  'by',
  'id',
  'de',
  'es',
  'se',
  'la',
  'le',
  'fun',
  'art',
  'one',
  'live',
  'chat',
  'club',
  'site',
  'top',
  'shop',
  'store',
  'link',
  'online',
  'blog',
  'page',
  'news',
];

/**
 * The dot of an address, plain or disguised: "a.com", "a .com", "a (dot) com", "a[.]com",
 * "a dot com". A space only after the dot ("the end. Come in") is ordinary punctuation.
 */
const ANY_DOT = String.raw`(?:\.|\s+\.\s*|\s*[(\[{]\s*(?:\.|d[o0]t)\s*[)\]}]\s*|\s+d[o0]t\s+)`;
const NOT_IN_A_WORD = '(?![a-z0-9-])';

const LINK_PATTERNS: readonly RegExp[] = [
  /(?:https?|ftp):\/\/\S/,
  /(?:^|[^a-z0-9])www\.[a-z0-9]/,
  new RegExp(`[a-z0-9]${ANY_DOT}(?:${STRONG_TLDS.join('|')})${NOT_IN_A_WORD}`),
  new RegExp(String.raw`[a-z0-9]\.(?:${WORD_TLDS.join('|')})\/\S`),
];

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/;

/** Apps people move a chat to. Names that are also everyday words ("line", "signal") are left out. */
const PLATFORMS =
  String.raw`snap(?:chat)?|insta(?:gram)?|telegram|whats\s?app|discord|kik|tiktok|twitter|` +
  'wechat|skype|viber|facebook|messenger|onlyfans';
/** Short names, only counted when a username clearly follows ("ig: name"). */
const SHORT_PLATFORMS = 'ig|tg|wa|fb';

const HANDLE_PATTERNS: readonly RegExp[] = [
  // "@name"
  /(?:^|[^a-z0-9._%+-])@[a-z0-9_.]{3,}/,
  // "name#1234"
  /[a-z0-9_.]{2,32}#\d{4}(?!\d)/,
  // "snap: name", "ig = name", "insta @name"
  new RegExp(String.raw`\b(?:${PLATFORMS}|${SHORT_PLATFORMS})\s*[:=@]\s*\S`),
  // "my insta is ...", "my telegram username is ..."
  new RegExp(
    String.raw`\bmy\s+(?:${PLATFORMS})(?:\s+(?:id|name|user(?:name)?|handle|account))?\s+is\b`,
  ),
  // "add me on snap", "hmu on insta", "find me on my telegram"
  new RegExp(
    String.raw`\b(?:(?:add|dm|message|msg|text|find|follow|contact|reach)\s+me|hmu)\b` +
      String.raw`[^.!?\n]{0,12}\b(?:on|at)\s+(?:my\s+)?(?:${PLATFORMS})\b`,
  ),
];

/** A phone number has at least this many digits (shorter runs are prices, years and times). */
const PHONE_MIN_DIGITS = 9;
const NUMBER_WORDS: ReadonlySet<string> = new Set([
  'zero',
  'oh',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
]);
/** "double five", "triple seven": part of a spoken number, counted with the digit after it. */
const NUMBER_JOINERS: ReadonlySet<string> = new Set(['double', 'triple']);
/** What may stand between the digits of a phone number: "+44 (0) 7700-900.123". */
const PHONE_SEPARATOR = /^[\s().+-]{1,3}$/;

/** Digits, written as figures or as words, with only phone-number punctuation between them. */
function hasPhoneNumber(text: string): boolean {
  let digits = 0;
  for (const [part] of text.matchAll(/\d+|[a-z]+|[^a-z\d]+/g)) {
    if (/^\d/.test(part)) digits += part.length;
    else if (NUMBER_WORDS.has(part)) digits += 1;
    else if (NUMBER_JOINERS.has(part)) continue;
    else if (PHONE_SEPARATOR.test(part) && !part.includes('\n')) continue;
    else digits = 0;
    if (digits >= PHONE_MIN_DIGITS) return true;
  }
  return false;
}

/**
 * The first kind of link or contact detail found in `text`, or `null` when there is none.
 * Never throws; an empty text gives `null`.
 */
export function findContactDetails(text: string): ContactKind | null {
  const folded = foldPlain(text);
  if (EMAIL_PATTERN.test(folded)) return 'email';
  if (LINK_PATTERNS.some((pattern) => pattern.test(folded))) return 'link';
  if (hasPhoneNumber(folded)) return 'phone';
  if (HANDLE_PATTERNS.some((pattern) => pattern.test(folded))) return 'handle';
  return null;
}
