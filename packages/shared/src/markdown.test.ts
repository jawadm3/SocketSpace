/**
 * Markdown-lite (MSG-07, SEC-06): formatting, links, mentions, and hostile input that must stay
 * plain text.
 */
import { describe, expect, it } from 'vitest';

import { extractMentions, parseMarkdownLite, plainText, safeHref, type Inline } from './markdown';

const BS = String.fromCharCode(92); // one backslash

/** The inline nodes of a one-paragraph message. */
function inline(body: string): Inline[] {
  const blocks = parseMarkdownLite(body);
  expect(blocks).toHaveLength(1);
  const [block] = blocks;
  if (!block || block.t === 'codeblock') throw new Error('expected a paragraph');
  return block.c;
}

describe('formatting', () => {
  it('reads bold, italic, strike and code', () => {
    expect(inline('a **b** *c* _d_ ~~e~~ `f`')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'bold', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'italic', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'italic', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'strike', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'f' },
    ]);
  });

  it('nests emphasis and keeps code literal', () => {
    expect(inline('**bold *and italic***')).toEqual([
      {
        t: 'bold',
        c: [
          { t: 'text', v: 'bold ' },
          { t: 'italic', c: [{ t: 'text', v: 'and italic' }] },
        ],
      },
    ]);
    expect(inline('`**not bold**`')).toEqual([{ t: 'code', v: '**not bold**' }]);
  });

  it('leaves unmatched or spaced markers, snake_case and lone tildes as text', () => {
    for (const body of [
      '2 * 3 * 4',
      '**open',
      'snake_case_name',
      '~approx',
      'a ** b',
      '__init__',
    ]) {
      expect(inline(body), body).toEqual([{ t: 'text', v: body }]);
    }
  });

  it('shows an escaped marker as it is', () => {
    expect(inline(`${BS}*not italic${BS}*`)).toEqual([{ t: 'text', v: '*not italic*' }]);
  });

  it('keeps line breaks, quotes and fenced code blocks', () => {
    expect(parseMarkdownLite('line one\nline two')).toEqual([
      {
        t: 'p',
        c: [{ t: 'text', v: 'line one' }, { t: 'br' }, { t: 'text', v: 'line two' }],
      },
    ]);
    expect(parseMarkdownLite('> quoted\nanswer')).toEqual([
      { t: 'quote', c: [{ t: 'text', v: 'quoted' }] },
      { t: 'p', c: [{ t: 'text', v: 'answer' }] },
    ]);
    expect(parseMarkdownLite('```js\nconst a = **1**;\n```')).toEqual([
      { t: 'codeblock', v: 'const a = **1**;' },
    ]);
  });
});

describe('links', () => {
  it('links bare https addresses, without the full stop that ends the sentence', () => {
    expect(inline('see https://example.com/a?b=1.')).toEqual([
      { t: 'text', v: 'see ' },
      {
        t: 'link',
        href: 'https://example.com/a?b=1',
        c: [{ t: 'text', v: 'https://example.com/a?b=1' }],
      },
      { t: 'text', v: '.' },
    ]);
  });

  it('accepts [label](https://...) and refuses every other scheme', () => {
    expect(inline('[docs](https://example.com/docs)')).toEqual([
      { t: 'link', href: 'https://example.com/docs', c: [{ t: 'text', v: 'docs' }] },
    ]);
    for (const body of [
      '[x](javascript:alert(1))',
      '[x](data:text/html,hi)',
      '[x](vbscript:msgbox)',
      'javascript:alert(1)',
    ]) {
      expect(JSON.stringify(inline(body)), body).not.toContain('"link"');
    }
    expect(safeHref('https://user:pass@example.com')).toBeNull();
    expect(safeHref('http://example.com')).toBe('http://example.com/');
  });
});

describe('hostile input stays text (SEC-06)', () => {
  it('never turns HTML into anything but text', () => {
    const attack = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    expect(inline(attack)).toEqual([{ t: 'text', v: attack }]);
  });

  it('parses 4,000 characters of nested and unclosed markers quickly', () => {
    const nasty = ['*_~`['.repeat(800), '**a '.repeat(1000), '*'.repeat(4000), '[]('.repeat(1300)];
    for (const body of nasty) {
      const started = performance.now();
      parseMarkdownLite(body.slice(0, 4000));
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});

describe('mentions', () => {
  it('finds @nicknames, lower-cased and unique, but not in emails or code', () => {
    expect(extractMentions('hi @Ava and @sam_1, @ava again; mail me at bob@example.com')).toEqual([
      'ava',
      'sam_1',
    ]);
    expect(extractMentions('`@inside` code and\n```\n@block\n```')).toEqual([]);
    expect(extractMentions('thanks @lee.')).toEqual(['lee']);
    expect(extractMentions('@ab is too short')).toEqual([]);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => `@user${String(i)}`).join(' ');
    expect(extractMentions(many, 20)).toHaveLength(20);
  });
});

describe('plainText', () => {
  it('drops the formatting marks', () => {
    expect(plainText('**Hello** _@ava_, see [docs](https://example.com)\n> quoted')).toBe(
      'Hello @ava, see docs quoted',
    );
  });
});
