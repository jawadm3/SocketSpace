'use client';

/**
 * Random chat in the browser: wires the realtime events to the rules in state.ts and offers the
 * page the actions a person can take (realtime-protocol.md, "Events: random-match mode").
 *
 * - Nothing is stored in the browser: messages live in this page's memory and are gone when the
 *   page is left (random chats are not saved, RAND-07).
 * - After a dropped connection the page picks the chat up again (`random:resume`, possible for
 *   15 seconds) or, if it was searching, joins the queue again.
 * - Leaving the page leaves the queue and ends the chat.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

import type { ReportReason } from '@socketspace/shared/domain';
import type { Ack } from '@socketspace/shared/errors';
import type { AckData, ServerPayload } from '@socketspace/shared/events';

import { TypingThrottle } from '@/lib/chat/typing';
import type { RealtimeSocket } from '@/lib/realtime-client';

import { initialRandomState, randomReducer, type RandomOffer, type RandomState } from './state';

const ACK_TIMEOUT_MS = 15_000;
/** The other person's "is typing" disappears after this long without an update. */
const TYPING_SHOWN_MS = 6000;
const NO_ANSWER = 'No answer from the server. Please try again.';

export interface RandomChatApi {
  state: RandomState;
  /** Something that went wrong with the last action, in the server's words. */
  problem: string | null;
  clearProblem: () => void;
  start: (interests: string[]) => void;
  cancel: () => void;
  send: (text: string) => void;
  retry: (clientId: string) => void;
  dismiss: (clientId: string) => void;
  typing: () => void;
  stoppedTyping: () => void;
  /** Ends this chat and looks for the next one. */
  next: () => void;
  end: () => void;
  /** Resolves `true` when the report was stored. */
  report: (reason: ReportReason, details: string) => Promise<boolean>;
  block: () => void;
  offer: (offer: RandomOffer) => void;
  backToLobby: () => void;
}

