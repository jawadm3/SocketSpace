/**
 * The avatar builder's data (PROF-07): which parts and colours each style offers, and how a
 * person's choices turn into saved settings. The server builds the lists from DiceBear's own
 * description of each style (server/avatar.ts) and checks saved settings against them.
 */

export interface BuilderPart {
  /** The part's name in DiceBear, for example `hair`; the option is `hairVariant`. */
  key: string;
  label: string;
  values: { value: string; label: string }[];
  /** Optional extras (glasses, beard, ...) can be switched off with `<key>Probability: 0`. */
  optional: boolean;
}

export interface BuilderColor {
  /** The option name, for example `skinColor`. */
  key: string;
  label: string;
  /** `#rrggbb` (DiceBear ignores colours without the `#`). */
  values: string[];
}

export interface BuilderStyle {
  style: string;
  label: string;
  parts: BuilderPart[];
  colors: BuilderColor[];
}

export type AvatarOptions = Record<string, string | number>;

export type PartChoice = { kind: 'surprise' } | { kind: 'none' } | { kind: 'value'; value: string };

/** What is chosen for one part right now. */
export function partChoice(options: AvatarOptions, part: BuilderPart): PartChoice {
  if (part.optional && options[`${part.key}Probability`] === 0) return { kind: 'none' };
  const value = options[`${part.key}Variant`];
  return typeof value === 'string' ? { kind: 'value', value } : { kind: 'surprise' };
}

/**
 * New options with one part changed. Choosing a look for an optional extra also switches it on
 * (otherwise DiceBear would show it only occasionally); "none" switches it off; "surprise" lets
 * the seed decide.
 */
export function withPartChoice(
  options: AvatarOptions,
  part: BuilderPart,
  choice: PartChoice,
): AvatarOptions {
  const variant = `${part.key}Variant`;
  const probability = `${part.key}Probability`;
  const next = without(options, [variant, probability]);
  if (choice.kind === 'value') {
    next[variant] = choice.value;
    if (part.optional) next[probability] = 100;
  } else if (choice.kind === 'none' && part.optional) {
    next[probability] = 0;
  }
  return next;
}

/** New options with one colour set, or cleared (`null`, the seed decides). */
export function withColor(
  options: AvatarOptions,
  key: string,
  value: string | null,
): AvatarOptions {
  const next = without(options, [key]);
  if (value !== null) next[key] = value;
  return next;
}

function without(options: AvatarOptions, keys: readonly string[]): AvatarOptions {
  return Object.fromEntries(Object.entries(options).filter(([key]) => !keys.includes(key)));
}
