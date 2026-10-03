/**
 * The word list of the content filter (SAFE-02, security.md 4.2).
 *
 * **This file contains offensive words, because recognising them is its job.** It is a small
 * baseline, not a complete list: it exists so that the worst abuse is stopped without waiting
 * for a person, and everything else can be reported (SAFE-01).
 *
 * Three severities:
 *   1 (low)    mild profanity: allowed in community rooms, masked in random mode;
 *   2 (medium) harassment and sexual terms, and slurs that also have an innocent meaning
 *              somewhere (a British cigarette, a Spanish nickname): masked and flagged, so a
 *              person decides;
 *   3 (high)   slurs with no innocent use, threats, urging self-harm, sexual content involving
 *              minors: blocked and flagged.
 *
 * How to write an entry:
 *   - plain lower-case letters; the normaliser (normalize.ts) undoes capitals, accents,
 *     look-alike letters, leet-speak and repeated letters;
 *   - a word matches whole tokens only ("ass" does not match "class" or "Scunthorpe"); plurals
 *     with "s" (and "es" after s, x, z, ch, sh) match too;
 *   - a trailing `*` means "anywhere inside a token" ("fuck*" also matches "motherfucker"); use
 *     it only when no innocent word contains the letters, and list the exceptions in ALLOWED;
 *   - several words separated by spaces are a phrase, matched as consecutive tokens.
 */
export const FILTER_CATEGORIES = [
  'profanity',
  'sexual',
  'harassment',
  'hate',
  'threat',
  'self_harm',
  'minors',
] as const;

export type FilterCategory = (typeof FILTER_CATEGORIES)[number];
export type FilterSeverity = 1 | 2 | 3;

export interface WordListEntry {
  term: string;
  severity: FilterSeverity;
  category: FilterCategory;
}

const entries = (
  severity: FilterSeverity,
  category: FilterCategory,
  terms: readonly string[],
): WordListEntry[] => terms.map((term) => ({ term, severity, category }));

export const WORD_LIST: readonly WordListEntry[] = [
  ...entries(1, 'profanity', [
    'fuck*',
    'shit',
    'shitty',
    'shitting',
    'shite',
    'shithead',
    'shitshow',
    'bullshit',
    'horseshit',
    'dipshit',
    'bitch',
    'bitchy',
    'bitching',
    'ass',
    'asshole',
    'asshat',
    'dumbass',
    'jackass',
    'arse',
    'arsehole',
    'bastard',
    'dick',
    'dickhead',
    'cock',
    'cocksucker',
    'pussy',
    'pussies',
    'piss',
    'pissed',
    'pissing',
    'prick',
    'wank',
    'wanker',
    'wanking',
    'twat',
    'tosser',
    'bellend',
    'bollocks',
    'cunt',
    'douche',
    'douchebag',
  ]),
  ...entries(2, 'harassment', ['slut', 'slutty', 'whore', 'skank', 'retard', 'retarded', 'go die']),
  ...entries(2, 'sexual', [
    'porn',
    'porno',
    'blowjob',
    'blow job',
    'handjob',
    'hand job',
    'cumshot',
    'dildo',
    'nudes',
    'horny',
    'dick pic',
    'dickpic',
    'rape',
    'raped',
    'raping',
    'rapist',
    'molest',
    'molester',
  ]),
  // Slurs that are also ordinary words or names somewhere: a person decides.
  ...entries(2, 'hate', [
    'fag',
    'faggot',
    'tranny',
    'shemale',
    'spastic',
    'spaz',
    'coon',
    'chink',
    'spic',
    'kike',
    'gook',
    'pikey',
    'beaner',
  ]),
  ...entries(3, 'hate', ['nigger*', 'nigga*', 'paki', 'wetback', 'towelhead', 'raghead']),
  ...entries(3, 'self_harm', [
    'kys',
    'kill yourself',
    'kill urself',
    'go kill yourself',
    'hang yourself',
    'neck yourself',
  ]),
  ...entries(3, 'threat', [
    'i will kill you',
    "i'll kill you",
    'ill kill you',
    "i'm going to kill you",
    'im going to kill you',
    "i'm gonna kill you",
    'im gonna kill you',
    'i will rape you',
    "i'll rape you",
    'ill rape you',
    'i will find you and kill you',
  ]),
  ...entries(3, 'minors', ['child porn', 'child pornography', 'kiddie porn', 'kiddy porn']),
];

/**
 * Innocent words that contain a `*` entry. They pass even though the entry's letters are inside
 * them (whole-token entries need no exceptions: "Scunthorpe" is simply not the token "cunt").
 */
export const ALLOWED: readonly string[] = [
  'snigger',
  'sniggers',
  'sniggered',
  'sniggering',
  'niggard',
  'niggardly',
];
