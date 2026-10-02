/**
 * The browser's connection to the realtime server (realtime-protocol.md, "Connecting").
 *
 * 1. Ask this web app for a 5-minute token (`POST /api/realtime/token`, same-site cookie).
 *    The answer also says where the realtime server is, so no address is built into the bundle.
 * 2. Connect with the token in the handshake body (never in the URL, so it is not logged).
 * 3. On every reconnect, Socket.IO calls `auth` again, which fetches a fresh token.
 */
import { io, type Socket } from 'socket.io-client';

import type { ClientToServerEvents, ServerToClientEvents } from '@socketspace/shared/events';

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface TokenResponse {
  token: string;
  url: string;
  expiresAt: string;
}

export class TokenRequestError extends Error {
  constructor(readonly status: number) {
    super(`token request failed with HTTP ${String(status)}`);
    this.name = 'TokenRequestError';
  }
}

async function fetchToken(): Promise<TokenResponse> {
  const response = await fetch('/api/realtime/token', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new TokenRequestError(response.status);
  return (await response.json()) as TokenResponse;
}

/** Connects to the realtime server. Rejects if no token can be obtained (for example signed out). */
export async function connectRealtime(): Promise<RealtimeSocket> {
  let first: TokenResponse | null = await fetchToken();
  const socket: RealtimeSocket = io(first.url, {
    // WebSocket first; Socket.IO falls back to long-polling on networks that block WebSockets.
    transports: ['websocket', 'polling'],
    withCredentials: false,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    auth: (callback) => {
      if (first) {
        const token = first.token;
        first = null;
        callback({ token });
        return;
      }
      fetchToken().then(
        ({ token }) => {
          callback({ token });
        },
        () => {
          // No token (for example signed out): connect without one; the server refuses it.
          callback({});
        },
      );
    },
  });
  return socket;
}
