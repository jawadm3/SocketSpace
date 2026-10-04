/**
 * What the browser knows about random chat, and the rules for changing it (RAND-03 to RAND-09).
 * A pure reducer: no socket, no clock of its own, so every rule can be tested exactly. The hook in
 * use-random-chat.ts wires the realtime events to it.
 *
 * The four screens are the four phases: `lobby` (pick interests, start), `searching` (waiting for
 * a match), `chat`, and `ended` (why it ended, suggested rooms, start again).
 *
 * Events name the chat they belong to. An event for any other chat than the current one is
 * ignored, so a late event from the previous chat can never leak into the next.
 */
import type { RANDOM_END_REASONS } from '@socketspace/shared/domain';
import type { ServerPayload } from '@socketspace/shared/events';

export type RandomEndReason = (typeof RANDOM_END_REASONS)[number];

export type RandomPhase = 'lobby' | 'searching' | 'chat' | 'ended';
export type RandomOffer = 'share_profile' | 'add_contact';
export type SuggestedRoom = ServerPayload<'random:suggestion'>['rooms'][number];
export type SharedProfile = ServerPayload<'random:shared'>['profile'];

export interface RandomMessage {
  clientId: string;
  from: 'me' | 'them';
  /** As the server relayed it (a filtered word is masked); the typed text while still sending. */
  text: string;
  at: string;
  status: 'sending' | 'sent' | 'failed';
  /** Why it was not sent, in the server's words. */
  error?: string;
}

export interface OfferState {
  /** I asked for it. */
  mine: boolean;
  /** The other person asked for it. */
  theirs: boolean;
  /** Both asked: it happened. */
  done: boolean;
}

export interface RandomRefusal {
  message: string;
  /** When trying again can work (milliseconds since 1970), if the server said. */
  until: number | null;
}

export interface RandomState {
  phase: RandomPhase;
  interests: string[];
  /** When the search started (milliseconds since 1970). */
  waitingSince: number | null;
  sessionId: string | null;
  sharedInterests: string[];
  messages: RandomMessage[];
  partnerTyping: boolean;
  offers: Record<RandomOffer, OfferState>;
  partnerProfile: SharedProfile | null;
  endReason: RandomEndReason | null;
  /** I pressed "End" (or blocked or reported), so the ending is mine. */
  endedByMe: boolean;
  reported: boolean;
  blocked: boolean;
  suggestions: SuggestedRoom[];
  /** Why starting was refused, shown in the lobby. */
  refusal: RandomRefusal | null;
}

const noOffers = (): Record<RandomOffer, OfferState> => ({
  share_profile: { mine: false, theirs: false, done: false },
  add_contact: { mine: false, theirs: false, done: false },
});

export function initialRandomState(interests: string[] = []): RandomState {
  return {
    phase: 'lobby',
    interests,
    waitingSince: null,
    sessionId: null,
    sharedInterests: [],
    messages: [],
    partnerTyping: false,
    offers: noOffers(),
    partnerProfile: null,
    endReason: null,
    endedByMe: false,
    reported: false,
    blocked: false,
    suggestions: [],
    refusal: null,
  };
}

export type RandomAction =
  | { type: 'join-requested'; interests: string[]; now: number }
  | { type: 'waiting'; since: number }
  | { type: 'join-refused'; message: string; retryAfterMs?: number | undefined; now: number }
  | { type: 'search-cancelled' }
  | { type: 'matched'; sessionId: string; sharedInterests: string[] }
  | { type: 'message-sending'; clientId: string; text: string; at: string }
  | { type: 'message-sent'; clientId: string }
  | { type: 'message-failed'; clientId: string; error: string }
  | { type: 'message-dismissed'; clientId: string }
  | { type: 'message'; message: ServerPayload<'random:message'> }
  | { type: 'typing'; sessionId: string; typing: boolean }
  | { type: 'offer-sent'; offer: RandomOffer }
  | { type: 'offer-refused'; offer: RandomOffer }
  | { type: 'offered'; sessionId: string; offer: RandomOffer }
  | { type: 'shared'; sessionId: string; profile: SharedProfile }
  | { type: 'contact-added'; sessionId: string }
  | { type: 'end-requested' }
  | { type: 'ended'; sessionId: string; reason: RandomEndReason }
  | { type: 'suggestion'; rooms: SuggestedRoom[] }
  | { type: 'reported' }
  | { type: 'blocked' }
  | {
      type: 'resumed';
      sessionId: string;
      sharedInterests: string[];
      messages: ServerPayload<'random:message'>[];
    }
  /** Random chat was paused for this person (a moderator's or an automatic decision). */
  | { type: 'paused' }
  | { type: 'reset' };

/** A fresh search: everything about the previous chat is forgotten. */
function searching(state: RandomState, interests: string[], since: number): RandomState {
  return { ...initialRandomState(interests), phase: 'searching', waitingSince: since };
}

function withOffer(
  state: RandomState,
  offer: RandomOffer,
  change: Partial<OfferState>,
): RandomState {
  return { ...state, offers: { ...state.offers, [offer]: { ...state.offers[offer], ...change } } };
}

function mergeMessage(
  messages: readonly RandomMessage[],
  incoming: ServerPayload<'random:message'>,
): RandomMessage[] {
  const relayed: RandomMessage = {
    clientId: incoming.clientId,
    from: incoming.from,
    text: incoming.text,
    at: incoming.at,
    status: 'sent',
  };
  const index = messages.findIndex(
    (m) => m.clientId === incoming.clientId && m.from === incoming.from,
  );
  if (index === -1) return [...messages, relayed];
  // My own message coming back: the server's copy (masked where the filter matched) replaces it.
  return messages.map((m, i) => (i === index ? relayed : m));
}

