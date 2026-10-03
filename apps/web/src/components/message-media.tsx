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
import { ImageOff } from 'lucide-react';
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

function Picture({ attachment, label }: { attachment: AttachmentWire; label: string }) {
  const [missing, setMissing] = useState(false);
  const size = displaySize(attachment);
  const box = {
    width: size.width,
    aspectRatio: `${String(size.width)} / ${String(size.height)}`,
  };
  if (missing) {
    // Deleted meanwhile, or no longer yours to see: say so instead of a broken-image mark.
    return (
      <span
        className="flex max-w-full items-center justify-center rounded-xl border border-line bg-surface-2 p-2 text-center text-xs text-muted"
        style={{ ...box, minWidth: 96, minHeight: 64 }}
      >
        <ImageOff aria-hidden="true" className="mr-1 h-4 w-4 shrink-0" />
        Picture not available
      </span>
    );
  }
  return (
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
        style={box}
        onError={() => {
          setMissing(true);
        }}
      />
    </a>
  );
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
      {attachments.map((attachment, index) => (
        <li key={attachment.id}>
          <Picture
            attachment={attachment}
            label={
              attachments.length === 1
                ? `Picture from ${authorName}`
                : `Picture ${String(index + 1)} of ${String(attachments.length)} from ${authorName}`
            }
          />
        </li>
      ))}
    </ul>
  );
}

/** One request per message version, shared by every place that shows the message. */
const previewCache = new Map<string, Promise<LinkPreviewWire[]>>();
const CACHE_MAX = 500;
const PENDING_RETRY_MS = 1500;
const PENDING_RETRIES = 4;

function loadPreviews(messageId: string, version: string): Promise<LinkPreviewWire[]> {
  const key = `${messageId}:${version}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  const ask = async (triesLeft: number): Promise<LinkPreviewWire[]> => {
    const response = await fetch(`/api/messages/${messageId}/previews`, {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(String(response.status));
    const parsed = linkPreviewsResponseSchema.safeParse(await response.json());
    if (!parsed.success) return [];
    // Another reader's request is fetching the page right now: ask again shortly.
    if (parsed.data.pending && triesLeft > 0) {
      await new Promise((done) => setTimeout(done, PENDING_RETRY_MS));
      return ask(triesLeft - 1);
    }
    return parsed.data.previews;
  };
  const request = ask(PENDING_RETRIES).catch(() => {
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
