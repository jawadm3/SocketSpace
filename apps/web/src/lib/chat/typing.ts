/**
 * When to send `typing:set` (RT-04). The server accepts one per person every 2 seconds and drops
 * the rest silently; other people's browsers hide the indicator 6 seconds after the last one.
 *
 * - While someone keeps typing, "typing" is repeated every 3 seconds, so it never expires early.
 * - "Stopped" is sent when the message is sent or the text is cleared, but only if "typing" was
 *   sent recently; a send too soon after the previous one waits for the gap, and is cancelled if
 *   typing starts again meanwhile.
 * - Switching to another conversation stops the indicator in the old one first.
 */
export const TYPING_REPEAT_MS = 3000;
/** A little over the server's 2 seconds, so clock jitter never makes it drop a signal. */
export const TYPING_MIN_GAP_MS = 2100;
const TYPING_SHOWN_MS = 6000;

export interface TypingClock {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export class TypingThrottle {
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private lastTypingAt = Number.NEGATIVE_INFINITY;
  private conversationId: string | null = null;
  private queued: { conversationId: string; typing: boolean } | null = null;
  private timer: unknown = null;

  constructor(
    private readonly emit: (conversationId: string, typing: boolean) => void,
    private readonly clock: TypingClock = {
      now: () => Date.now(),
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    },
  ) {}

  /** Call on every keystroke that leaves text in the composer. */
  typing(conversationId: string): void {
    if (this.conversationId !== null && this.conversationId !== conversationId) {
      this.stopped(this.conversationId);
    }
    const now = this.clock.now();
    if (this.queued?.conversationId === conversationId && !this.queued.typing) {
      // Typing again before "stopped" went out: keep the indicator instead.
      this.cancelQueued();
    }
    if (this.conversationId === conversationId && now - this.lastTypingAt < TYPING_REPEAT_MS) {
      return;
    }
    this.conversationId = conversationId;
    this.lastTypingAt = now;
    this.send({ conversationId, typing: true });
  }

  /** Call when the message is sent, the text is cleared, or the composer goes away. */
  stopped(conversationId: string): void {
    if (this.conversationId !== conversationId) return;
    this.conversationId = null;
    if (this.queued?.conversationId === conversationId && this.queued.typing) {
      // "Typing" never went out, so there is nothing to take back.
      this.cancelQueued();
      return;
    }
    if (this.clock.now() - this.lastTypingAt >= TYPING_SHOWN_MS) return; // already hidden
    this.lastTypingAt = Number.NEGATIVE_INFINITY;
    this.send({ conversationId, typing: false });
  }

  dispose(): void {
    this.cancelQueued();
  }

  private send(signal: { conversationId: string; typing: boolean }): void {
    const wait = this.lastSentAt + TYPING_MIN_GAP_MS - this.clock.now();
    if (wait <= 0 && this.queued === null) {
      this.lastSentAt = this.clock.now();
      this.emit(signal.conversationId, signal.typing);
      return;
    }
    // Only the latest signal matters; it goes out as soon as the gap allows.
    this.queued = signal;
    this.timer ??= this.clock.setTimeout(
      () => {
        this.timer = null;
        const next = this.queued;
        this.queued = null;
        if (!next) return;
        this.lastSentAt = this.clock.now();
        this.emit(next.conversationId, next.typing);
      },
      Math.max(0, wait),
    );
  }

  private cancelQueued(): void {
    this.queued = null;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
