/**
 * The rules of the random-chat screens (RAND-03 to RAND-09): which screen is shown, what a
 * message looks like while sending and afterwards, how offers are tracked, and that events from
 * another chat are ignored.
 */
import { describe, expect, it } from 'vitest';

import {
  describeEnding,
  initialRandomState,
  parseInterests,
  randomReducer,
  type RandomAction,
  type RandomState,
} from './state';

const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MASKED = `what a ${String.fromCodePoint(0x2022).repeat(4)} day`;

function run(actions: RandomAction[], from: RandomState = initialRandomState()): RandomState {
  return actions.reduce(randomReducer, from);
}

const inChat = (interests: string[] = ['chess']) =>
  run([
    { type: 'join-requested', interests, now: 1000 },
    { type: 'matched', sessionId: SESSION, sharedInterests: interests },
  ]);

const relayed = (
  clientId: string,
  from: 'me' | 'them',
  text: string,
  at = '2026-10-04T10:00:00Z',
) => ({ type: 'message', message: { sessionId: SESSION, clientId, from, text, at } }) as const;

describe('lobby, search and match', () => {
  it('starts in the lobby and searches after "Start"', () => {
    const state = run([{ type: 'join-requested', interests: ['chess'], now: 5000 }]);
    expect(state).toMatchObject({ phase: 'searching', interests: ['chess'], waitingSince: 5000 });
    expect(run([{ type: 'waiting', since: 5200 }], state).waitingSince).toBe(5200);
  });

  it('goes back to the lobby with the reason when joining is refused', () => {
    const state = run([
      { type: 'join-requested', interests: ['chess'], now: 1000 },
      {
        type: 'join-refused',
        message: 'Random chat is paused for you.',
        retryAfterMs: 60_000,
        now: 2000,
      },
    ]);
    expect(state).toMatchObject({
      phase: 'lobby',
      interests: ['chess'],
      refusal: { message: 'Random chat is paused for you.', until: 62_000 },
    });
    const noTime = run([{ type: 'join-refused', message: 'No.', now: 2000 }]);
    expect(noTime.refusal).toEqual({ message: 'No.', until: null });
  });

  it('cancels a search, but not a chat', () => {
    const searching = run([{ type: 'join-requested', interests: [], now: 1 }]);
    expect(run([{ type: 'search-cancelled' }], searching).phase).toBe('lobby');
    expect(run([{ type: 'search-cancelled' }], inChat()).phase).toBe('chat');
  });

  it('opens the chat on a match and forgets the previous chat', () => {
    const before = run(
      [relayed('a', 'them', 'old message'), { type: 'ended', sessionId: SESSION, reason: 'end' }],
      inChat(),
    );
    const next = run(
      [
        { type: 'join-requested', interests: ['chess'], now: 9000 },
        { type: 'matched', sessionId: OTHER, sharedInterests: [] },
      ],
      before,
    );
    expect(next).toMatchObject({
      phase: 'chat',
      sessionId: OTHER,
      sharedInterests: [],
      messages: [],
      endReason: null,
      suggestions: [],
    });
  });

  it('a pause takes a searching person back to the lobby', () => {
    const searching = run([{ type: 'join-requested', interests: ['chess'], now: 1 }]);
    expect(run([{ type: 'paused' }], searching).phase).toBe('lobby');
    expect(run([{ type: 'paused' }], inChat()).phase).toBe('chat');
  });
});

