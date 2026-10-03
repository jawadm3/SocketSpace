'use client';

/**
 * What a message shows besides its text (MSG-08, MSG-09):
 *
 * - Pictures, loaded from our own `/api/media/<id>` (which checks who is asking). Each one has its
 *   size set before it loads, so the list never jumps. A click opens the full picture in a new tab.
 * - Link previews: a small text card per link (site, title, description). The server fetched the
 *   page; the browser never contacts the linked site until the person clicks, and the card holds
 *   no image, so the site cannot track who saw the message.
 */
import { useEffect, useState } from 'react';

import { extractLinks } from '@socketspace/shared/markdown';
import {
  linkPreviewsResponseSchema,
  mediaPath,
  type AttachmentWire,
  type LinkPreviewWire,
} from '@socketspace/shared/media';

import { LINK_REL } from './message-body';

const MAX_WIDTH = 320;
const MAX_HEIGHT = 240;

/** The size a picture is shown at: scaled down to fit, never up. */
export function displaySize(attachment: Pick<AttachmentWire, 'width' | 'height'>) {
  const scale = Math.min(1, MAX_WIDTH / attachment.width, MAX_HEIGHT / attachment.height);
  return {
    width: Math.max(1, Math.round(attachment.width * scale)),
    height: Math.max(1, Math.round(attachment.height * scale)),
  };
}

export function MessageAttachments({
  attachments,
  authorName,
  dimmed = false,
}: {
  attachments: readonly AttachmentWire[];
  authorName: string;
  /** Not sent yet. */
  dimmed?: boolean;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className={`mt-1 flex flex-wrap gap-2 ${dimmed ? 'opacity-70' : ''}`} aria-label="Pictures">
      {attachments.map((attachment, index) => {
        const size = displaySize(attachment);
        const label =
          attachments.length === 1
            ? `Picture from ${authorName}`
            : `Picture ${String(index + 1)} of ${String(attachments.length)} from ${authorName}`;
        return (
          <li key={attachment.id}>
            <a
              href={mediaPath(attachment.id)}
              target="_blank"
              rel="noopener"
              className="block overflow-hidden rounded-xl border border-line bg-surface-2"
              aria-label={`${label} (opens in a new tab)`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- our own media route, already small WebP */}
              <img
                src={mediaPath(attachment.id)}
                alt={label}
                width={size.width}
                height={size.height}
                loading="lazy"
                decoding="async"
                data-testid="message-picture"
                className="block max-w-full"
                style={{
                  width: size.width,
                  aspectRatio: `${String(size.width)} / ${String(size.height)}`,
                }}
              />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** One request per message version, shared by every place that shows the message. */
const previewCache = new Map<string, Promise<LinkPreviewWire[]>>();
const CACHE_MAX = 500;

function loadPreviews(messageId: string, version: string): Promise<LinkPreviewWire[]> {
  const key = `${messageId}:${version}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  const request = fetch(`/api/messages/${messageId}/previews`, { credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const parsed = linkPreviewsResponseSchema.safeParse(await response.json());
      return parsed.success ? parsed.data.previews : [];
    })
    .catch(() => {
      // Not kept: the next time the message is shown, it is tried again.
      previewCache.delete(key);
      return [];
    });
  if (previewCache.size >= CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(key, request);
  return request;
}

export function LinkPreviews({
  messageId,
  body,
  editedAt,
}: {
  messageId: string;
  body: string;
  editedAt: string | null;
}) {
  const [previews, setPreviews] = useState<LinkPreviewWire[]>([]);
  // Only messages that contain a link ask the server at all.
  const hasLinks = body.includes('http') && extractLinks(body, 1).length > 0;
  const version = editedAt ?? '';
  useEffect(() => {
    if (!hasLinks) return;
    let current = true;
    void loadPreviews(messageId, version).then((loaded) => {
      if (current) setPreviews(loaded);
    });
    return () => {
      current = false;
    };
  }, [hasLinks, messageId, version]);

  if (!hasLinks || previews.length === 0) return null;
  return (
    <ul className="mt-1 flex max-w-xl flex-col gap-1.5" aria-label="Link previews">
      {previews.map((preview) => (
        <li
          key={preview.url}
          data-testid="link-preview"
          className="rounded-lg border border-line border-l-4 border-l-accent bg-card px-3 py-2"
        >
          {preview.siteName ? (
            <p className="truncate text-xs font-semibold text-muted">{preview.siteName}</p>
          ) : null}
          <a
            href={preview.url}
            target="_blank"
            rel={LINK_REL}
            className="line-clamp-2 text-sm font-bold text-accent underline"
          >
            {preview.title}
          </a>
          {preview.description ? (
            <p className="mt-0.5 line-clamp-3 text-sm text-ink-2">{preview.description}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
