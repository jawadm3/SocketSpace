/**
 * Safe rendering of messages (MSG-07, SEC-06): markdown-lite becomes React elements, and nothing
 * a person writes can become HTML, a script, or a link to anything but http(s).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LINK_REL, MessageBody } from './message-body';

const html = (body: string, myNickname?: string) =>
  renderToStaticMarkup(<MessageBody body={body} myNickname={myNickname} />);

describe('MessageBody', () => {
  it('renders bold, italic, strike, code, quotes and code blocks', () => {
    const out = html('**bold** *it* ~~old~~ `x < y`\n> quoted\n```\n<b>raw</b>\n```');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>it</em>');
    expect(out).toContain('<s>old</s>');
    expect(out).toMatch(/<code[^>]*>x &lt; y<\/code>/);
    expect(out).toMatch(/<blockquote[^>]*>quoted<\/blockquote>/);
    expect(out).toMatch(/<pre[^>]*><code>&lt;b&gt;raw&lt;\/b&gt;<\/code><\/pre>/);
  });

  it('shows HTML in a message as text, never as elements', () => {
    const attacks = [
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)</script>',
      '<a href="javascript:alert(1)">x</a>',
      '<svg onload=alert(1)>',
      '"><iframe src=//evil.test>',
    ];
    for (const attack of attacks) {
      const out = html(attack);
      expect(out).not.toMatch(/<(img|script|svg|iframe|a)\b/i);
      expect(out).toContain('&lt;');
    }
  });

  it('makes links only from http(s) addresses, opening safely in a new tab', () => {
    const out = html('see https://example.test/a?b=1 and [docs](https://example.test/docs)');
    expect(out).toContain('href="https://example.test/a?b=1"');
    expect(out).toContain('href="https://example.test/docs"');
    expect(out.match(/target="_blank"/g)).toHaveLength(2);
    expect(out.match(new RegExp(`rel="${LINK_REL}"`, 'g'))).toHaveLength(2);
    expect(LINK_REL.split(' ').sort()).toEqual(['nofollow', 'noopener', 'noreferrer', 'ugc']);

    for (const bad of [
      '[x](javascript:alert(1))',
      '[x](data:text/html,hi)',
      '[x](vbscript:msgbox)',
      'javascript:alert(1)',
      '[x](https://user:pass@example.test)',
    ]) {
      expect(html(bad)).not.toContain('<a ');
    }
  });

  it('highlights mentions, your own nickname more strongly (any letter case)', () => {
    const out = html('hi @Ava and @sam, mail ava@example.test', 'ava');
    expect(out).toMatch(/<span data-mention="me"[^>]*>@Ava<\/span>/);
    expect(out).toMatch(/<span data-mention="other"[^>]*>@sam<\/span>/);
    expect(out).toContain('ava@example.test');
    expect(out.match(/data-mention/g)).toHaveLength(2);
  });

  it('keeps line breaks', () => {
    expect(html('one\ntwo')).toContain('one<br/>two');
  });
});
