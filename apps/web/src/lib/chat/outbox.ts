/**
 * The send outbox (RECON-04, realtime-protocol.md "Reconnection and resync"): messages written
 * but not yet stored by the server.
 *
 * - One message at a time, in the order they were written, so the server numbers them in that
 *   order too.
 * - Kept in `localStorage` (per person), so a reload or a crash does not lose them. Each re-send
 *   uses the same client ID, so the server can never store a message twice.
 * - While there is no connection, nothing is sent and no attempt is counted; sending resumes on
 *   reconnect.
 * - A failure that may pass (no answer, connection lost, "too many requests") is retried after
 *   1, 2, 4 and 8 seconds (or when the server says); after 5 attempts, or at once for a refusal
 *   (for example "you are muted"), the message is marked "Failed" and waits for "Try again".
 * - Signing out clears it, so unsent text never stays on a shared computer.
 */
import type { AckError } from '@socketspace/shared/errors';
import { messageSendSchema, type MessageWire } from '@socketspace/shared/events';
import { attachmentWireSchema, type AttachmentWire } from '@socketspace/shared/media';

export const OUTBOX_MAX_ATTEMPTS = 5;
const MAX_ITEMS = 100;
const STORAGE_PREFIX = 'socketspace:outbox:';

export interface OutboxItem {
  clientId: string;
  conversationId: string;
  body: string;
  replyToId?: string;
  /** Pictures already uploaded (the server keeps unused uploads for 24 hours). */
  attachments?: AttachmentWire[];
  /** Set once the outbox has given up; cleared by "Try again". */
  failed?: { code: string; message: string };
}

export type SendResult =
  { ok: true; message: MessageWire } | { ok: false; error: AckError; retryable: boolean };

export interface OutboxClock {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface OutboxDeps {
  send: (item: OutboxItem) => Promise<SendResult>;
  isConnected: () => boolean;
  onSent: (clientId: string, message: MessageWire) => void;
  onFailed: (clientId: string, error: { code: string; message: string }) => void;
  /** `null` where storage is unavailable (private mode, blocked): the outbox then lives in memory. */
  storage: KeyValueStore | null;
  userId: string;
  clock?: OutboxClock;
}

/** Wait before attempt `attempt + 1`: 1 s, 2 s, 4 s, 8 s (at most 16 s), or the server's hint. */
export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  const backoff = Math.min(16_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return retryAfterMs !== undefined ? Math.max(retryAfterMs, 250) : backoff;
}

export function outboxStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

/** Removes every saved outbox in this browser (on sign-out). */
export function clearAllOutboxes(storage: Storage | null): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage blocked: there is nothing saved either.
  }
}

function isFailure(value: unknown): value is { code: string; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const { code, message } = value as Record<string, unknown>;
  return typeof code === 'string' && typeof message === 'string';
}

/** Saved items that still pass the send contract; anything else is dropped. */
function parseSaved(raw: string | null): OutboxItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = (data as { v?: unknown; items?: unknown }).items;
  if ((data as { v?: unknown }).v !== 1 || !Array.isArray(items)) return [];
  const valid: OutboxItem[] = [];
  for (const entry of items.slice(0, MAX_ITEMS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { clientId, conversationId, body, replyToId, failed, attachments } = entry as Record<
      string,
      unknown
    >;
    const pictures = attachmentWireSchema.array().safeParse(attachments ?? []);
    if (!pictures.success) continue;
    const checked = messageSendSchema.safeParse({
      clientId,
      conversationId,
      body,
      ...(replyToId === undefined ? {} : { replyToId }),
      ...(pictures.data.length > 0 ? { attachmentIds: pictures.data.map((a) => a.id) } : {}),
    });
    if (!checked.success) continue;
    valid.push({
      clientId: clientId as string,
      conversationId: conversationId as string,
      body: body as string,
      ...(typeof replyToId === 'string' ? { replyToId } : {}),
      ...(pictures.data.length > 0 ? { attachments: pictures.data } : {}),
      ...(isFailure(failed) ? { failed: { code: failed.code, message: failed.message } } : {}),
    });
  }
  return valid;
}

