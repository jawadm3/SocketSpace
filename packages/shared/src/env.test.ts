import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  EnvError,
  envBoolean,
  envHttpUrl,
  envInt,
  envOriginList,
  envSecret,
  parseEnv,
} from './env';

const schema = z.object({
  PORT: envInt.default(4000),
  DEBUG: envBoolean.default(false),
  PUBLIC_URL: envHttpUrl,
  ORIGINS: envOriginList,
  SECRET: envSecret(32),
});

const valid = {
  PUBLIC_URL: 'https://example.test/',
  ORIGINS: 'https://a.example.test, http://localhost:3000/',
  SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('parses valid values and applies defaults', () => {
    const env = parseEnv(schema, valid);
    expect(env).toEqual({
      PORT: 4000,
      DEBUG: false,
      PUBLIC_URL: 'https://example.test',
      ORIGINS: ['https://a.example.test', 'http://localhost:3000'],
      SECRET: 'x'.repeat(32),
    });
  });

  it('treats empty strings as missing so defaults apply', () => {
    const env = parseEnv(schema, { ...valid, PORT: '  ', DEBUG: '' });
    expect(env.PORT).toBe(4000);
    expect(env.DEBUG).toBe(false);
  });

  it('ignores variables the schema does not mention', () => {
    const env = parseEnv(schema, { ...valid, UNRELATED: 'value' });
    expect(env).not.toHaveProperty('UNRELATED');
  });

  it('names every problem variable', () => {
    expect(() => parseEnv(schema, { PORT: 'abc' })).toThrow(EnvError);
    try {
      parseEnv(schema, { PORT: 'abc' });
    } catch (error) {
      const problems = (error as EnvError).problems.join('\n');
      for (const name of ['PORT', 'PUBLIC_URL', 'ORIGINS', 'SECRET']) {
        expect(problems).toContain(name);
      }
    }
  });

  it('never includes a value in the error message', () => {
    const leaky = 'super-sensitive-value-123';
    let message = '';
    try {
      parseEnv(schema, { ...valid, SECRET: leaky.slice(0, 10), PUBLIC_URL: leaky });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('SECRET');
    expect(message).toContain('PUBLIC_URL');
    expect(message).not.toContain('super-sens');
  });
});

describe('envBoolean', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['No', false],
  ])('parses %s', (input, expected) => {
    expect(envBoolean.parse(input)).toBe(expected);
  });

  it('rejects anything else', () => {
    expect(envBoolean.safeParse('maybe').success).toBe(false);
  });
});

describe('envHttpUrl', () => {
  it('rejects non-http schemes', () => {
    expect(envHttpUrl.safeParse('ftp://example.test').success).toBe(false);
    expect(envHttpUrl.safeParse('javascript:alert(1)').success).toBe(false);
  });
});

describe('envOriginList', () => {
  it('rejects entries with a path, query or credentials', () => {
    expect(envOriginList.safeParse('https://a.test/path').success).toBe(false);
    expect(envOriginList.safeParse('https://a.test?x=1').success).toBe(false);
    expect(envOriginList.safeParse('https://user:pw@a.test').success).toBe(false);
  });

  it('rejects non-origins and empty lists', () => {
    expect(envOriginList.safeParse('not a url').success).toBe(false);
    expect(envOriginList.safeParse(' , ').success).toBe(false);
    expect(envOriginList.safeParse('file:///etc/passwd').success).toBe(false);
  });

  it('normalises case and default ports', () => {
    expect(envOriginList.parse('HTTPS://A.Test:443')).toEqual(['https://a.test']);
  });
});