describe('messages', () => {
  it('shows my message as sending, then as the server relayed it', () => {
    const sending = run(
      [{ type: 'message-sending', clientId: 'c1', text: 'what a day', at: '2026-10-04T10:00:00Z' }],
      inChat(),
    );
    expect(sending.messages).toMatchObject([{ clientId: 'c1', from: 'me', status: 'sending' }]);
    // The server's copy replaces it (here with a masked word), once.
    const sent = run(
      [relayed('c1', 'me', MASKED), { type: 'message-sent', clientId: 'c1' }],
      sending,
    );
    expect(sent.messages).toEqual([
      { clientId: 'c1', from: 'me', text: MASKED, at: '2026-10-04T10:00:00Z', status: 'sent' },
    ]);
  });

  it('marks an acknowledged message as sent even before its echo arrives', () => {
    const state = run(
      [
        { type: 'message-sending', clientId: 'c1', text: 'hello', at: '2026-10-04T10:00:00Z' },
        { type: 'message-sent', clientId: 'c1' },
      ],
      inChat(),
    );
    expect(state.messages[0]?.status).toBe('sent');
  });

  it('keeps a refused message with the reason; it can be tried again or deleted', () => {
    const failed = run(
      [
        {
          type: 'message-sending',
          clientId: 'c1',
          text: 'see example.com',
          at: '2026-10-04T10:00:00Z',
        },
        { type: 'message-failed', clientId: 'c1', error: "Links aren't allowed in random chats." },
      ],
      inChat(),
    );
    expect(failed.messages).toMatchObject([
      { status: 'failed', error: "Links aren't allowed in random chats." },
    ]);
    const retried = run(
      [
        {
          type: 'message-sending',
          clientId: 'c1',
          text: 'see example.com',
          at: '2026-10-04T10:00:05Z',
        },
      ],
      failed,
    );
    expect(retried.messages).toHaveLength(1);
    expect(retried.messages[0]?.status).toBe('sending');
    expect(run([{ type: 'message-dismissed', clientId: 'c1' }], failed).messages).toEqual([]);
  });

  it('adds their messages in order and clears "is typing"', () => {
    const state = run(
      [
        { type: 'typing', sessionId: SESSION, typing: true },
        relayed('t1', 'them', 'hello'),
        relayed('t2', 'them', 'anyone?'),
      ],
      inChat(),
    );
    expect(state.messages.map((m) => m.text)).toEqual(['hello', 'anyone?']);
    expect(state.partnerTyping).toBe(false);
    expect(run([{ type: 'typing', sessionId: SESSION, typing: true }], state).partnerTyping).toBe(
      true,
    );
  });

  it('the same client ID from both people gives two messages', () => {
    const state = run([relayed('same', 'me', 'mine'), relayed('same', 'them', 'theirs')], inChat());
    expect(state.messages.map((m) => [m.from, m.text])).toEqual([
      ['me', 'mine'],
      ['them', 'theirs'],
    ]);
  });

  it('ignores everything that belongs to another chat', () => {
    const before = inChat();
    const after = run(
      [
        {
          type: 'message',
          message: {
            sessionId: OTHER,
            clientId: 'x',
            from: 'them',
            text: 'late',
            at: '2026-10-04T09:00:00Z',
          },
        },
        { type: 'typing', sessionId: OTHER, typing: true },
        { type: 'offered', sessionId: OTHER, offer: 'add_contact' },
        {
          type: 'shared',
          sessionId: OTHER,
          profile: { id: OTHER, nickname: 'nobody', avatar: null },
        },
        { type: 'contact-added', sessionId: OTHER },
        { type: 'ended', sessionId: OTHER, reason: 'end' },
      ],
      before,
    );
    expect(after).toEqual(before);
  });

  it('fills in what was missed after a reconnect, without doubling anything', () => {
    const before = run(
      [
        relayed('m1', 'me', 'before the drop', '2026-10-04T10:00:00Z'),
        {
          type: 'message-sending',
          clientId: 'm3',
          text: 'typed while away',
          at: '2026-10-04T10:00:09Z',
        },
      ],
      inChat(),
    );
    const after = run(
      [
        {
          type: 'resumed',
          sessionId: SESSION,
          sharedInterests: ['chess'],
          messages: [
            {
              sessionId: SESSION,
              clientId: 'm1',
              from: 'me',
              text: 'before the drop',
              at: '2026-10-04T10:00:00Z',
            },
            {
              sessionId: SESSION,
              clientId: 't2',
              from: 'them',
              text: 'still there?',
              at: '2026-10-04T10:00:05Z',
            },
          ],
        },
      ],
      before,
    );
    expect(after.messages.map((m) => [m.text, m.status])).toEqual([
      ['before the drop', 'sent'],
      ['still there?', 'sent'],
      ['typed while away', 'sending'],
    ]);
  });
});