export function randomReducer(state: RandomState, action: RandomAction): RandomState {
  const current = (sessionId: string) => state.sessionId === sessionId;
  switch (action.type) {
    case 'join-requested':
      return searching(state, action.interests, action.now);
    case 'waiting':
      return state.phase === 'searching' ? { ...state, waitingSince: action.since } : state;
    case 'join-refused':
      return {
        ...initialRandomState(state.interests),
        refusal: {
          message: action.message,
          until: action.retryAfterMs === undefined ? null : action.now + action.retryAfterMs,
        },
      };
    case 'search-cancelled':
      return state.phase === 'searching' ? initialRandomState(state.interests) : state;
    case 'matched':
      return {
        ...initialRandomState(state.interests),
        phase: 'chat',
        sessionId: action.sessionId,
        sharedInterests: action.sharedInterests,
      };

    case 'message-sending':
      if (state.phase !== 'chat') return state;
      return {
        ...state,
        messages: [
          ...state.messages.filter((m) => m.clientId !== action.clientId),
          {
            clientId: action.clientId,
            from: 'me',
            text: action.text,
            at: action.at,
            status: 'sending',
          },
        ],
      };
    case 'message-sent':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.clientId === action.clientId && m.from === 'me' && m.status === 'sending'
            ? { ...m, status: 'sent' }
            : m,
        ),
      };
    case 'message-failed':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.clientId === action.clientId && m.from === 'me'
            ? { ...m, status: 'failed', error: action.error }
            : m,
        ),
      };
    case 'message-dismissed':
      return {
        ...state,
        messages: state.messages.filter(
          (m) => !(m.clientId === action.clientId && m.status === 'failed'),
        ),
      };
    case 'message':
      if (!current(action.message.sessionId)) return state;
      return {
        ...state,
        messages: mergeMessage(state.messages, action.message),
        // Their message arrived: they are no longer "typing".
        partnerTyping: action.message.from === 'them' ? false : state.partnerTyping,
      };
    case 'typing':
      return current(action.sessionId) && state.phase === 'chat'
        ? { ...state, partnerTyping: action.typing }
        : state;

    case 'offer-sent':
      return state.phase === 'chat' ? withOffer(state, action.offer, { mine: true }) : state;
    case 'offer-refused':
      return withOffer(state, action.offer, { mine: false });
    case 'offered':
      return current(action.sessionId) ? withOffer(state, action.offer, { theirs: true }) : state;
    case 'shared':
      if (!current(action.sessionId)) return state;
      return {
        ...withOffer(state, 'share_profile', { done: true }),
        partnerProfile: action.profile,
      };
    case 'contact-added':
      return current(action.sessionId) ? withOffer(state, 'add_contact', { done: true }) : state;

    case 'end-requested':
      return state.phase === 'chat' ? { ...state, endedByMe: true } : state;
    case 'ended':
      if (!current(action.sessionId) || state.phase !== 'chat') return state;
      return {
        ...state,
        phase: 'ended',
        endReason: action.reason,
        partnerTyping: false,
        // Anything still on its way was not delivered.
        messages: state.messages.map((m) =>
          m.status === 'sending'
            ? { ...m, status: 'failed', error: 'The chat ended before this was sent.' }
            : m,
        ),
      };
    case 'suggestion':
      return state.phase === 'ended' || state.phase === 'chat'
        ? { ...state, suggestions: action.rooms }
        : state;
    case 'reported':
      return { ...state, reported: true };
    case 'blocked':
      return { ...state, blocked: true };

    case 'resumed': {
      if (!current(action.sessionId)) return state;
      // The server's record fills in what was missed; my unsent messages stay as they are.
      let messages: RandomMessage[] = state.messages;
      for (const incoming of action.messages) messages = mergeMessage(messages, incoming);
      messages = [...messages].sort((a, b) => a.at.localeCompare(b.at));
      return { ...state, sharedInterests: action.sharedInterests, messages };
    }

    case 'paused':
      // A chat that was going on is ended by the server (`ended` arrives too); a search is not.
      return state.phase === 'searching' ? initialRandomState(state.interests) : state;
    case 'reset':
      return initialRandomState(state.interests);
  }
}

/** How each ending is put to the person. */
export function describeEnding(reason: RandomEndReason | null, byMe: boolean): string {
  switch (reason) {
    case 'skip':
    case 'end':
      return byMe ? 'You ended the chat.' : 'The stranger left the chat.';
    case 'disconnect':
      return 'The connection to the stranger was lost.';
    case 'report':
      return 'You reported this chat. A moderator will look at it.';
    case 'filter':
      return 'The chat was ended because a message broke the rules.';
    case 'timeout':
      return 'The chat ended because nobody wrote for 10 minutes.';
    case null:
      return 'The chat has ended.';
  }
}

/** Interests as typed ("Chess, old films") become tags: trimmed, lower case, unique, at most 5. */
export function parseInterests(typed: string, max = 5): string[] {
  const seen = new Set<string>();
  for (const part of typed.split(/[,\n]/)) {
    const tag = part.trim().replace(/\s+/g, ' ').toLowerCase();
    const length = Array.from(tag).length;
    if (length >= 2 && length <= 24) seen.add(tag);
    if (seen.size >= max) break;
  }
  return [...seen];
}
