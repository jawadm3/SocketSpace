/**
 * Reading a title, a description and a site name out of a web page (MSG-08). Text only: no
 * images, no scripts, nothing from the page is ever run or shown as HTML.
 *
 * The page comes from a stranger's server, so it is treated as hostile: everything here walks
 * the text once from left to right (no regular expression that can be slowed down by a crafted
 * page), looks at a limited number of tags, and what comes out is cleaned and cut to length.
 */
import 'server-only';

import { LIMITS } from '@socketspace/shared/limits';
import { normalizeSingleLine } from '@socketspace/shared/text';

export interface ExtractedPreview {
  title: string;
  description: string | null;
  siteName: string | null;
}

const MAX_META_TAGS = 300;
const MAX_TAG_LENGTH = 4096;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Turns `&amp;`, `&#39;`, `&#x27;` and a few more into their characters, in one pass. */
export function decodeEntities(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const amp = text.indexOf('&', i);
    if (amp === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, amp);
    const end = text.indexOf(';', amp + 1);
    // Entity names are short; anything longer is just an ampersand.
    if (end === -1 || end - amp > 10) {
      out += '&';
      i = amp + 1;
      continue;
    }
    const name = text.slice(amp + 1, end);
    let decoded: string | undefined;
    if (name.startsWith('#')) {
      const hex = name[1] === 'x' || name[1] === 'X';
      const digits = name.slice(hex ? 2 : 1);
      const valid = hex ? /^[0-9a-fA-F]{1,6}$/.test(digits) : /^[0-9]{1,7}$/.test(digits);
      const code = valid ? Number.parseInt(digits, hex ? 16 : 10) : Number.NaN;
      // Real characters only: no surrogates, nothing beyond Unicode.
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        decoded = String.fromCodePoint(code);
      }
    } else {
      decoded = NAMED_ENTITIES[name];
    }
    if (decoded === undefined) {
      out += '&';
      i = amp + 1;
    } else {
      out += decoded;
      i = end + 1;
    }
  }
  return out;
}

const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';

/** The attributes of one tag (`<meta name="a" content='b' c=d>`), lower-cased names. */
export function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  let i = 0;
  // Skip "<name".
  while (i < tag.length && !isSpace(tag[i] ?? '') && tag[i] !== '>') i += 1;
  while (i < tag.length) {
    while (i < tag.length && (isSpace(tag[i] ?? '') || tag[i] === '/')) i += 1;
    if (i >= tag.length || tag[i] === '>') break;
    const nameStart = i;
    while (i < tag.length && !isSpace(tag[i] ?? '') && tag[i] !== '=' && tag[i] !== '>') i += 1;
    const name = tag.slice(nameStart, i).toLowerCase();
    while (i < tag.length && isSpace(tag[i] ?? '')) i += 1;
    let value = '';
    if (tag[i] === '=') {
      i += 1;
      while (i < tag.length && isSpace(tag[i] ?? '')) i += 1;
      const quote = tag[i];
      if (quote === '"' || quote === "'") {
        const close = tag.indexOf(quote, i + 1);
        const end = close === -1 ? tag.length : close;
        value = tag.slice(i + 1, end);
        i = end + 1;
      } else {
        const valueStart = i;
        while (i < tag.length && !isSpace(tag[i] ?? '') && tag[i] !== '>') i += 1;
        value = tag.slice(valueStart, i);
      }
    }
    if (name !== '' && !attributes.has(name)) attributes.set(name, value);
  }
  return attributes;
}

/** Cleans text taken from a page: entities decoded, one line, control characters gone, cut to `max`. */
function clean(raw: string | undefined, max: number): string | null {
  if (raw === undefined) return null;
  const text = normalizeSingleLine(decodeEntities(raw));
  if (text === '') return null;
  const points = Array.from(text);
  return points.length <= max
    ? text
    : `${points
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

function findTitle(html: string, lower: string): string | undefined {
  const open = lower.indexOf('<title');
  if (open === -1) return undefined;
  const openEnd = html.indexOf('>', open);
  if (openEnd === -1) return undefined;
  const close = lower.indexOf('</title', openEnd);
  if (close === -1) return undefined;
  return html.slice(openEnd + 1, Math.min(close, openEnd + 1 + 4000));
}

/** What a preview of this page would say, or `null` when the page gives no title. */
export function extractPreview(html: string, pageUrl: string): ExtractedPreview | null {
  const lower = html.toLowerCase();
  const meta = new Map<string, string>();
  let position = 0;
  let seen = 0;
  while (seen < MAX_META_TAGS) {
    const start = lower.indexOf('<meta', position);
    if (start === -1) break;
    const end = html.indexOf('>', start);
    if (end === -1) break;
    position = end + 1;
    if (end - start > MAX_TAG_LENGTH) continue;
    seen += 1;
    const attributes = parseAttributes(html.slice(start, end));
    const key = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase();
    const content = attributes.get('content');
    if (key !== '' && content !== undefined && !meta.has(key)) meta.set(key, content);
  }

  const { titleMax, descriptionMax, siteNameMax } = LIMITS.linkPreview;
  const title =
    clean(meta.get('og:title'), titleMax) ??
    clean(meta.get('twitter:title'), titleMax) ??
    clean(findTitle(html, lower), titleMax);
  if (!title) return null;
  let host: string | null = null;
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    // Not expected: the address was parsed before it was fetched.
  }
  return {
    title,
    description:
      clean(meta.get('og:description'), descriptionMax) ??
      clean(meta.get('twitter:description'), descriptionMax) ??
      clean(meta.get('description'), descriptionMax),
    siteName: clean(meta.get('og:site_name'), siteNameMax) ?? clean(host ?? undefined, siteNameMax),
  };
}
