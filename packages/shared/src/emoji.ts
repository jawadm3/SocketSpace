/**
 * Emoji allowed as reactions. An allow-list keeps reactions to a known, small set of strings,
 * so a reaction can never carry arbitrary text (realtime-protocol.md, `reaction:toggle`).
 */
export const REACTION_EMOJI = [
  '👍',
  '👎',
  '❤️',
  '😂',
  '😮',
  '😢',
  '😡',
  '🎉',
  '🙏',
  '👏',
  '🔥',
  '💯',
  '✅',
  '👀',
  '🤔',
  '🚀',
  '✨',
  '😍',
  '🥳',
  '😅',
] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

const allowed: ReadonlySet<string> = new Set(REACTION_EMOJI);

export function isAllowedReaction(value: string): value is ReactionEmoji {
  return allowed.has(value);
}
