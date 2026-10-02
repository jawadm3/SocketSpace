/**
 * Text clean-up applied to everything people type, before it is checked or stored
 * (security.md 3.4, "Input validation").
 */

// C0 control characters except tab (09) and line feed (0A), plus DEL. Carriage returns are
// handled separately (converted to line feeds).
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Bidirectional overrides and isolates can make text display in a different order from how it is
// stored, which is used to disguise links and file names ("Trojan Source"). Left/right marks are
// harmless but invisible, so they go too. The zero-width joiner (U+200D) stays: emoji need it.
const BIDI_AND_INVISIBLE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/**
 * Normalises Unicode to NFC (so "é" typed two ways is stored one way), converts Windows and old
 * Mac line endings to `\n`, and removes control, bidi-override and invisible characters.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_AND_INVISIBLE, '');
}

/** Like `normalizeText`, and also folds every run of whitespace (including newlines) to a space. */
export function normalizeSingleLine(input: string): string {
  return normalizeText(input).replace(/\s+/g, ' ').trim();
}

/**
 * Length in Unicode code points, the same unit as PostgreSQL's `char_length`. JavaScript's
 * `.length` counts UTF-16 units, so an emoji would count twice.
 */
export function codePointLength(input: string): number {
  let count = 0;
  for (const _ of input) count += 1;
  return count;
}
