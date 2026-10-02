/**
 * Structured JSON logs (pino). Fields that could hold secrets or message text are replaced with
 * "[redacted]" wherever they appear (security.md 3.10). Handlers never log payloads anyway; this is
 * the safety net.
 */
import { pino, type DestinationStream, type Logger } from 'pino';

export const REDACT_PATHS = [
  'token',
  'password',
  'email',
  'body',
  'text',
  'authorization',
  'cookie',
  '*.token',
  '*.password',
  '*.email',
  '*.body',
  '*.text',
  '*.authorization',
  '*.cookie',
  '*.*.token',
  '*.*.body',
  '*.*.text',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { app: 'realtime' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}

export type { Logger };
