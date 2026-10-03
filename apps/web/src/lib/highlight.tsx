/**
 * Highlights search words in a piece of text as <mark> elements (HIST-03). The text stays text:
 * it is split into strings, never parsed as HTML.
 */
import { Fragment, type ReactNode } from 'react';

/** The words of a search, as the database matches them (letters and digits, any letter case). */
export function searchTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words)].filter((w) => w.length > 0).slice(0, 10);
}

const escapeForRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function highlight(text: string, terms: readonly string[]): ReactNode[] {
  if (terms.length === 0) return [text];
  // Whole words only, like the search itself.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${terms.map(escapeForRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
    'giu',
  );
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > last)
      parts.push(<Fragment key={`t${String(last)}`}>{text.slice(last, start)}</Fragment>);
    parts.push(
      <mark key={`m${String(start)}`} className="rounded bg-stamp/30 px-0.5 text-ink">
        {match[0]}
      </mark>,
    );
    last = start + match[0].length;
  }
  if (last < text.length)
    parts.push(<Fragment key={`t${String(last)}`}>{text.slice(last)}</Fragment>);
  return parts;
}
