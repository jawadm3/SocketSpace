/**
 * `GET /api/messages/<id>/previews`: text previews for the links in one message (MSG-08).
 *
 * The browser never names an address to fetch. It names a message; the server reads that
 * message's text itself (only if this viewer may read it), finds the first links outside code,
 * and answers from a 7-day cache. Only a link not in the cache is fetched, by the safe fetcher
 * (safe-fetch.ts), and each person can cause only a limited number of fetches a minute.
 *
 * Random-mode messages are never stored, so they have no ID and can never reach this.
 */
import 'server-only';

import { createHash } from 'node:crypto';

import {
  getFreshLinkPreviews,
  getReadableMessageBody,
  hitRateLimit,
  linkMessageToPreviews,
  saveLinkPreview,
  type Database,
} from '@socketspace/db';
import { LIMITS } from '@socketspace/shared/limits';
import { extractLinks } from '@socketspace/shared/markdown';
import type { LinkPreviewWire, LinkPreviewsResponse } from '@socketspace/shared/media';
import { uuid } from '@socketspace/shared/primitives';

import { SESSION_ABSOLUTE_MS, type Auth } from '../auth';
import type { Logger } from '../log';
import { extractPreview, type ExtractedPreview } from './extract';
import { safeFetchHtml, type SafeFetchOptions } from './safe-fetch';

export type PreviewLookup =
  | { status: 'ok'; preview: ExtractedPreview }
  /** Refused by a safety rule (for example a private address). */
  | { status: 'blocked' }
  /** Could not be fetched, or nothing to show. */
  | { status: 'error' };

export interface PreviewDeps {
  auth: Auth;
  db: Database;
  enabled: boolean;
  /** Fetches and reads one page. Tests replace it; the default uses the safe fetcher. */
  lookup?: (url: string) => Promise<PreviewLookup>;
  fetchOptions?: SafeFetchOptions;
  logger?: Logger;
}

/** Requests one person may make a minute (each is a few database reads). */
export const PREVIEW_REQUESTS_PER_MINUTE = 300;

function error(status: number, code: string, message: string, retryAfterMs?: number) {
  return Response.json(
    { error: retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** One address, one cache entry: the fragment (`#part`) never reaches a server, so it is dropped. */
export function normalizeLink(href: string): string | null {
  try {
    const url = new URL(href);
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export const hashLink = (url: string): string => createHash('sha256').update(url).digest('hex');

export async function fetchPreview(
  url: string,
  options: SafeFetchOptions = {},
): Promise<PreviewLookup> {
  const page = await safeFetchHtml(url, options);
  if (!page.ok) return { status: page.kind };
  const preview = extractPreview(page.html, page.finalUrl);
  return preview ? { status: 'ok', preview } : { status: 'error' };
}

export async function loadLinkPreviews(
  request: Request,
  messageId: string,
  deps: PreviewDeps,
): Promise<Response> {
  const current = await deps.auth.api.getSession({ headers: request.headers });
  if (!current || Date.now() - current.session.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    return error(401, 'UNAUTHENTICATED', 'Please sign in again.');
  }
  if (current.user.isAnonymous || !current.user.onboardedAt) {
    return error(403, 'FORBIDDEN', 'Finish setting up your account first.');
  }
  const answer = (previews: LinkPreviewWire[], maxAge: number) => {
    const body: LinkPreviewsResponse = { previews };
    return Response.json(body, {
      headers: { 'Cache-Control': maxAge > 0 ? `private, max-age=${String(maxAge)}` : 'no-store' },
    });
  };
  if (!deps.enabled) return answer([], 0);

  const rate = await hitRateLimit(
    deps.db,
    `previews:${current.user.id}`,
    PREVIEW_REQUESTS_PER_MINUTE,
    60,
  );
  if (!rate.allowed) {
    return error(
      429,
      'RATE_LIMITED',
      'Too many requests. Please wait a moment.',
      rate.retryAfterMs,
    );
  }

  // Missing, deleted and "not yours" look the same.
  const body = uuid.safeParse(messageId).success
    ? await getReadableMessageBody(deps.db, current.user.id, messageId)
    : null;
  if (body === null) return error(404, 'NOT_FOUND', 'Message not found.');

  const links = extractLinks(body, LIMITS.linkPreview.perMessage).flatMap((href) => {
    const url = normalizeLink(href);
    return url ? [{ url, hash: hashLink(url) }] : [];
  });
  if (links.length === 0) return answer([], 300);

  const cached = await getFreshLinkPreviews(
    deps.db,
    links.map((l) => l.hash),
  );
  const lookup = deps.lookup ?? ((url: string) => fetchPreview(url, deps.fetchOptions));
  // Some links were skipped because of the fetch limit: the answer must not be kept by the browser.
  const skipped: string[] = [];
  const found = new Map<string, LinkPreviewWire>();
  const okHashes: string[] = [];
  await Promise.all(
    links.map(async ({ url, hash }) => {
      const hit = cached.get(hash);
      if (hit) {
        if (hit.status === 'ok' && hit.title) {
          okHashes.push(hash);
          found.set(hash, {
            url,
            title: hit.title,
            description: hit.description,
            siteName: hit.siteName,
          });
        }
        return;
      }
      const allowed = await hitRateLimit(
        deps.db,
        `preview-fetch:${current.user.id}`,
        LIMITS.linkPreview.fetchesPerMinute,
        60,
      );
      if (!allowed.allowed) {
        skipped.push(hash);
        return;
      }
      let result: PreviewLookup;
      try {
        result = await lookup(url);
      } catch (cause) {
        deps.logger?.warn('link preview failed', { error: cause });
        result = { status: 'error' };
      }
      const preview = result.status === 'ok' ? result.preview : null;
      await saveLinkPreview(deps.db, {
        urlHash: hash,
        url,
        status: result.status,
        title: preview?.title ?? null,
        description: preview?.description ?? null,
        siteName: preview?.siteName ?? null,
        ttlSeconds:
          result.status === 'error'
            ? LIMITS.linkPreview.errorTtlSeconds
            : LIMITS.linkPreview.ttlSeconds,
      });
      if (preview) {
        okHashes.push(hash);
        found.set(hash, { url, ...preview });
      }
    }),
  );
  await linkMessageToPreviews(deps.db, messageId, okHashes);

  // In the order the links appear in the message.
  const previews = links.flatMap(({ hash }) => {
    const preview = found.get(hash);
    return preview ? [preview] : [];
  });
  return answer(previews, skipped.length === 0 ? 300 : 0);
}
