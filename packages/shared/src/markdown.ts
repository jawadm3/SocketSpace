/**
 * Markdown-lite (MSG-07): the small formatting language messages are written in, parsed into a
 * tree that browsers render as React elements. Nothing here ever produces HTML, so text such as
 * `<img src=x onerror=alert(1)>` stays text (SEC-06).
 *
 * Supported:
 *   **bold**  *italic* or _italic_  ~~strike~~  `code`
 *   ```code block```  > quote  links (https only)  [label](https://...)  @mentions
 *   A backslash shows the next character as it is: \*not italic\*.
 *
 * The parser uses no backtracking regular expressions. In the worst case (many unclosed markers)
 * its work grows with the square of the length; messages are at most 4,000 characters, which a
 * test parses in a few milliseconds.
 * The server uses the same tree to find @mentions, so a name inside `code` is never a mention.
 */
import { NICKNAME_PATTERN } from './profile';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold' | 'italic' | 'strike'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'mention'; nickname: string }
  | { t: 'br' };

export type Block =
  { t: 'p'; c: Inline[] } | { t: 'quote'; c: Inline[] } | { t: 'codeblock'; v: string };

const MAX_LINK_LENGTH = 2048;
const MAX_DEPTH = 4;

/** An http(s) address, or `null`. Anything else (javascript:, data:, ...) is never a link. */
export function safeHref(raw: string): string | null {
  if (raw.length > MAX_LINK_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
/** Trailing characters that usually end a sentence rather than an address. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', "'", '"']);

function pushText(out: Inline[], text: string) {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last?.t === 'text') last.v += text;
  else out.push({ t: 'text', v: text });
}

/** Where `marker` closes, starting at `from`, or -1. The closer may not follow a space. */
function findCloser(s: string, marker: string, from: number): number {
  for (let i = from; i <= s.length - marker.length; i++) {
    if (s[i] === '\\') {
      i += 1;
      continue;
    }
    if (s.startsWith(marker, i) && i > from && !isSpace(s[i - 1])) {
      // "***" closing a bold that contains an italic: the italic takes the first star.
      if (marker === '**' && s[i + 2] === '*') return i + 1;
      // For single-character markers, "**" is not a closer for "*".
      if (marker.length === 1 && s[i + 1] === marker) {
        i += 1;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/** The emphasis marker starting with `c`: `**`, `*`, `~~` or `_`; '' when there is none. */
function emphasisMarker(c: string, double: boolean): string {
  if (c === '*') return double ? '**' : '*';
  if (c === '~') return double ? '~~' : ''; // a single ~ is just a tilde
  return double ? '' : '_'; // __ is left as text
}

function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let plainStart = 0;
  const flush = (end: number) => {
    pushText(out, s.slice(plainStart, end));
  };

  while (i < s.length) {
    const c = s[i];
    const prev = i > 0 ? s[i - 1] : undefined;

    // Escapes: show the next punctuation character as it is.
    if (c === '\\' && i + 1 < s.length && /[\\`*_~[\]()>@#-]/.test(s[i + 1] ?? '')) {
      flush(i);
      pushText(out, s[i + 1] ?? '');
      i += 2;
      plainStart = i;
      continue;
    }

    if (c === '\n') {
      flush(i);
      out.push({ t: 'br' });
      i += 1;
      plainStart = i;
      continue;
    }

    // Inline code: everything inside is literal.
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush(i);
        out.push({ t: 'code', v: s.slice(i + 1, end) });
        i = end + 1;
        plainStart = i;
        continue;
      }
    }

    // Emphasis: **bold**, ~~strike~~, *italic*, _italic_ (underscores only at word edges).
    if (depth < MAX_DEPTH && (c === '*' || c === '~' || c === '_')) {
      const marker = emphasisMarker(c, s[i + 1] === c);
      const opensAtEdge = c !== '_' || !isWordChar(prev);
      if (marker !== '' && opensAtEdge && !isSpace(s[i + marker.length])) {
        const end = findCloser(s, marker, i + marker.length);
        const closesAtEdge = c !== '_' || !isWordChar(s[end + 1]);
        if (end > i + marker.length && closesAtEdge) {
          flush(i);
          const inner = parseInline(s.slice(i + marker.length, end), depth + 1);
          out.push({
            t: marker === '**' ? 'bold' : marker === '~~' ? 'strike' : 'italic',
            c: inner,
          });
          i = end + marker.length;
          plainStart = i;
          continue;
        }
      }
    }

    // [label](https://address)
    if (c === '[' && depth < MAX_DEPTH) {
      const close = s.indexOf('](', i + 1);
      const end = close === -1 ? -1 : s.indexOf(')', close + 2);
      if (close > i + 1 && end > close + 2 && !s.slice(i + 1, close).includes('\n')) {
        const href = safeHref(s.slice(close + 2, end));
        if (href) {
          flush(i);
          out.push({ t: 'link', href, c: parseInline(s.slice(i + 1, close), depth + 1) });
          i = end + 1;
          plainStart = i;
          continue;
        }
      }
    }

    // Bare addresses: https://... up to the next space, minus closing punctuation.
    if ((c === 'h' || c === 'H') && !isWordChar(prev) && /^https?:\/\//i.test(s.slice(i, i + 8))) {
      let end = i;
      while (end < s.length && !isSpace(s[end]) && s[end] !== '<' && s[end] !== '>') end += 1;
      while (end > i && TRAILING.has(s[end - 1] ?? '')) end -= 1;
      const raw = s.slice(i, end);
      const href = safeHref(raw);
      if (href) {
        flush(i);
        out.push({ t: 'link', href, c: [{ t: 'text', v: raw }] });
        i = end;
        plainStart = i;
        continue;
      }
    }

    // @mentions: a nickname after a space, the start, or punctuation (not inside a word or email).
    if (c === '@' && !isWordChar(prev) && prev !== '@') {
      let end = i + 1;
      while (end < s.length && /[A-Za-z0-9_.-]/.test(s[end] ?? '')) end += 1;
      // A nickname ends with a letter or digit: "@ava." mentions "ava".
      while (end > i + 1 && !/[A-Za-z0-9]/.test(s[end - 1] ?? '')) end -= 1;
      const nickname = s.slice(i + 1, end);
      if (NICKNAME_PATTERN.test(nickname)) {
        flush(i);
        out.push({ t: 'mention', nickname });
        i = end;
        plainStart = i;
        continue;
      }
    }

    i += 1;
  }
  flush(s.length);
  return out;
}

/** Parses a message body into blocks. */
export function parseMarkdownLite(body: string): Block[] {
  const lines = body.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];

  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ t: 'p', c: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };
  const endQuote = () => {
    if (quote.length > 0) blocks.push({ t: 'quote', c: parseInline(quote.join('\n')) });
    quote = [];
  };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? '';
    if (line.trimStart().startsWith('```')) {
      // A fenced code block runs to the next fence (or the end of the message).
      endParagraph();
      endQuote();
      const code: string[] = [];
      n += 1;
      while (n < lines.length && !(lines[n] ?? '').trimStart().startsWith('```')) {
        code.push(lines[n] ?? '');
        n += 1;
      }
      blocks.push({ t: 'codeblock', v: code.join('\n') });
      continue;
    }
    if (line.startsWith('>')) {
      endParagraph();
      quote.push(line.replace(/^> ?/, ''));
      continue;
    }
    endQuote();
    paragraph.push(line);
  }
  endParagraph();
  endQuote();
  return blocks;
}

/** Nicknames mentioned in a body (lower case, unique, at most `limit`), ignoring code. */
export function extractMentions(body: string, limit = 20): string[] {
  const found = new Set<string>();
  const walk = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (found.size >= limit) return;
      if (node.t === 'mention') found.add(node.nickname.toLowerCase());
      else if ('c' in node) walk(node.c);
    }
  };
  for (const block of parseMarkdownLite(body)) if (block.t !== 'codeblock') walk(block.c);
  return [...found];
}

/** The plain text of a body, for quotes, notifications and search snippets. */
export function plainText(body: string): string {
  const parts: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.t === 'text' || node.t === 'code') parts.push(node.v);
      else if (node.t === 'mention') parts.push(`@${node.nickname}`);
      else if (node.t === 'br') parts.push(' ');
      else walk(node.c);
    }
  };
  for (const block of parseMarkdownLite(body)) {
    if (block.t === 'codeblock') parts.push(block.v);
    else walk(block.c);
    parts.push(' ');
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}
