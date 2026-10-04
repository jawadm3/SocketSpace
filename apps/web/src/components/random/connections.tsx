'use client';

/**
 * Where random chat gets its live connection from.
 *
 * - Signed-in people are inside the app shell, which already holds one connection for every page
 *   (lib/chat/provider.tsx): `MemberRandom` uses that one.
 * - Guests have no app shell: `GuestRandom` opens its own connection with the guest session's
 *   token, and handles the few things the shell would otherwise do (a moderator's or automatic
 *   pause, the end of the session).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui';
import { useChat } from '@/lib/chat/provider';
import { describeModerationNotice } from '@/lib/chat/notifications';
import { connectRealtime, TokenRequestError, type RealtimeSocket } from '@/lib/realtime-client';

import { RandomChat, type RandomPauseNotice } from './random-chat';

export function MemberRandom({ pause }: { pause: RandomPauseNotice | null }) {
  const { socket, state } = useChat();
  return (
    <RandomChat
      socket={socket}
      connected={state.status === 'connected'}
      guest={false}
      pause={pause}
    />
  );
}

export function GuestRandom({ pause }: { pause: RandomPauseNotice | null }) {
  const router = useRouter();
  const [socket, setSocket] = useState<RealtimeSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live: RealtimeSocket | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const start = () => {
      retryTimer = null;
      connectRealtime().then(
        (opened) => {
          if (cancelled) {
            opened.close();
            return;
          }
          failures = 0;
          live = opened;
          opened.on('server:hello', () => {
            setConnected(true);
          });
          opened.on('disconnect', () => {
            setConnected(false);
          });
          opened.on('session:ended', ({ reason }) => {
            if (reason === 'server_shutdown') return; // Socket.IO reconnects on its own.
            opened.close();
            router.refresh();
          });
          opened.on('moderation:notice', ({ kind, reason, until }) => {
            setNotice(
              describeModerationNotice(
                kind,
                reason,
                until ? new Date(until).toLocaleString() : null,
              ),
            );
            // The page re-reads whether random chat is paused for this guest.
            router.refresh();
          });
          setSocket(opened);
        },
        (error: unknown) => {
          if (cancelled) return;
          // The guest session is gone (or not allowed): the page shows the gate again.
          if (error instanceof TokenRequestError && error.status !== 429 && error.status < 500) {
            setNotice('Your guest session has ended. Reload the page to start again.');
            return;
          }
          failures += 1;
          retryTimer = setTimeout(start, Math.min(30_000, 2000 * 2 ** (failures - 1)));
        },
      );
    };
    start();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      live?.close();
    };
  }, [router]);

  return (
    <div className="flex h-full flex-col">
      {notice ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4">
          <Alert tone="error">{notice}</Alert>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <RandomChat socket={socket} connected={connected} guest pause={pause} />
      </div>
    </div>
  );
}
