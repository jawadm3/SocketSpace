/**
 * Fetching a web page for a link preview without being turned against our own network (SEC-07;
 * security.md 3.8). For every hop (the address itself and each redirect):
 *
 * 1. The address is checked without the network (address.ts): http/https, standard port, no
 *    credentials, a public host.
 * 2. The host name is looked up by us. If any of its addresses is not public, the hop is refused.
 * 3. The connection goes to the address we just checked, not to whatever the name resolves to a
 *    moment later ("DNS rebinding": a name that answers with a public address first and a private
 *    one second).
 * 4. At most 3 redirects, 3 seconds in total, 512 KB read, and only HTML.
 *
 * No cookies or credentials are ever sent, and the content is asked for uncompressed, so a small
 * answer cannot unpack into a huge one.
 */
import 'server-only';

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import { LIMITS } from '@socketspace/shared/limits';

import { checkUrl, isPublicAddress } from './address';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface SafeFetchOptions {
  /** Looks a host name up. Default: the system resolver, all addresses. */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /**
   * Host names reached at a fixed local address instead of through DNS. Local testing only
   * (`LINK_PREVIEW_DEV_HOSTS`, refused at startup unless the site itself runs on localhost).
   */
  devHosts?: ReadonlyMap<string, { host: string; port: number }>;
  /**
   * Tests only: where a checked public address is really reached (a test server on this
   * computer). Never set outside tests.
   */
  dial?: (address: string, port: number) => { host: string; port: number };
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export type FetchFailure =
  /** Refused by a safety rule: never fetched from that address. */
  | { ok: false; kind: 'blocked'; reason: string }
  /** Tried and failed, or not something to preview (not HTML, an error page, too slow). */
  | { ok: false; kind: 'error'; reason: string };

export type FetchResult =
  { ok: true; finalUrl: string; html: string; charset: string | null } | FetchFailure;

const blocked = (reason: string): FetchFailure => ({ ok: false, kind: 'blocked', reason });
const failed = (reason: string): FetchFailure => ({ ok: false, kind: 'error', reason });

const USER_AGENT = 'SocketSpaceLinkPreview/2 (+text preview; no images fetched)';

async function systemLookup(hostname: string): Promise<ResolvedAddress[]> {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : [],
  );
}

/** A lookup function for one request that always answers with the address we checked. */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === 'object' && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

interface Target {
  /** What the socket connects to. */
  connectHost: string;
  connectPort: number;
  /** Set when `connectHost` is a name whose address we fixed ourselves. */
  lookup?: LookupFunction;
}

async function resolveTarget(
  url: URL,
  host: string,
  options: SafeFetchOptions,
): Promise<Target | FetchFailure> {
  const port = url.protocol === 'https:' ? 443 : 80;
  const dev = options.devHosts?.get(host.toLowerCase());
  if (dev) {
    const family = isIP(dev.host) === 6 ? 6 : 4;
    return { connectHost: host, connectPort: dev.port, lookup: pinnedLookup(dev.host, family) };
  }

  let address: ResolvedAddress;
  if (isIP(host) !== 0) {
    // Already judged by checkUrl.
    address = { address: host, family: isIP(host) === 6 ? 6 : 4 };
  } else {
    let addresses: ResolvedAddress[];
    try {
      addresses = await (options.lookup ?? systemLookup)(host);
    } catch {
      return failed('dns');
    }
    const first = addresses[0];
    if (!first) return failed('dns');
    // One private address among several is enough to refuse: which one a connection would use
    // is not ours to choose otherwise.
    if (!addresses.every((entry) => isPublicAddress(entry.address))) {
      return blocked('private_address');
    }
    address = first;
  }

  const dialled = options.dial?.(address.address, port);
  if (dialled) {
    const family = isIP(dialled.host) === 6 ? 6 : 4;
    return {
      connectHost: host,
      connectPort: dialled.port,
      lookup: pinnedLookup(dialled.host, family),
    };
  }
  if (isIP(host) !== 0) return { connectHost: address.address, connectPort: port };
  return {
    connectHost: host,
    connectPort: port,
    lookup: pinnedLookup(address.address, address.family),
  };
}

