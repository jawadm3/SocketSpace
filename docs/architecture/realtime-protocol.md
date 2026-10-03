# Real-time protocol and flows

_Stage B, 2026-10-01; updated in Stage C (2026-10-02, decision D-032) and Stage D (room notices,
profile updates, D-036). Every event below is a Zod
schema in `packages/shared/src/events/`, and Socket.IO's TypeScript event maps are derived from
those schemas, so the browser and the server cannot disagree about a payload's shape._

## Connecting

1. The browser asks the web app for a connection token: `POST /api/realtime/token` (same-site
   cookie, so only a signed-in browser gets one). The token is a JWT signed with the web app's
   private key, valid for **5 minutes**, with claims `sub` (user ID), `sid` (session ID), `role`,
   `aud = socketspace-realtime`, `iss = <web origin>`, plus `guest` (true for guest accounts). The
   response also carries the realtime server's address, so no address is built into the browser
   bundle.
2. The browser connects to the realtime server with `auth: { token }` (in the handshake body,
   never in the URL, so it does not appear in logs).
3. The server, before accepting:
   - checks the `Origin` header against `WEB_ORIGINS` (browsers always send it; this closes the
     gap found in v1, where CORS did not protect the WebSocket);
   - verifies the token signature with the web app's public keys (JWKS, cached), audience,
     issuer and expiry;
   - checks that the session behind the token still exists (a token issued just before a sign-out
     cannot connect during its remaining minutes), that the user is `active`, not banned or
     suspended, and under the connection caps (10 per user, 20 per IP address, 30 new connections
     per IP per minute);
   - loads the user's conversation memberships and active sanctions from the database, joins the
     socket to one Socket.IO room per conversation plus a private room `user:<id>`.
4. The server sends `server:hello` with the protocol version and server time.

Tokens are only checked at connection time. A session revoked later (sign-out everywhere, ban) is
enforced by an internal event that disconnects that session's sockets immediately.

## Message shapes

