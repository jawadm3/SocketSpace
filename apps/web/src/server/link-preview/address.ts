/**
 * Which network addresses the link-preview fetcher may contact (SEC-07; security.md 3.8).
 *
 * Our server must never be tricked into fetching from inside our own network ("server-side
 * request forgery", SSRF): cloud metadata (169.254.169.254), localhost, private ranges. So an
 * address is allowed only if it is an ordinary public internet address.
 *
 * - IPv4: everything except the special ranges listed below.
 * - IPv6: only global unicast (2000::/3), minus ranges that tunnel to or stand for IPv4 addresses
 *   or are reserved. Everything else (loopback ::1, IPv4-mapped ::ffff:a.b.c.d, NAT64, unique
 *   local fc00::/7, link-local fe80::/10, multicast) lies outside 2000::/3 and is refused.
 */
import 'server-only';

import { BlockList, isIP } from 'node:net';

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast 255.255.255.255
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['2001::', 23], // protocol assignments, including Teredo (2001::/32), which wraps IPv4
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4, which wraps IPv4
  ['3fff::', 20], // documentation
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

/** True for an ordinary public internet address; false for anything else, including non-addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
  return false;
}

export type UrlRefusal = 'scheme' | 'credentials' | 'port' | 'host' | 'private_address';

export type UrlCheck =
  | { ok: true; url: URL; /** The host without IPv6 brackets or a trailing dot. */ host: string }
  | { ok: false; reason: UrlRefusal };

/**
 * The checks that need no network: only http and https, standard ports, no user name or password,
 * a real host name (with a dot) or a public IP address. The URL parser has already turned odd
 * spellings of an address (decimal `2130706433`, octal `0177.0.0.1`, hex `0x7f.1`) into the usual
 * dotted form, so they are judged as the addresses they are.
 */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'host' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' };
  // The parser drops a default port (80 for http, 443 for https); anything left is non-standard.
  if (url.port !== '') return { ok: false, reason: 'port' };
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === '') return { ok: false, reason: 'host' };
  if (isIP(host) !== 0) {
    return isPublicAddress(host)
      ? { ok: true, url, host }
      : { ok: false, reason: 'private_address' };
  }
  // Single-label names ("intranet", "localhost") only mean something inside a private network.
  const lower = host.toLowerCase();
  if (
    !lower.includes('.') ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return { ok: false, reason: 'private_address' };
  }
  return { ok: true, url, host };
}
