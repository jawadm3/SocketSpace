/**
 * Who is connecting: the browser's origin and the client's IP address.
 */
import type { IncomingMessage } from 'node:http';

/**
 * The `Origin` header must be one of the allowed web origins. Browsers always send it on a
 * WebSocket or long-polling handshake. v1 relied on CORS alone, which does not protect WebSockets:
 * its foreign-origin test connected (docs/analysis/evidence/v1-origin-output.txt).
 * Requests without an Origin (non-browser tools) are refused too.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  try {
    return allowed.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

/**
 * The client's IP address. With `trustedHops` reverse proxies in front (Render: 1), the address is
 * the entry `trustedHops` places from the right of X-Forwarded-For, which our own proxy wrote and a
 * client cannot forge. With 0 hops the socket's own address is used and the header is ignored.
 */
export function clientIp(request: IncomingMessage, trustedHops: number): string {
  const direct = request.socket.remoteAddress ?? 'unknown';
  if (trustedHops === 0) return normalizeIp(direct);
  const header = request.headers['x-forwarded-for'];
  const value = Array.isArray(header) ? header.join(',') : (header ?? '');
  const chain = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = chain[chain.length - trustedHops];
  return normalizeIp(candidate ?? direct);
}

/** `::ffff:203.0.113.5` (IPv4 written as IPv6) becomes `203.0.113.5`. */
function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