interface Hop {
  status: number;
  location: string | null;
  contentType: string;
  /** The body arrived compressed although we asked for it plain: not read. */
  encoded: boolean;
  body: Buffer;
}

const isHtml = (contentType: string) =>
  /^(text\/html|application\/xhtml\+xml)\b/i.test(contentType);

function requestOnce(
  url: URL,
  target: Target,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      {
        protocol: url.protocol,
        host: target.connectHost,
        port: target.connectPort,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        // A fresh connection per request: nothing is shared between fetches.
        agent: false,
        signal,
        ...(target.lookup ? { lookup: target.lookup } : {}),
        headers: {
          Host: url.host,
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9',
          'Accept-Language': 'en',
          'Accept-Encoding': 'identity',
        },
      },
      (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location ?? null;
        const contentType = response.headers['content-type'] ?? '';
        const isRedirect = status >= 300 && status < 400 && location !== null;
        const encoded = (response.headers['content-encoding'] ?? 'identity') !== 'identity';
        const wanted = status >= 200 && status < 300 && isHtml(contentType);
        if (isRedirect || !wanted || encoded) {
          // Nothing to read: drop the connection without downloading the body.
          response.destroy();
          resolve({ status, location, contentType, encoded, body: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        const finish = () => {
          resolve({ status, location, contentType, encoded, body: Buffer.concat(chunks, total) });
        };
        response.on('data', (chunk: Buffer) => {
          const room = maxBytes - total;
          if (chunk.length >= room) {
            // Enough for the page's <head>; stop downloading.
            chunks.push(chunk.subarray(0, room));
            total += room;
            response.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
          total += chunk.length;
        });
        response.on('end', finish);
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/** Fetches the HTML at `rawUrl`, following the rules at the top of this file. Never throws. */
export async function safeFetchHtml(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? LIMITS.linkPreview.timeoutMs;
  const maxBytes = options.maxBytes ?? LIMITS.linkPreview.maxBytes;
  const maxRedirects = options.maxRedirects ?? LIMITS.linkPreview.maxRedirects;
  // One deadline for the whole chain, lookups and redirects included.
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, timeoutMs);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const checked = checkUrl(current);
      if (!checked.ok) return blocked(checked.reason);
      // A slow name lookup must not outlive the deadline either.
      const target = await Promise.race([
        resolveTarget(checked.url, checked.host, options),
        new Promise<FetchFailure>((resolve) => {
          const onAbort = () => {
            resolve(failed('timeout'));
          };
          if (deadline.signal.aborted) onAbort();
          else deadline.signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
      if ('ok' in target) return target;

      const response = await requestOnce(checked.url, target, maxBytes, deadline.signal);
      if (response.status >= 300 && response.status < 400 && response.location !== null) {
        let next: URL;
        try {
          next = new URL(response.location, checked.url);
        } catch {
          return failed('bad_redirect');
        }
        current = next.href;
        continue;
      }
      if (response.status < 200 || response.status >= 300) return failed('status');
      if (!isHtml(response.contentType)) return failed('not_html');
      if (response.encoded) return failed('encoded');
      const charset = /charset\s*=\s*"?([A-Za-z0-9._-]{1,40})/i.exec(response.contentType)?.[1];
      return {
        ok: true,
        finalUrl: checked.url.href,
        html: decode(response.body, charset ?? null),
        charset: charset ?? null,
      };
    }
    return failed('too_many_redirects');
  } catch {
    return failed(deadline.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** Text in the page's stated character set when we know it, otherwise UTF-8. */
function decode(body: Buffer, charset: string | null): string {
  if (charset) {
    try {
      return new TextDecoder(charset).decode(body);
    } catch {
      // An unknown name: fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(body);
}
