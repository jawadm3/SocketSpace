'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { connectRealtime, type RealtimeSocket } from '@/lib/realtime-client';

type Status =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; reason: string }
  | { kind: 'unavailable' };

/**
 * Shows whether this page holds a live, authenticated connection to the realtime server.
 * Stage C proves the whole path (token, origin check, sign-in check); Stage D builds chat on it.
 */
export function LiveStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });

  useEffect(() => {
    let socket: RealtimeSocket | null = null;
    let cancelled = false;

    connectRealtime().then(
      (connected) => {
        if (cancelled) {
          connected.close();
          return;
        }
        socket = connected;
        connected.on('server:hello', () => {
          setStatus({ kind: 'connected' });
        });
        connected.on('disconnect', (reason) => {
          setStatus({ kind: 'reconnecting', reason });
        });
        connected.on('connect_error', () => {
          setStatus({ kind: 'reconnecting', reason: 'connect_error' });
        });
        connected.on('session:ended', ({ reason }) => {
          if (reason === 'server_shutdown') return; // Socket.IO reconnects on its own.
          connected.close();
          router.push('/sign-in');
          router.refresh();
        });
      },
      () => {
        if (!cancelled) setStatus({ kind: 'unavailable' });
      },
    );

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [router]);

  const text = {
    connecting: 'Connecting to live chat…',
    connected: 'Connected to live chat',
    reconnecting: 'Reconnecting to live chat… (on our free hosting this can take up to a minute)',
    unavailable: 'Live chat is unavailable right now.',
  }[status.kind];
  const dot =
    status.kind === 'connected'
      ? 'bg-emerald-500'
      : status.kind === 'unavailable'
        ? 'bg-danger'
        : 'bg-stamp';

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
      <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
      {text}
    </p>
  );
}
