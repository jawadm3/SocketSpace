/**
 * Search highlighting (HIST-03): whole words in any letter case, and never HTML.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { highlight, searchTerms } from './highlight';

const html = (text: string, query: string) =>
  renderToStaticMarkup(<>{highlight(text, searchTerms(query))}</>);

describe('highlight', () => {
  it('marks whole words in any letter case', () => {
    expect(html('Zebra zebras and a ZEBRA', 'zebra')).toBe(
      '<mark class="rounded bg-stamp/30 px-0.5 text-ink">Zebra</mark> zebras and a ' +
        '<mark class="rounded bg-stamp/30 px-0.5 text-ink">ZEBRA</mark>',
    );
  });

  it('takes only words from the query, so symbols cannot break the pattern', () => {
    expect(searchTerms('"café" OR (a+b) -x*')).toEqual(['café', 'or', 'a', 'b', 'x']);
    expect(html('a+b', '(a+b')).toContain('<mark');
  });

  it('keeps everything else as text', () => {
    expect(html('<img src=x onerror=alert(1)> zebra', 'zebra')).toMatch(/^&lt;img src=x/);
    expect(html('nothing here', '')).toBe('nothing here');
  });
});
