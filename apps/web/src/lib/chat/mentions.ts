/**
 * @mention autocomplete in the composer (MSG-06): finding the "@ava" being typed at the cursor,
 * choosing matching room members, and putting the chosen nickname into the text. The same rules
 * as the shared parser decide what counts as a mention: "@" at the start, after a space or after
 * punctuation, never inside a word or an email address.
 */
import { LIMITS } from '@socketspace/shared/limits';

export interface MentionQuery {
  /** Index of the "@". */
  start: number;
  /** What follows the "@" up to the cursor (may be empty). */
  query: string;
}

const TYPED_MENTION = new RegExp(
  `(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_.-]{0,${String(LIMITS.profile.nicknameMax)}})$`,
);

/** The mention being typed just before `caret`, or `null`. */
export function mentionAt(text: string, caret: number): MentionQuery | null {
  const match = TYPED_MENTION.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[1] ?? '';
  return { start: caret - query.length - 1, query };
}

/**
 * Nicknames that match `query`, best first: those starting with it, then those containing it,
 * each alphabetically. Letter case is ignored, as nicknames are unique regardless of case.
 */
export function mentionCandidates(
  nicknames: readonly string[],
  query: string,
  limit = 6,
): string[] {
  const q = query.toLowerCase();
  const unique = [...new Set(nicknames)];
  const starts = unique.filter((n) => n.toLowerCase().startsWith(q));
  const contains = unique.filter(
    (n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q),
  );
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, limit);
}

/** Replaces the typed mention with `@nickname ` and returns the new text and cursor position. */
export function insertMention(
  text: string,
  caret: number,
  mention: MentionQuery,
  nickname: string,
): { text: string; caret: number } {
  const before = text.slice(0, mention.start);
  const after = text.slice(caret);
  const spaced = after.startsWith(' ');
  const inserted = `@${nickname}${spaced ? '' : ' '}`;
  // The cursor lands after the space, ready for the next word.
  return {
    text: before + inserted + after,
    caret: before.length + inserted.length + (spaced ? 1 : 0),
  };
}
