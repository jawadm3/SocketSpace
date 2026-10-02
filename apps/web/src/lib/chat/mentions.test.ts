/**
 * @mention autocomplete (MSG-06): what counts as a mention being typed, which members match,
 * and how the chosen nickname goes into the text.
 */
import { describe, expect, it } from 'vitest';

import { insertMention, mentionAt, mentionCandidates } from './mentions';

describe('mentionAt', () => {
  it('finds "@" at the start, after a space, or after punctuation', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('hi @av', 6)).toEqual({ start: 3, query: 'av' });
    expect(mentionAt('(@sam', 5)).toEqual({ start: 1, query: 'sam' });
  });

  it('ignores email addresses, words, finished mentions and text after the cursor', () => {
    expect(mentionAt('ava@example', 11)).toBeNull();
    expect(mentionAt('@@ava', 5)).toBeNull();
    expect(mentionAt('@ava ', 5)).toBeNull();
    expect(mentionAt('@ava and more', 2)).toEqual({ start: 0, query: 'a' });
  });
});

describe('mentionCandidates', () => {
  const people = ['Sam', 'ava', 'Avery', 'nova', 'bob'];

  it('puts names that start with the query first, ignoring letter case', () => {
    expect(mentionCandidates(people, 'AV')).toEqual(['ava', 'Avery']);
    expect(mentionCandidates(people, 'ov')).toEqual(['nova']);
    expect(mentionCandidates([...people, 'Vaughn'], 'va')).toEqual(['Vaughn', 'ava', 'nova']);
    expect(mentionCandidates(people, '')).toEqual(['ava', 'Avery', 'bob', 'nova', 'Sam']);
  });

  it('limits the list and drops duplicates', () => {
    expect(mentionCandidates([...people, 'ava'], '', 2)).toEqual(['ava', 'Avery']);
    expect(mentionCandidates(people, 'zzz')).toEqual([]);
  });
});

describe('insertMention', () => {
  it('replaces the typed part and puts the cursor after a space', () => {
    const text = 'hi @av, welcome';
    const mention = mentionAt(text, 6);
    expect(mention).not.toBeNull();
    if (!mention) return;
    expect(insertMention(text, 6, mention, 'ava')).toEqual({
      text: 'hi @ava , welcome',
      caret: 8,
    });
  });

  it('reuses a space that is already there', () => {
    const text = '@s rest';
    const mention = mentionAt(text, 2);
    if (!mention) throw new Error('expected a mention');
    expect(insertMention(text, 2, mention, 'sam')).toEqual({ text: '@sam rest', caret: 5 });
  });
});