export function useRandomChat(socket: RealtimeSocket | null, connected: boolean): RandomChatApi {
  const [state, dispatch] = useReducer(randomReducer, undefined, () => initialRandomState());
  const [problem, setProblem] = useState<string | null>(null);
  // Socket callbacks run outside React's render, so they read the latest state from here.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const socketRef = useRef(socket);
  useLayoutEffect(() => {
    socketRef.current = socket;
  });

  // Events from the server.
  useEffect(() => {
    if (!socket) return;
    let typingTimer: ReturnType<typeof setTimeout> | null = null;
    const handlers = {
      waiting: ({ since }: ServerPayload<'random:waiting'>) => {
        dispatch({ type: 'waiting', since: Date.parse(since) });
      },
      matched: (payload: ServerPayload<'random:matched'>) => {
        dispatch({
          type: 'matched',
          sessionId: payload.sessionId,
          sharedInterests: payload.partner.sharedInterests,
        });
      },
      typing: ({ sessionId, typing }: ServerPayload<'random:typing'>) => {
        dispatch({ type: 'typing', sessionId, typing });
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = typing
          ? setTimeout(() => {
              dispatch({ type: 'typing', sessionId, typing: false });
            }, TYPING_SHOWN_MS)
          : null;
      },
    };
    socket.on('random:waiting', handlers.waiting);
    socket.on('random:matched', handlers.matched);
    socket.on('random:typing', handlers.typing);
    const onMessage = (message: ServerPayload<'random:message'>) => {
      dispatch({ type: 'message', message });
    };
    const onOffered = (payload: ServerPayload<'random:offered'>) => {
      dispatch({ type: 'offered', ...payload });
    };
    const onShared = (payload: ServerPayload<'random:shared'>) => {
      dispatch({ type: 'shared', ...payload });
    };
    const onContact = (payload: ServerPayload<'random:contact-added'>) => {
      dispatch({ type: 'contact-added', sessionId: payload.sessionId });
    };
    const onEnded = (payload: ServerPayload<'random:ended'>) => {
      dispatch({ type: 'ended', ...payload });
    };
    const onSuggestion = ({ rooms }: ServerPayload<'random:suggestion'>) => {
      dispatch({ type: 'suggestion', rooms });
    };
    const onNotice = ({ kind }: ServerPayload<'moderation:notice'>) => {
      // Paused while searching: the server took this person out of the queue.
      if (kind !== 'warned' && kind !== 'unmuted' && kind !== 'random_timeout_lifted') {
        dispatch({ type: 'paused' });
      }
    };
    socket.on('random:message', onMessage);
    socket.on('random:offered', onOffered);
    socket.on('random:shared', onShared);
    socket.on('random:contact-added', onContact);
    socket.on('random:ended', onEnded);
    socket.on('random:suggestion', onSuggestion);
    socket.on('moderation:notice', onNotice);
    return () => {
      if (typingTimer) clearTimeout(typingTimer);
      socket.off('random:waiting', handlers.waiting);
      socket.off('random:matched', handlers.matched);
      socket.off('random:typing', handlers.typing);
      socket.off('random:message', onMessage);
      socket.off('random:offered', onOffered);
      socket.off('random:shared', onShared);
      socket.off('random:contact-added', onContact);
      socket.off('random:ended', onEnded);
      socket.off('random:suggestion', onSuggestion);
      socket.off('moderation:notice', onNotice);
    };
  }, [socket]);

  const join = useCallback((interests: string[], skipping?: string) => {
    const live = socketRef.current;
    if (!live?.connected) {
      setProblem('Not connected to live chat. Try again in a moment.');
      return;
    }
    setProblem(null);
    dispatch({ type: 'join-requested', interests, now: Date.now() });
    const request = skipping
      ? live.timeout(ACK_TIMEOUT_MS).emitWithAck('random:next', { sessionId: skipping })
      : live.timeout(ACK_TIMEOUT_MS).emitWithAck('random:join', { interests });
    request.then(
      (ack: Ack<AckData<'random:join'>>) => {
        if (ack.ok) return;
        dispatch({
          type: 'join-refused',
          message: ack.error.message,
          retryAfterMs: ack.error.retryAfterMs,
          now: Date.now(),
        });
      },
      () => {
        dispatch({ type: 'join-refused', message: NO_ANSWER, now: Date.now() });
      },
    );
  }, []);

  // A connection that comes back: pick the chat up again, or go back into the queue.
  const everConnected = useRef(false);
  useEffect(() => {
    if (!socket || !connected) return;
    if (!everConnected.current) {
      everConnected.current = true;
      return;
    }
    const { phase, sessionId, interests } = stateRef.current;
    if (phase === 'searching') {
      join(interests);
    } else if (phase === 'chat' && sessionId) {
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('random:resume', { sessionId })
        .then(
          (ack: Ack<AckData<'random:resume'>>) => {
            if (ack.ok) dispatch({ type: 'resumed', ...ack.data });
            // Away for too long: the chat ended meanwhile.
            else dispatch({ type: 'ended', sessionId, reason: 'disconnect' });
          },
          () => undefined,
        );
    }
  }, [socket, connected, join]);

  // Leaving the page leaves the queue and ends the chat.
  useEffect(
    () => () => {
      const { phase } = stateRef.current;
      const live = socketRef.current;
      if (live?.connected && (phase === 'searching' || phase === 'chat')) {
        live.emit('random:leave', {}, () => undefined);
      }
    },
    [],
  );

  const typingThrottle = useRef<TypingThrottle | null>(null);
  useEffect(() => {
    const throttle = new TypingThrottle((sessionId, typing) => {
      socketRef.current?.emit('random:typing', { sessionId, typing });
    });
    typingThrottle.current = throttle;
    return () => {
      throttle.dispose();
      typingThrottle.current = null;
    };
  }, []);

  const deliver = useCallback((clientId: string, text: string) => {
    const live = socketRef.current;
    const { sessionId } = stateRef.current;
    if (!sessionId) return;
    dispatch({ type: 'message-sending', clientId, text, at: new Date().toISOString() });
    if (!live?.connected) {
      dispatch({ type: 'message-failed', clientId, error: 'Not connected. Try again.' });
      return;
    }
    typingThrottle.current?.stopped(sessionId);
    live
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('random:message', { sessionId, clientId, text })
      .then(
        (ack: Ack<AckData<'random:message'>>) => {
          dispatch(
            ack.ok
              ? { type: 'message-sent', clientId }
              : { type: 'message-failed', clientId, error: ack.error.message },
          );
        },
        () => {
          dispatch({ type: 'message-failed', clientId, error: NO_ANSWER });
        },
      );
  }, []);

  /** Sends an acknowledged event about the current chat; a refusal becomes `problem`. */
  const act = useCallback(
    async <T>(run: (live: RealtimeSocket, sessionId: string) => Promise<Ack<T>>) => {
      const live = socketRef.current;
      const { sessionId } = stateRef.current;
      if (!live?.connected || !sessionId) {
        setProblem('Not connected to live chat. Try again in a moment.');
        return false;
      }
      try {
        const ack = await run(live, sessionId);
        if (ack.ok) return true;
        setProblem(ack.error.message);
      } catch {
        setProblem(NO_ANSWER);
      }
      return false;
    },
    [],
  );

  return {
    state,
    problem,
    clearProblem: useCallback(() => {
      setProblem(null);
    }, []),
    start: useCallback(
      (interests: string[]) => {
        join(interests);
      },
      [join],
    ),
    cancel: useCallback(() => {
      dispatch({ type: 'search-cancelled' });
      socketRef.current?.emit('random:leave', {}, () => undefined);
    }, []),
    send: useCallback(
      (text: string) => {
        deliver(crypto.randomUUID(), text);
      },
      [deliver],
    ),
    retry: useCallback(
      (clientId: string) => {
        const failed = stateRef.current.messages.find(
          (m) => m.clientId === clientId && m.status === 'failed',
        );
        if (failed) deliver(clientId, failed.text);
      },
      [deliver],
    ),
    dismiss: useCallback((clientId: string) => {
      dispatch({ type: 'message-dismissed', clientId });
    }, []),
    typing: useCallback(() => {
      const { sessionId, phase } = stateRef.current;
      if (sessionId && phase === 'chat' && socketRef.current?.connected) {
        typingThrottle.current?.typing(sessionId);
      }
    }, []),
    stoppedTyping: useCallback(() => {
      const { sessionId } = stateRef.current;
      if (sessionId) typingThrottle.current?.stopped(sessionId);
    }, []),
    next: useCallback(() => {
      const { sessionId, interests, phase } = stateRef.current;
      join(interests, phase === 'chat' && sessionId ? sessionId : undefined);
    }, [join]),
    end: useCallback(() => {
      dispatch({ type: 'end-requested' });
      void act((live, sessionId) =>
        live.timeout(ACK_TIMEOUT_MS).emitWithAck('random:end', { sessionId }),
      );
    }, [act]),
    report: useCallback(
      async (reason: ReportReason, details: string) => {
        dispatch({ type: 'end-requested' });
        const stored = await act((live, sessionId) =>
          live
            .timeout(ACK_TIMEOUT_MS)
            .emitWithAck('random:report', { sessionId, reason, ...(details ? { details } : {}) }),
        );
        if (stored) dispatch({ type: 'reported' });
        return stored;
      },
      [act],
    ),
    block: useCallback(() => {
      dispatch({ type: 'end-requested' });
      void act((live, sessionId) =>
        live.timeout(ACK_TIMEOUT_MS).emitWithAck('random:block', { sessionId }),
      ).then((done) => {
        if (done) dispatch({ type: 'blocked' });
      });
    }, [act]),
    offer: useCallback(
      (offer: RandomOffer) => {
        // The other person asked first: this is the "yes".
        const event = stateRef.current.offers[offer].theirs ? 'random:accept' : 'random:offer';
        dispatch({ type: 'offer-sent', offer });
        void act((live, sessionId) =>
          live.timeout(ACK_TIMEOUT_MS).emitWithAck(event, { sessionId, offer }),
        ).then((done) => {
          if (!done) dispatch({ type: 'offer-refused', offer });
        });
      },
      [act],
    ),
    backToLobby: useCallback(() => {
      dispatch({ type: 'reset' });
    }, []),
  };
}
