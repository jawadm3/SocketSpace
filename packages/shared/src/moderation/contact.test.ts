import { describe, expect, it } from 'vitest';

import { findContactDetails } from './contact';

const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const CYRILLIC_O = String.fromCodePoint(0x043e);
const FULL_WIDTH_DOT = String.fromCodePoint(0xff0e);

describe('links in random mode (RAND-01)', () => {
  it.each([
    ['check out bit.ly/x'],
    ['example dot com'],
    ['go to https://example.org/page'],
    ['HTTP://EXAMPLE.ORG'],
    ['www.example.net'],
    ['my site is example.io'],
    ['example .com'],
    ['example . com'],
    ['example(dot)com'],
    ['example [dot] com'],
    ['example[.]com'],
    ['example d0t com'],
    ['t.me/someone'],
    ['youtu.be/abc123'],
    ['discord.gg/abcd'],
    [`exam${ZERO_WIDTH_SPACE}ple.c${ZERO_WIDTH_SPACE}om`],
    [`example.c${CYRILLIC_O}m`],
    [`example${FULL_WIDTH_DOT}com`],
    ['name at mail dot com'],
  ])('finds a link in %j', (text) => {
    expect(findContactDetails(text)).toBe('link');
  });
});

describe('contact details in random mode (security.md 4.3)', () => {
  it.each([
    ['write to someone@example.com', 'email'],
    ['Someone.Name+chat@mail.example.org', 'email'],
    ['call me on 07700 900123', 'phone'],
    ['+44 (0) 7700-900.123', 'phone'],
    ['555-123-4567 is my number', 'phone'],
    ['five five five one two three four five six seven', 'phone'],
    ['oh seven seven double oh nine double oh one two three', 'phone'],
    ['0 7 7 0 0 9 0 0 1 2 3', 'phone'],
    ['i am @cool_guy on there', 'handle'],
    ['coolguy#1234', 'handle'],
    ['snap: coolguy', 'handle'],
    ['ig: cool.guy', 'handle'],
    ['insta @coolguy', 'handle'],
    ['my insta is coolguy', 'handle'],
    ['my telegram username is coolguy', 'handle'],
    ['add me on snap', 'handle'],
    ['add me on Snapchat please', 'handle'],
    ['hmu on insta', 'handle'],
    ['find me on my telegram', 'handle'],
    ['message me on whats app', 'handle'],
  ] as const)('finds %j as %s', (text, kind) => {
    expect(findContactDetails(text)).toBe(kind);
  });
});

describe('ordinary sentences pass', () => {
  it.each([
    [''],
    ['hello, how are you?'],
    // A forgotten space after a full stop is not an address.
    ['it was fun.in the end we left'],
    ['I love it.so much'],
    ['that is the end. Come in'],
    ['ok.no problem'],
    ['wait.what'],
    ['e.g. chess or music'],
    ['i.e. tomorrow'],
    ['it costs 3.50 here'],
    ['version 1.2.3 is out'],
    ['see you at 10.30-11.30'],
    ['born on 2001-05-17'],
    ['I have 3 cats and 25 fish since 2019'],
    ['one two three, go'],
    ['I am twenty five'],
    ['meet me @ 5'],
    ['a polka dot dress'],
    ['connect the dot to the line'],
    ['I saw it on instagram yesterday'],
    ['discord is fun'],
    ['I follow nasa on instagram'],
    ['do you use telegram?'],
    ['the signal is bad on this line'],
    ['what is your favourite film?'],
    ['50/50 chance, 100% sure'],
  ])('%j', (text) => {
    expect(findContactDetails(text)).toBeNull();
  });
});

describe('robustness', () => {
  it('stays fast on long hostile input', () => {
    const started = performance.now();
    findContactDetails('a .'.repeat(300) + ' dot '.repeat(50));
    findContactDetails('1 '.repeat(4) + 'x'.repeat(900));
    findContactDetails('add me '.repeat(140));
    expect(performance.now() - started).toBeLessThan(200);
  });
});
