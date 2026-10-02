/**
 * The web app's structured logger (SEC-11, D-033): secrets, personal data and error messages never
 * reach the log.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger, redact } from './log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('redact', () => {
  it('replaces sensitive fields at any depth, whatever their letter case', () => {
    expect(
      redact({
        Email: 'ava@example.com',
        nested: { token: 'abc', list: [{ password: 'pw', kind: 'reset' }] },
      }),
    ).toEqual({
      Email: '[redacted]',
      nested: { token: '[redacted]', list: [{ password: '[redacted]', kind: 'reset' }] },
    });
  });

  it('reduces errors to a name and code, never the message (it can repeat query parameters)', () => {
    const driverError = Object.assign(new Error('duplicate key: ava@example.com'), {
      code: '23505',
    });
    const wrapped = new Error('Failed query: insert ... params: ava@example.com,secret-token', {
      cause: driverError,
    });
    wrapped.name = 'DrizzleQueryError';
    expect(redact({ error: wrapped })).toEqual({
      error: { name: 'DrizzleQueryError', code: '23505' },
    });
    expect(redact({ error: new TypeError('x is ava@example.com') })).toEqual({
      error: { name: 'TypeError' },
    });
  });
});

describe('createLogger', () => {
  it('writes one JSON line per entry, and nothing below the level', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(line));
    vi.spyOn(console, 'error').mockImplementation((line: string) => lines.push(line));
    const logger = createLogger('info');
    logger.debug('hidden');
    logger.info('email not sent', {
      kind: 'verify',
      error: new Error('to ava@example.com: rejected'),
    });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'info',
      app: 'web',
      msg: 'email not sent',
      kind: 'verify',
      error: { name: 'Error' },
    });
    expect(lines[0]).not.toContain('ava@example.com');
  });
});
