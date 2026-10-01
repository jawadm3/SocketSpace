# SocketSpace v1: critical analysis

_Stage B, 2026-10-01. Every finding below was checked against the code, and where possible by
running it. Raw output is in `docs/analysis/evidence/`._

## Summary in one paragraph

v1 is a single chat page and a 30-line server. It looks like a private chat between two strangers,
but it is really one public room: every message goes to everyone connected. Nothing is checked,
nothing is saved, anyone can connect, and the production build does not even complete. It was a
reasonable first experiment, but none of its design can be carried into a production product.
v2 keeps only the idea (real-time chat, plus "talk to someone new") and rebuilds everything else.

## Part 1: the brief's findings, verified

| #   | Brief finding (section 2)                                                                                         | Verdict                                                    | How it was checked                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "The core claim is broken": `socket.broadcast.emit` sends every message to everyone; one global room, no pairing. | **Confirmed by running it.**                               | Three clients A, B, C connected; A sent a message; **both B and C received it** (`v1-broadcast-output.txt`). `server.js` line 23: `socket.broadcast.emit('message', data)`.                                                                                |
| 2   | No identities, rooms, history or persistence.                                                                     | **Confirmed.**                                             | No database, no user model, no `join` calls. Messages live only in React state (`useState`) and vanish on refresh. The chat UI labels everyone "Stranger".                                                                                                 |
| 3   | No message length limit, no rate limiting, no flood protection, no abuse controls.                                | **Confirmed by running it.**                               | A 100,000-character message was relayed to B and C unchanged. No report/block UI or server code exists. The only ceiling is Socket.IO's default 1 MB packet limit.                                                                                         |
| 4   | Hardcoded `localhost` URLs in client and server CORS.                                                             | **Confirmed.**                                             | `server.js`: `origin: 'http://localhost:3000'`, `server.listen(8001)`. `chat/page.tsx` and `lib/socket.ts`: `io('http://localhost:8001')`.                                                                                                                 |
| 5   | Socket client created twice; `src/lib/socket.ts` unused.                                                          | **Confirmed.**                                             | `grep` finds no import of `lib/socket`. The chat page creates its own client in `useEffect`.                                                                                                                                                               |
| 6   | README references `npm run server` (does not exist) and names both Next.js 14 and 15.                             | **Confirmed.**                                             | `package.json` scripts: `dev`, `build`, `start`, `lint` only. README says "Next.js 15" in the intro and "Next.js 14" in Features.                                                                                                                          |
| 7   | Two PostCSS configs; `<a href>` instead of Next.js `Link`.                                                        | **Confirmed, and worse than stated** (see new finding N1). | `postcss.config.js` (Tailwind 3) and `postcss.config.mjs` (points to `@tailwindcss/postcss`, a Tailwind 4 plugin that is **not installed**). Next.js picks the `.js` file first, so the `.mjs` file is dead. `layout.tsx` uses `<a href="/">` three times. |
| 8   | No tests, no CI, never deployed.                                                                                  | **Confirmed.**                                             | No test files, no `.github/` folder, no deployment config.                                                                                                                                                                                                 |

## Part 2: what the brief missed

### Correctness and build

| #   | Finding                                                                                                                                                                   | Evidence                                                                         | Why it matters                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1  | **The production build fails.** `next build` compiles, then stops with exit code 1 on two `no-html-link-for-pages` lint errors.                                           | `v1-build-output.txt`                                                            | v1 could not have been deployed as it stands.                                                                                                                |
| N2  | **Received messages have no ID.** The client sends `{ message, timestamp }`; the server relays exactly that; the receiver reads `data.id`, which is `undefined`.          | `v1-broadcast-output.txt` shows `id: undefined`, keys `['message','timestamp']`. | Messages cannot be told apart, edited, deleted or de-duplicated.                                                                                             |
| N3  | **List keys are array indexes** (`key={index}`).                                                                                                                          | `chat/page.tsx`                                                                  | React may reuse the wrong DOM nodes when the list changes.                                                                                                   |
| N4  | **Timestamps come from the sender's browser** as a local time string ("12:00").                                                                                           | `chat/page.tsx`; the test sent `timestamp: '<script>'` and it was relayed.       | Anyone can fake the time; people in different time zones see inconsistent times; nothing sorts reliably.                                                     |
| N5  | **Arbitrary objects are relayed.** Extra fields (the test added `injected: {...}`) reach other clients.                                                                   | `v1-broadcast-output.txt`                                                        | Any client can push any data shape to every other client. React's escaping prevented script injection in the current UI, but nothing on the server stops it. |
| N6  | **The sender gets no confirmation.** The message is shown as sent immediately; if the socket is disconnected, the send button silently does nothing (`socket?.id` guard). | `chat/page.tsx`                                                                  | Lost messages with no feedback.                                                                                                                              |
| N7  | In development, React Strict Mode mounts the effect twice, so a module-level `socket` variable is created, disconnected, and created again.                               | `chat/page.tsx` (`let socket` at module scope)                                   | Duplicate connections and confusing logs during development.                                                                                                 |