export class Outbox {
  private items: (OutboxItem & { attempts: number })[] = [];
  private busy = false;
  private timer: unknown = null;
  private disposed = false;
  private readonly clock: OutboxClock;

  constructor(private readonly deps: OutboxDeps) {
    this.clock = deps.clock ?? {
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    };
  }

  /** Loads what an earlier page left unsent; returns it so the screen can show it. */
  restore(): OutboxItem[] {
    let raw: string | null = null;
    try {
      raw = this.deps.storage?.getItem(outboxStorageKey(this.deps.userId)) ?? null;
    } catch {
      // Unreadable storage: start empty.
    }
    const known = new Set(this.items.map((i) => i.clientId));
    const saved = parseSaved(raw).filter((i) => !known.has(i.clientId));
    this.items.push(...saved.map((item) => ({ ...item, attempts: 0 })));
    return saved;
  }

  get size(): number {
    return this.items.length;
  }

  add(item: Omit<OutboxItem, 'failed'>): void {
    if (this.items.some((i) => i.clientId === item.clientId)) return;
    this.items.push({ ...item, attempts: 0 });
    this.save();
    this.pump();
  }

  retry(clientId: string): void {
    const item = this.items.find((i) => i.clientId === clientId);
    if (!item) return;
    delete item.failed;
    item.attempts = 0;
    this.save();
    this.pump();
  }

  remove(clientId: string): void {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.clientId !== clientId);
    if (this.items.length !== before) this.save();
  }

  /** The connection is (back) up: send now instead of waiting for a back-off timer. */
  connected(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    this.pump();
  }

  /** Forgets everything, here and in storage (sign-out, ended session). */
  clear(): void {
    this.items = [];
    this.cancelTimer();
    try {
      this.deps.storage?.removeItem(outboxStorageKey(this.deps.userId));
    } catch {
      // Nothing more to do.
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private save(): void {
    try {
      const key = outboxStorageKey(this.deps.userId);
      if (this.items.length === 0) {
        this.deps.storage?.removeItem(key);
        return;
      }
      const items = this.items.slice(0, MAX_ITEMS).map(({ attempts: _attempts, ...item }) => item);
      this.deps.storage?.setItem(key, JSON.stringify({ v: 1, items }));
    } catch {
      // Storage full or blocked: the outbox still works for this page.
    }
  }

  private pump(): void {
    if (this.disposed || this.busy || this.timer !== null || !this.deps.isConnected()) return;
    const item = this.items.find((i) => !i.failed);
    if (!item) return;
    this.busy = true;
    item.attempts += 1;
    void this.deps.send(item).then((result) => {
      this.busy = false;
      if (this.disposed) return;
      if (!this.items.includes(item)) {
        // Deleted meanwhile; if it was stored anyway, the screen shows the stored copy.
        if (result.ok) this.deps.onSent(item.clientId, result.message);
        this.pump();
        return;
      }
      if (result.ok) {
        this.remove(item.clientId);
        this.deps.onSent(item.clientId, result.message);
        this.pump();
        return;
      }
      if (result.retryable && !this.deps.isConnected()) {
        // The connection dropped: that was no real attempt. Resume on reconnect.
        item.attempts -= 1;
        return;
      }
      if (result.retryable && item.attempts < OUTBOX_MAX_ATTEMPTS) {
        this.timer = this.clock.setTimeout(
          () => {
            this.timer = null;
            this.pump();
          },
          retryDelayMs(item.attempts, result.error.retryAfterMs),
        );
        return;
      }
      item.failed = {
        code: result.error.code,
        message: result.retryable
          ? `Not sent after ${String(OUTBOX_MAX_ATTEMPTS)} tries. ${result.error.message}`
          : result.error.message,
      };
      this.save();
      this.deps.onFailed(item.clientId, item.failed);
      this.pump();
    });
  }
}
