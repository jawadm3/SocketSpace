/**
 * A small structured (JSON) logger for the web app. Vercel collects whatever is written to the
 * console, so one JSON object per line is all that is needed.
 *
 * Fields that could hold secrets or personal data are replaced with "[redacted]" at any depth
 * (security.md 3.10): message text is never logged, and neither are tokens or email addresses.
 */
import 'server-only';

const REDACT = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'email',
  'body',
  'text',
  'url',
]);

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 100 };
export type LogLevel = keyof typeof LEVELS;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = REDACT.has(key.toLowerCase()) ? '[redacted]' : redact(inner, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel = 'info', base: Record<string, unknown> = {}): Logger {
  const threshold = LEVELS[level];
  const write = (
    name: Exclude<LogLevel, 'silent'>,
    message: string,
    fields?: Record<string, unknown>,
  ) => {
    if (LEVELS[name] < threshold) return;
    const line = JSON.stringify({
      level: name,
      time: new Date().toISOString(),
      app: 'web',
      msg: message,
      ...(redact({ ...base, ...fields }) as Record<string, unknown>),
    });
    if (LEVELS[name] >= LEVELS.error) console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => {
      write('debug', m, f);
    },
    info: (m, f) => {
      write('info', m, f);
    },
    warn: (m, f) => {
      write('warn', m, f);
    },
    error: (m, f) => {
      write('error', m, f);
    },
  };
}