### Security and privacy

| #   | Finding                                                                                                        | Evidence                                                             | Why it matters                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N8  | **CORS does not protect the WebSocket.** A connection claiming to be from `https://evil.example` was accepted. | `v1-origin-output.txt`: `CONNECTED`                                  | CORS is a browser rule for HTTP requests. Socket.IO's WebSocket transport does not enforce it, and non-browser clients ignore it. Real protection needs authentication plus an explicit `Origin` check. |
| N9  | **The server logs the full text of every message.**                                                            | `server.js` line 22; `v1-broadcast-output.txt` shows the server log. | Private conversations end up in hosting logs.                                                                                                                                                           |
| N10 | No authentication of any kind: anyone who can reach port 8001 can read every message.                          | `server.js`                                                          | Combined with finding 1, every conversation is public.                                                                                                                                                  |
| N11 | No security headers, no Content Security Policy, no HTTPS configuration.                                       | `next.config.ts` is empty.                                           | Standard protections are missing.                                                                                                                                                                       |

### Operations and maintainability

| #   | Finding                                                                                                                             | Evidence                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| N12 | No environment configuration at all; the port is hardcoded. No health endpoint, no graceful shutdown, no structured logging.        | `server.js`                                 |
| N13 | Express and `cors` are installed and imported but do nothing (no routes).                                                           | `server.js`, `package.json`                 |
| N14 | Unused dependencies: `@tailwindcss/forms`, `@tailwindcss/typography`, `@tailwindcss/aspect-ratio` are installed but not configured. | `package.json`, `tailwind.config.js`        |
| N15 | `next lint` is deprecated (removed in Next.js 16).                                                                                  | Next.js 16 release notes; v1 `package.json` |
| N16 | `@types/node` is `^20` while the machine runs Node 22.                                                                              | `package.json`                              |
| N17 | README's project tree lists `next.config.js`; the file is `next.config.ts`.                                                         | README, repository                          |

### User experience and accessibility

| #   | Finding                                                                                                                                                    | Evidence                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| N18 | The message box has no label (placeholder only); no live region announces new messages; the "Start Chatting" button carries an icon labelled "Email icon". | `chat/page.tsx`, `page.tsx`        |
| N19 | The view smooth-scrolls to the bottom on **every** new message, even if the reader has scrolled up to read history.                                        | `chat/page.tsx` second `useEffect` |
| N20 | Fixed header and footer with hardcoded `calc(100vh - 8rem)` heights; breaks on mobile browsers with dynamic toolbars.                                      | `layout.tsx`, `chat/page.tsx`      |
| N21 | Dark mode is forced (`className="dark"`); two conflicting body backgrounds (`globals.css` sets black, `layout.tsx` sets a gradient).                       | `layout.tsx`, `globals.css`        |
| N22 | No reconnection feedback, no loading, empty or error states.                                                                                               | `chat/page.tsx`                    |
| N23 | The home page is marked `'use client'` although it has no client-side behaviour.                                                                           | `page.tsx`                         |
| N24 | Small copy errors ("All right reserved").                                                                                                                  | `layout.tsx`                       |

## Part 3: what v1 got right (and v2 keeps)

- The idea: instant real-time chat, plus the appeal of meeting someone new.
- Using a dedicated Socket.IO server rather than trying to hold WebSockets inside Next.js.
- TypeScript in strict mode (`tsc --noEmit` passed with no errors).
- A clear, simple first screen with one call to action.

## Part 4: consequences for v2

Every finding maps to a v2 requirement in `qa/requirements_matrix.md`:

| v1 problem                         | v2 answer                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Broadcast to everyone (1, N10)     | Every event is authenticated and authorised; messages go only to members of a conversation or the two people in a random match. |
| No validation (3, N5)              | Zod schemas in `packages/shared`, validated on the server for every HTTP request and socket event, with size limits.            |
| CORS mistaken for security (N8)    | Short-lived signed connection tokens, plus a strict `Origin` allow-list check on the WebSocket handshake.                       |
| Logging message text (N9)          | Structured logs with redaction; message text is never logged.                                                                   |
| No IDs, client timestamps (N2, N4) | Client-generated IDs for idempotency; server-assigned IDs, sequence numbers and timestamps.                                     |
| No delivery feedback (N6)          | Optimistic sending with acknowledgements, retry and clear failure states.                                                       |
| Build fails, no CI (N1, 8)         | CI runs lint, type checks, tests, builds and Docker builds on every push; `main` must stay green.                               |
| Hardcoded URLs and ports (4, N12)  | All configuration from environment variables, validated at startup.                                                             |
| Accessibility gaps (N18 to N22)    | WCAG 2.2 AA intent: labels, live regions, focus management, "jump to latest" instead of forced scrolling.                       |
