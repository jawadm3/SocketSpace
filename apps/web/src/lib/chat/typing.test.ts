/**
 * Typing signals (RT-04): repeated while typing, never faster than the server accepts, and a
 * "stopped" that is only sent when it matters.
 */
import { describe, expect, it } from 'vitest';

import { TYPING_MIN_GAP_MS, TypingThrottle, type TypingClock } from './typing';

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 1;
  const clock: TypingClock = {
    now: () => now,
    setTimeout: (run, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      timers = timers.filter((t) => t !== due);
      due.run();
    }
    now = until;
  };
  return { clock, advance };
}

function setup() {
  const sent: { at: number; conversationId: string; typing: boolean }[] = [];
  const { clock, advance } = fakeClock();
  const throttle = new TypingThrottle((conversationId, typing) => {
    sent.push({ at: clock.now(), conversationId, typing });
  }, clock);
  return { sent, advance, throttle };
}

describe('TypingThrottle', () => {
  it('sends "typing" at once, then at most every 3 seconds while keys keep coming', () => {
    const { sent, advance, throttle } = setup();
    for (let i = 0; i < 70; i++) {
      throttle.typing('room');
      advance(100);
    }
    expect(sent.map((s) => s.at)).toEqual([0, 3000, 6000]);
    expect(sent.every((s) => s.typing)).toBe(true);
  });

  it('delays "stopped" until the server will accept it, and drops it if typing resumes', () => {
    const { sent, advance, throttle } = setup();
    throttle.typing('room');
    advance(500);
    throttle.stopped('room');
    expect(sent).toHaveLength(1);
    advance(TYPING_MIN_GAP_MS);
    expect(sent.map((s) => [s.at, s.typing])).toEqual([
      [0, true],
      [TYPING_MIN_GAP_MS, false],
    ]);

    // Typing again before a queued "stopped" goes out cancels it.
    advance(5000);
    throttle.typing('room');
    advance(500);
    throttle.stopped('room'); // queued: too soon after "typing"
    advance(100);
    throttle.typing('room');
    advance(5000);
    expect(sent.filter((s) => !s.typing)).toHaveLength(1);
    expect(sent.at(-1)?.typing).toBe(true);
  });

  it('sends nothing for "stopped" when "typing" was never sent or has already expired', () => {
    const { sent, advance, throttle } = setup();
    throttle.stopped('room');
    throttle.typing('room');
    advance(7000);
    throttle.stopped('room');
    advance(5000);
    expect(sent.map((s) => s.typing)).toEqual([true]);
  });

  it('never sends two signals closer together than the server allows', () => {
    const { sent, advance, throttle } = setup();
    throttle.typing('a');
    advance(200);
    throttle.typing('b'); // moving to another room stops "a" first
    advance(10_000);
    for (let i = 1; i < sent.length; i++) {
      expect((sent[i]?.at ?? 0) - (sent[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(TYPING_MIN_GAP_MS);
    }
    expect(sent.at(-1)).toMatchObject({ conversationId: 'b', typing: true });
  });
});