Every client-to-server event that changes something takes an **acknowledgement callback**
(Socket.IO's request/response feature). The reply always has this shape:

```ts
type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; retryAfterMs?: number } };

type ErrorCode =
  | 'VALIDATION' // payload failed the schema
  | 'UNAUTHENTICATED' // token missing, invalid or expired
  | 'FORBIDDEN' // not a member, blocked, banned, muted, wrong role
  | 'NOT_FOUND'
  | 'RATE_LIMITED' // includes retryAfterMs
  | 'CONTENT_BLOCKED' // word filter (high severity) or link in random mode
  | 'CONFLICT' // e.g. editing a deleted message
  | 'UNAVAILABLE' // database or dependency down: safe to retry
  | 'INTERNAL';
```

Payload limits are enforced twice: Socket.IO rejects any packet over **16 KB**
(`maxHttpBufferSize`), and each schema has its own limits (for example 4,000 characters per
message, 10 attachments, 20 interest tags).

**People in payloads.** Every user object sent to a browser (message authors, members, presence,
profiles) has the shape `{ id, nickname, avatar, realName? }`. `avatar` is either a preset/custom
avatar config or a photo URL. `realName` is included **only** when the receiving viewer may see it
(the person's visibility setting: nobody, contacts or everyone) and the person chose to show it in
chats. Because one broadcast goes to many viewers, broadcasts carry nicknames only, and the client
fetches real names it is allowed to see once per person over HTTP (cached). See `security.md` 3.12.

## Events: community mode

### Client → server (all acknowledged)

| Event             | Payload                                                          | Ack data                                            | Main checks                                                                                                |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `message:send`    | `{ conversationId, clientId, body, replyToId?, attachmentIds? }` | `{ message }`                                       | member, not muted/banned, DM not blocked, rate limit, word filter, attachments owned by sender and pending |
| `message:edit`    | `{ messageId, body }`                                            | `{ message }`                                       | author only, not deleted, within 24 h, word filter                                                         |
| `message:delete`  | `{ messageId }`                                                  | `{ messageId, eventSeq }`                           | author, or room owner/moderator, or admin                                                                  |
| `reaction:toggle` | `{ messageId, emoji }`                                           | `{ messageId, reactions, eventSeq }`                | member, emoji in allow-list, at most 20 distinct emoji per message                                         |
| `typing:set`      | `{ conversationId, typing: boolean }`                            | none (fire and forget, throttled)                   | member                                                                                                     |
| `read:update`     | `{ conversationId, seq }`                                        | `{ unread }`                                        | member; `seq` can only move forward                                                                        |
| `delivery:ack`    | `{ items: [{ conversationId, seq }] }` (batched every 1.5 s)     | none                                                | DMs only; only conversations the socket is in                                                              |
| `sync:request`    | `{ cursors: [{ conversationId, afterEventSeq }] }` (up to 50)    | `{ results: [{ conversationId, events, reset? }] }` | member of each                                                                                             |
| `presence:set`    | `{ status: 'online' \| 'away' \| 'dnd' }`                        | `{}`                                                |                                                                                                            |

### Server → client

| Event                                                                | Payload                                                                                                                              | Sent to                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `server:hello`                                                       | `{ protocolVersion, serverTime, userId }`                                                                                            | the connecting socket                                                      |
| `message:new`                                                        | `{ message, eventSeq }`                                                                                                              | conversation room                                                          |
| `message:updated`                                                    | `{ message, eventSeq }` (edit, moderation state change)                                                                              | conversation room                                                          |
| `message:deleted`                                                    | `{ conversationId, messageId, eventSeq }`                                                                                            | conversation room                                                          |
| `reaction:updated`                                                   | `{ conversationId, messageId, reactions, eventSeq }`                                                                                 | conversation room                                                          |
| `typing`                                                             | `{ conversationId, userId, typing }` (auto-expires after 6 s)                                                                        | conversation room, except sender                                           |
| `read:updated`                                                       | `{ conversationId, userId, seq }`                                                                                                    | DM partner (if both allow read receipts); the user's own other tabs        |
| `delivery:updated`                                                   | `{ conversationId, userId, seq }`                                                                                                    | DM partner                                                                 |
| `presence`                                                           | `{ userId, status, lastSeenAt }`                                                                                                     | users who share a conversation or are contacts (never for invisible users) |
| `conversation:joined` / `conversation:left` / `conversation:updated` | `{ conversation }` / `{ conversationId }`                                                                                            | the user's private room                                                    |
| `member:joined` / `member:left` / `member:updated`                   | `{ conversationId, member }`                                                                                                         | conversation room                                                          |
| `notification:new`                                                   | `{ notification }`                                                                                                                   | the user's private room                                                    |
| `moderation:notice`                                                  | `{ kind: 'warned' \| 'muted' \| 'suspended' \| 'banned', reason, until? }`                                                           | the user's private room                                                    |
| `room:notice`                                                        | `{ conversationId, kind: 'muted' \| 'unmuted' \| 'removed' \| 'banned', reason, until }`                                             | the user's private room (only the person concerned)                        |
| `user:updated`                                                       | `{ user }` (nickname and avatar only, never a real name)                                                                             | conversations the person is in, and their own tabs                         |
| `session:ended`                                                      | `{ reason, reconnectAfterMs? }` then disconnect; reason is `revoked`, `banned`, `suspended`, `deleted`, `server_shutdown` or `abuse` | sockets of that session, person or server                                  |

### Presence and typing (Stage D2, D-038)

- Each tab sends `presence:set` with `online` (in use), `away` (hidden or idle) or `dnd`. Others
  see `dnd` if any tab says so, else `online` if any tab is in use, else `away`; `offline` (with
  `lastSeenAt`) when the last tab closes. Invisible mode always shows `offline`.
- A newly connected tab receives one `presence` event for each person online in its
  conversations (up to 500).
- When someone joins a room while connected (`member.added`), the room receives their presence
  (unless they look offline) and their tabs receive the presence of everyone online in that
  room, so nobody has to reload to see who is there (D-039).
- Browsers send `presence:set` when a tab becomes visible (`online`) or hidden (`away`), no
  more than once per 5 seconds; `typing:set` no more than once per 2.1 seconds, repeated every
  3 seconds while typing (D-039).
- `typing:set` reaches only members (checked against the socket's rooms) and is throttled by
  dropping extra events; browsers hide an indicator after 6 seconds without an update.
- Presence is kept in the realtime server's memory: exact with one server (the free
  deployment); with several, each knows only its own connections.

### Delivery states (what the little ticks mean)

| State           | Shown as         | Meaning                                                                       |
| --------------- | ---------------- | ----------------------------------------------------------------------------- |
| Sending         | clock icon       | In the browser's outbox, not yet acknowledged                                 |
| Sent            | one tick         | The server saved it (ack received with `seq`)                                 |
| Delivered (DMs) | two ticks        | A device of the other person received it (`delivery:ack`)                     |
| Seen (DMs)      | two filled ticks | The other person read up to it (`last_read_seq`), if both allow read receipts |
| Failed          | red "Retry"      | Rejected (for example `FORBIDDEN`) or not acknowledged after the retry budget |

Rooms show unread counts and "new messages" dividers rather than per-person receipts (cheaper,
and kinder to privacy in large rooms).

## Reconnection and resync (no lost or duplicate messages)

The client keeps, per conversation, `lastEventSeq`: the highest event number it has applied.

- **Gap detection:** every live event carries `eventSeq`. If an event arrives with
  `eventSeq > lastEventSeq + 1`, the client knows it missed something and calls `sync:request`.
- **After every connect (the first one too):** the client fetches a fresh token if needed,
  connects, and sends `sync:request` with the cursors of every conversation it has open or
  listed. Each room in the sidebar starts from the event number the server rendered, so rooms
  that are not on screen catch up too (D-039). The server returns
  every message whose `version_seq` is greater than the cursor (new messages, edits, deletions and
  reaction changes), ordered, up to 200 per conversation. Beyond 200 it answers `reset: true` and
  the client reloads the latest page over HTTP instead.
- **Outbox:** messages the user sent but that were not acknowledged stay in the outbox (memory plus
  `localStorage`, so they survive a page reload) and are re-sent **with the same `clientId`**. The
  database's unique key on (`author_id`, `client_id`) turns a re-send into a no-op that returns the
  original message. The outbox sends **one message at a time, in the order written**, so the server
  numbers them in that order. While there is no connection nothing is sent and no attempt is
  counted. A failure that may pass (no answer, connection lost, `RATE_LIMITED`, `UNAVAILABLE`) is
  retried after 1, 2, 4 and 8 seconds (or the server's `retryAfterMs`); after 5 attempts, or at
  once for a refusal such as `FORBIDDEN`, the message is marked "Failed" with a manual retry
  button. Signing out (or an ended session) clears it (D-041).
- **Offline:** the browser's `offline` event disconnects the socket and shows a banner at once;
  `online` reconnects at once instead of waiting out Socket.IO's back-off. If the very first
  connection fails, it is retried after 2, 4, 8 ... up to 30 seconds (D-041).
- **De-duplication on the client:** messages are stored in a map keyed by `id` and replaced by
  `clientId` when the ack arrives, so an echo and an ack for the same message never show twice.
- Socket.IO's own connection-state recovery is switched on for drops under 2 minutes (in-memory
  adapter), but it is treated as an optimisation only: its documentation warns that recovery "will
  not always be successful", so the sequence-based resync above is the real guarantee.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant RT as Realtime server
  participant DB as PostgreSQL
  participant O as Other members

  B->>B: show message as "Sending" (outbox, clientId)
  B->>RT: message:send {conversationId, clientId, body}
  RT->>RT: validate schema, rate limit, word filter
  RT->>DB: BEGIN; bump conversation counter; INSERT ... WHERE member AND allowed ON CONFLICT (author, clientId) DO NOTHING; COMMIT
  DB-->>RT: message {id, seq, eventSeq}
  RT-->>B: ack {ok: true, message}
  B->>B: replace optimistic copy, show "Sent"
  RT-->>O: message:new {message, eventSeq}
  Note over B,RT: connection drops, then comes back
  B->>RT: connect (token) then sync:request {afterEventSeq: N}
  RT->>DB: SELECT ... WHERE version_seq > N ORDER BY version_seq LIMIT 200
  DB-->>RT: missed events
  RT-->>B: ack {events}
  B->>RT: re-send unacknowledged outbox items (same clientId)
  RT->>DB: INSERT ... ON CONFLICT DO NOTHING (returns existing row)
  RT-->>B: ack {ok: true, message} (no duplicate)
```

## Events: random-match mode

Random mode is text only. Links, images and attachments are refused (`CONTENT_BLOCKED`).

### Client → server

| Event            | Payload                                                     | Ack data           | Checks                                                                                              |
| ---------------- | ----------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `random:join`    | `{ interests: string[] (0 to 5 tags, each 2 to 24 chars) }` | `{ queued: true }` | 18+ gate and terms accepted (current version), no active `random` sanction, rate limit 6 per minute |
| `random:leave`   | `{}`                                                        | `{}`               |                                                                                                     |
| `random:message` | `{ sessionId, clientId, text }` (up to 1,000 chars)         | `{ clientId }`     | in that session, rate limit 1 per second (burst 3), word filter (stricter), no links                |
| `random:typing`  | `{ sessionId, typing }`                                     | none               |                                                                                                     |
| `random:next`    | `{ sessionId }`                                             | `{ queued: true }` | ends current session and re-queues; rate limit 20 per 10 minutes                                    |
| `random:end`     | `{ sessionId }`                                             | `{}`               |                                                                                                     |
| `random:report`  | `{ sessionId, reason, details? }`                           | `{ reportId }`     | allowed up to 5 minutes after the session ends; ends the session                                    |
| `random:block`   | `{ sessionId }`                                             | `{}`               | signed-in users: creates a `block`; guests: session-scoped avoid list; ends the session             |
| `random:offer`   | `{ sessionId, offer: 'share_profile' \| 'add_contact' }`    | `{}`               | signed-in, non-guest users only                                                                     |
| `random:accept`  | `{ sessionId, offer }`                                      | `{}`               |                                                                                                     |

### Server → client

`random:waiting` (`{ since }`), `random:matched` (`{ sessionId, partner: { alias: 'Stranger',
sharedInterests } }`), `random:message` (`{ sessionId, clientId, text, from: 'me' | 'them', at }`),
`random:typing`, `random:offered` (`{ offer }`), `random:shared` (`{ profile }`, only after
**both** accepted), `random:contact-added`, `random:ended` (`{ reason }`), and `random:suggestion`
(`{ rooms: [...] }`: public rooms matching the shared interests, shown on the end screen; this is
the path from a good random chat into the community).

### Matching rules

1. On `random:join`, the user enters an in-memory queue with their interest tags.
2. Every 500 ms (and on every join) the matcher pairs people who share the most tags. A person who
   has waited 10 seconds without a shared-tag match is paired with anyone (random fallback).
3. Never pair: two people where either blocked the other, people who were paired with each other
   in the last 10 minutes, or the same account twice.
4. Pairing creates a `random_session` row (metadata only), and both sockets join a private
   Socket.IO room for that session.
5. Messages are relayed and also kept in the in-memory evidence buffer (last 20, both sides).
6. A session ends on skip/next, end, disconnect (after a 15-second grace period for reconnects),
   report, block, a high-severity filter hit, or 10 minutes of silence.

```mermaid
sequenceDiagram
  autonumber
  participant A as Person A
  participant RT as Realtime server
  participant Q as Queue (memory)
  participant P as Person B
  participant DB as PostgreSQL

  A->>RT: random:join {interests: [music, chess]}
  RT->>RT: gate accepted? no random sanction? rate limit
  RT->>Q: enqueue A
  P->>RT: random:join {interests: [chess]}
  RT->>Q: enqueue B; matcher finds A–B (1 shared tag, no blocks, not recent)
  RT->>DB: INSERT random_session (metadata only)
  RT-->>A: random:matched {sessionId, sharedInterests: [chess]}
  RT-->>P: random:matched {sessionId, sharedInterests: [chess]}
  A->>RT: random:message {text}
  RT->>RT: filter (strict), no links, rate limit; append to evidence buffer (memory)
  RT-->>P: random:message {text, from: them}
  A->>RT: random:offer {add_contact}
  RT-->>P: random:offered {add_contact}
  P->>RT: random:accept {add_contact}
  RT->>DB: INSERT contact (both directions); metric_daily +1
  RT-->>A: random:contact-added
  RT-->>P: random:contact-added
  P->>RT: random:end
  RT->>DB: UPDATE random_session SET ended_at, end_reason
  RT-->>A: random:ended {reason: end} + random:suggestion {rooms}
  RT->>RT: keep evidence buffer 5 minutes, then discard
```

## Moderation flow

```mermaid
sequenceDiagram
  autonumber
  participant U as Reporter
  participant WEB as Web app
  participant RT as Realtime server
  participant DB as PostgreSQL
  participant M as Moderator
  participant T as Reported user

  alt community message
    U->>WEB: report message (reason, details)
    WEB->>DB: INSERT report with server-side snapshot of the message and its context
  else random chat
    U->>RT: random:report {sessionId, reason}
    RT->>DB: INSERT report with the in-memory evidence buffer
    RT->>RT: end session; if the reported user has 3+ reports from different people in 24 h, add a 24 h random timeout automatically
  end
  M->>WEB: open moderation queue (admin role required)
  WEB->>DB: list open reports and content flags
  M->>WEB: action (warn / mute / suspend / ban / remove message), reason required
  WEB->>DB: INSERT moderation_action (append-only), user_sanction, update report
  WEB->>RT: internal event user.sanctioned (HMAC-signed)
  RT-->>T: moderation:notice {kind, reason, until}
  RT->>RT: suspended or banned: disconnect all their sockets; muted: refuse sends until expiry
  RT-->>U: notification:new (report resolved, without details of the action)
```

## Internal events (web app → realtime server)

`POST {REALTIME_INTERNAL_URL}/internal/events` with headers `x-ss-timestamp` and
`x-ss-signature = HMAC-SHA256(INTERNAL_EVENTS_SECRET, timestamp + "." + body)`. Requests older than
60 seconds, or with a reused event ID, are rejected.

| Event                                                                          | Effect                                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `member.added` / `member.removed` / `member.role_changed`                      | Join or remove that user's sockets to or from the conversation room; broadcast `member:*` |
| `member.removed` with `cause` (`left`, `removed`, `banned`), `reason`, `until` | Also sends `room:notice` to the person when a moderator removed or banned them            |
| `member.muted` (`until`, or `null` when lifted), `reason`                      | `room:notice` (`muted` / `unmuted`) to the person; sends are refused by the database      |
| `user.updated`                                                                 | Broadcast `user:updated` (nickname and avatar) to every conversation the person is in     |
| `conversation.updated` / `conversation.deleted`                                | Broadcast; remove sockets from the room                                                   |
| `user.sanctioned` / `user.unsanctioned`                                        | Update the in-memory sanction cache; notify; disconnect if suspended or banned            |
| `session.revoked` / `user.sessions_revoked` / `user.deleted`                   | Disconnect that session's sockets / all of the person's sockets                           |
| `message.moderated`                                                            | Broadcast `message:updated` (removed or restored) with a new `eventSeq`                   |
| `block.created`                                                                | Leave any random session with that person; refuse DMs                                     |

Delivery: 3 attempts with back-off inside the web request; if all fail, the event goes to
`realtime_outbox` (see the data model).

## Rate limits and abuse limits (initial values, tuned in Stage G)

| What                              | Limit                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Connections                       | 10 per user, 20 per IP address; 30 new connections per IP per minute                            |
| `message:send`                    | token bucket: burst 10, refill 1 per second (about 60 per minute)                               |
| `message:edit` / `message:delete` | 30 per minute                                                                                   |
| `reaction:toggle`                 | 60 per minute                                                                                   |
| `typing:set`                      | 1 per 2 seconds (extra events dropped silently)                                                 |
| `sync:request`                    | 6 per minute                                                                                    |
| `random:join` / `random:next`     | 6 per minute / 20 per 10 minutes                                                                |
| `random:message`                  | burst 3, refill 1 per second                                                                    |
| Reports                           | 10 per hour                                                                                     |
| Repeated `RATE_LIMITED`           | 20 violations in 1 minute disconnects the socket; repeated disconnects add a 15-minute cooldown |

## Observability of the realtime server

- `GET /healthz`: process is up (no database access: used by the keep-awake pinger).
- `GET /readyz`: database reachable and JWKS loaded (used by deploy checks only).
- `GET /metrics` (requires `METRICS_TOKEN`): connections, events per second by type, acks by
  result code, rate-limit hits, random queue length and wait time, event-loop lag, memory.
- Logs: pino JSON with request IDs; fields such as `body`, `text`, `token`, `password`, `email` are
  redacted by configuration, and handlers never log message text.
- Graceful shutdown on `SIGTERM`: stop accepting connections, tell clients to reconnect, flush
  in-flight writes, close the database pool, exit within 10 seconds.

## Direct messages, receipts and notifications (Stage D4, D-042)

- `notification:new` goes to the notified person's tabs when a message or an edit notifies them
  (mention, reply, DM). The actor is sent by nickname only. The database writes the notification
  in the same transaction as the message.
- `delivery:ack` (fire-and-forget, batched) moves the person's delivered mark in a DM. If both
  people allow read receipts, the other person receives `delivery:updated`; reading sends them
  `read:updated` in the same way. With receipts off on either side, neither event is sent.
- A new DM uses the room events: `member.added` for both people (their tabs join the conversation
  and receive `conversation:joined`). A block (`block.created`) sends `conversation:updated` for
  their DM to both, so open pages re-read what is allowed.