describe('sharing a profile and adding a contact', () => {
  it('tracks who asked, and shows the profile only once both did', () => {
    let state = run([{ type: 'offer-sent', offer: 'add_contact' }], inChat());
    expect(state.offers.add_contact).toEqual({ mine: true, theirs: false, done: false });
    expect(state.partnerProfile).toBeNull();

    state = run(
      [
        {
          type: 'shared',
          sessionId: SESSION,
          profile: { id: OTHER, nickname: 'sam', avatar: null },
        },
        { type: 'contact-added', sessionId: SESSION },
      ],
      state,
    );
    expect(state.partnerProfile).toMatchObject({ nickname: 'sam' });
    expect(state.offers.add_contact.done).toBe(true);
    expect(state.offers.share_profile.done).toBe(true);
  });

  it('remembers their request, and takes mine back when the server refuses it', () => {
    const asked = run([{ type: 'offered', sessionId: SESSION, offer: 'share_profile' }], inChat());
    expect(asked.offers.share_profile).toEqual({ mine: false, theirs: true, done: false });
    const refused = run(
      [
        { type: 'offer-sent', offer: 'add_contact' },
        { type: 'offer-refused', offer: 'add_contact' },
      ],
      inChat(),
    );
    expect(refused.offers.add_contact.mine).toBe(false);
  });
});

describe('the end of a chat', () => {
  it('shows the end screen with the reason and the suggested rooms, keeping the messages', () => {
    const rooms = [{ id: OTHER, slug: 'chess-club', name: 'Chess club', memberCount: 12 }];
    const state = run(
      [
        relayed('t1', 'them', 'bye'),
        { type: 'message-sending', clientId: 'c9', text: 'wait', at: '2026-10-04T10:01:00Z' },
        { type: 'ended', sessionId: SESSION, reason: 'skip' },
        { type: 'suggestion', rooms },
      ],
      inChat(),
    );
    expect(state).toMatchObject({ phase: 'ended', endReason: 'skip', suggestions: rooms });
    expect(state.messages.map((m) => m.status)).toEqual(['sent', 'failed']);
    // A second "ended" changes nothing.
    expect(run([{ type: 'ended', sessionId: SESSION, reason: 'end' }], state).endReason).toBe(
      'skip',
    );
  });

  it('knows when the ending was mine, a report or a block', () => {
    const mine = run(
      [{ type: 'end-requested' }, { type: 'ended', sessionId: SESSION, reason: 'end' }],
      inChat(),
    );
    expect(mine.endedByMe).toBe(true);
    expect(run([{ type: 'reported' }], mine).reported).toBe(true);
    expect(run([{ type: 'blocked' }], mine).blocked).toBe(true);
    expect(run([{ type: 'reset' }], mine)).toEqual(initialRandomState(['chess']));
  });

  it('says in plain words why a chat ended', () => {
    expect(describeEnding('end', true)).toBe('You ended the chat.');
    expect(describeEnding('end', false)).toBe('The stranger left the chat.');
    expect(describeEnding('skip', false)).toBe('The stranger left the chat.');
    expect(describeEnding('disconnect', false)).toContain('lost');
    expect(describeEnding('filter', false)).toContain('broke the rules');
    expect(describeEnding('timeout', false)).toContain('10 minutes');
    expect(describeEnding('report', true)).toContain('moderator');
    expect(describeEnding(null, false)).toBe('The chat has ended.');
  });
});

describe('interests as typed', () => {
  it('become tags: trimmed, lower case, unique, at most five, 2 to 24 characters', () => {
    expect(parseInterests(' Chess,  Old   Films ,chess\nmusic')).toEqual([
      'chess',
      'old films',
      'music',
    ]);
    expect(parseInterests('a, ab, ' + 'x'.repeat(25))).toEqual(['ab']);
    expect(parseInterests('a1,b2,c3,d4,e5,f6,g7')).toHaveLength(5);
    expect(parseInterests('')).toEqual([]);
  });
});
