/**
 * Recognising database errors without reading their messages into logs (D-033).
 */
const UNIQUE_VIOLATION = '23505';

/**
 * True when `error` (or one of its causes, as Drizzle wraps driver errors) is a unique-key
 * violation of `constraint`.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown };
    if (candidate.code === UNIQUE_VIOLATION) {
      return (
        candidate.constraint === constraint ||
        (typeof candidate.message === 'string' && candidate.message.includes(constraint))
      );
    }
  }
  return false;
}
