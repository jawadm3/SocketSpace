/**
 * Environment variable validation, shared by every SocketSpace program.
 *
 * Each program describes the variables it needs as a Zod object schema and calls `parseEnv` once
 * at start-up. If anything is missing or malformed, the program stops with a message that names
 * each problem variable. Values are never included in the message, so secrets cannot leak into
 * logs.
 */
import { z } from 'zod';

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class EnvError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'See .env.example for every variable and what it is for.',
    );
    this.name = 'EnvError';
    this.problems = problems;
  }
}

/**
 * Validates `source` (normally `process.env`) against `schema`.
 * Empty strings are treated as "not set", so `FOO=` in a file behaves like a missing variable and
 * defaults apply.
 */
export function parseEnv<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  source: EnvSource,
): z.infer<z.ZodObject<Shape>> {
  const cleaned: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = source[key];
    if (value !== undefined && value.trim() !== '') cleaned[key] = value;
  }

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    // Only the variable name and Zod's message (which describes the expected shape) are reported.
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.map(String).join('.') || '(root)';
      return `${name}: ${issue.message}`;
    });
    throw new EnvError(problems);
  }
  return result.data;
}

/** A boolean flag written as `true`/`false`/`1`/`0`/`yes`/`no` (case-insensitive). */
export const envBoolean = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

/** A whole number written as text, for example a port. */
export const envInt = z
  .string()
  .trim()
  .regex(/^-?\d+$/, 'expected a whole number')
  .transform(Number);

/** An absolute http(s) URL. Trailing slashes are removed so values can be joined safely. */
export const envHttpUrl = z
  .url({ protocol: /^https?$/, error: 'expected an absolute http(s) URL' })
  .transform((value) => value.replace(/\/+$/, ''));

/**
 * A comma-separated list of browser origins (scheme + host + optional port, no path), for example
 * `https://socketspace.vercel.app,http://localhost:3000`. Each entry is normalised with `URL`.
 */
export const envOriginList = z.string().transform((value, ctx) => {
  const origins: string[] = [];
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'contains an entry that is not a valid origin' });
      return z.NEVER;
    }
    const isOriginOnly =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.pathname === '/' || url.pathname === '') &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '';
    if (!isOriginOnly) {
      ctx.addIssue({
        code: 'custom',
        message: 'every entry must be an http(s) origin with no path, query or credentials',
      });
      return z.NEVER;
    }
    origins.push(url.origin);
  }
  if (origins.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'must list at least one origin' });
    return z.NEVER;
  }
  return origins;
});

/** A secret of at least `minLength` characters (for signing keys). */
export const envSecret = (minLength = 32) =>
  z.string().min(minLength, `must be at least ${String(minLength)} characters`);

/** Standard log levels for pino. */
export const envLogLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
