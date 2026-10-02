# Step D: Community mode

- **Started:** 2026-10-02 (session 3).
- **Status:** In progress. D1 (profiles and rooms) is done; D2 (messaging) has its database and
  realtime parts done, the browser part next; D3 to D5 follow.

## Goal

From `docs/development/plan.md`: everything a community member uses every day. Rooms, direct
messages, the messaging features (edit, delete, replies, reactions, mentions, formatting, link
previews, images), presence, history, search, notifications and uploads, all live and reliable.
Stage exit (`qa/acceptance_criteria.md`): journeys J2 to J6, J9 and J11 pass as automated tests;
virtualised list; search; notifications; uploads.

| Milestone                     | Status                                | Commits                         |
| ----------------------------- | ------------------------------------- | ------------------------------- |
| D1 Profiles and rooms         | Done                                  | `3570c15`, `7b5fc4f`, `1652b83` |
| D2 Messaging                  | Half: data and realtime done, UI next | `7c85aca` and the next commit   |
| D3 History and reliability    |                                       |                                 |
| D4 DMs, notifications, search |                                       |                                 |
| D5 Media                      |                                       |                                 |

## D1: Profiles and rooms

### What was built, and how it works

**Rooms in the database** (`packages/db/src/queries/rooms.ts`). Creating, joining and leaving,
settings, roles, invites and room moderation. Every change follows one pattern: in a single
transaction, lock the room's row, load the person acting, their membership and any room ban
fresh from the database, ask the shared authorisation rules (`decide()` from Stage C), and only
then write. _Like a bank teller who checks your ID and balance in the same moment they hand over
the money, not five minutes earlier._ Because `sendMessage` locks the same row, a person removed a
moment ago cannot slip in one last message (a test proves it). Room moderators' mutes, removals,
bans, role changes and deletions go into the append-only audit log, with the room recorded
(migration 0002 adds three action kinds). Deleting a room archives it (D-036).

**Invites.** A link carries a 128-bit random code. The database stores only its SHA-256
fingerprint, so a database leak does not leak working links, and the link is shown once. An invite
can expire, admit a set number of people, or be cancelled; someone already inside does not use it
up. In private rooms only moderators and owners invite.

**People as each viewer may see them** (`packages/db/src/queries/people.ts`). Every person sent to
a browser goes through one function that adds a real name only when that viewer may see it
(D-024). Broadcasts, which many people receive at once, carry the nickname only; a browser fetches
each person once from `GET /api/users`, which applies the same rule.

**Live updates** (`apps/realtime/src/internal.ts`). After a change, the web app sends a signed
internal event; the realtime server moves the person's open tabs into or out of the room and tells
everyone: `conversation:joined/left/updated`, `member:joined/left/updated`, and two new events,
`room:notice` (only to the person muted, removed or banned, with the reason) and `user:updated`
(a new nickname or picture).

**The app shell** (`apps/web/src/app/(app)/app/`). One live connection shared by every page under
`/app` (`ChatProvider`), a sidebar with your rooms, a compact bar on phones, and moderator notices.
The rules for the message list live in a small, tested module (`lib/chat/state.ts`): messages in
sequence order, never twice; an optimistic message replaced by the stored copy; a gap in event
numbers noticed and filled by asking the server (`sync:request`) after a short grace period or a
reconnect. _Like a numbered ticket roll: if you see ticket 7 after 5, you know to ask about 6._

**Pages:** home (your rooms and suggestions), explore (search public rooms), create a room (the
address is suggested from the name), the room (live messages, a composer that explains why you
cannot post when you cannot, members by role), room settings (details, invites, members with only
the actions you are allowed, bans, delete), the invite page, and "Room not found" inside the shell
(missing, deleted and private-but-not-yours look the same, so nothing leaks).

**Profiles.** Onboarding now asks for an optional real name (pre-filled from a social sign-in),
who may see it and what chats show. Pictures come from a 24-preset gallery or "Make your own", a
builder generated from DiceBear's own description of each style, with a live preview (D-037).
Settings > Profile edits all of this; a new nickname or picture reaches people who share a room
at once.

### Decisions

D-036 (rooms, invites and room moderation) and D-037 (avatars, people lookups, test addresses).

### Problems and fixes

| Problem                                                                                                              | How it was found                                        | Fix                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Room page would re-render forever (callbacks recreated on every state change)                                        | Reading the code before the first run                   | Stable callbacks in the provider; documented so pages can depend on them                                          |
| Escapes mangled while writing files (a regex `\b` became a backspace)                                                | Byte dump of the line (`od -c`), source-character check | Write tool or `chr(92)` for backslashes; check script after writing; memory note updated                          |
| DiceBear draws a broken picture for an unknown option instead of refusing it                                         | A render test of sample options                         | Server checks every saved option against the style's real choices (D-037)                                         |
| The same avatar could have several URLs (jsonb reorders keys)                                                        | Designing the J11 "same picture everywhere" check       | Canonical URL with sorted options                                                                                 |
| `getByText` matched a hidden duplicate status line; label "Nickname" matched three radios                            | First E2E run                                           | Role-based queries (hidden elements excluded) and exact labels                                                    |
| Test devices shared IP addresses across files and tripped sign-up limits                                             | E2E sign-up refused "Too many attempts"                 | Run-wide address counter over three documentation ranges (D-037)                                                  |
| Every test browser counted as 127.0.0.1 against the realtime connection limit                                        | A third test person stuck on "Reconnecting"             | E2E realtime server trusts one proxy hop, like Render (D-037)                                                     |
| Token rate-limit test flaky when it straddled a clock minute                                                         | CI run 37019870151 (PostgreSQL job): 200 instead of 429 | The test starts well inside a minute, read from the database clock (`3d52162`)                                    |
| Message burst test flaky: ten sends one by one took over a second on CI, the bucket refilled and the eleventh passed | CI run 37021759585 (checks job)                         | The test sends 14 at once; first 10 allowed, at most one refill tolerated, refusals carry a retry time            |
| Lint (React 19 rules): `setState` in an effect, `Date.now()` in render, ref written during render                    | `pnpm lint`                                             | "Adjust state when a prop changes" pattern; invite expiry from the database clock; ref updated in a layout effect |

### Tests run, with actual results

Local machine: Windows 11 Home, Node.js 22.13.0, 2026-10-02.

| Check                                     | Result                                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                              | 13 of 13 tasks; shared 148, db 85, web 64, realtime 45 passed + 2 skipped (Redis)                                                                                                                                                                     |
| Database tests on real PostgreSQL 17.9    | db 82 before the profile functions (29 room tests); rooms and realtime suites green on both engines                                                                                                                                                   |
| End-to-end (Playwright, production build) | 8 of 8: J1, J11 nickname suggestions, security headers, live connection, sign-out-elsewhere, **J2**, **J5**, **J11 names and pictures** (26.6 s)                                                                                                      |
| New room query tests                      | 29: create, join, leave, last owner, reading, directory search (wildcards literal), settings, roles and transfer, mute with the database clock, remove, ban and expiry, invites (hash only, one use, expired, revoked, banned), people and real names |
| New realtime tests                        | 6: joining (nickname-only broadcast), ban (told why, receives nothing more, sends refused), mute (time left), role change, rename and delete, profile change                                                                                          |
| New web tests                             | chat state rules (9), people lookup (2), avatars and builder (4)                                                                                                                                                                                      |
| Screens inspected                         | room (desktop and phone), settings, invite, home, onboarding gallery, builder                                                                                                                                                                         |

## D2: Messaging (in progress)

### Done so far: data, contracts and realtime

- **Markdown-lite** (`packages/shared/src/markdown.ts`): one parser for browser and server. It
  produces a tree, never HTML: bold, italic, strike, code, code blocks, quotes, https links,
  @mentions, backslash escapes. 12 tests, including hostile input (`<img onerror>`, `javascript:`
  links) and 4,000 characters of unclosed markers parsed in well under 200 ms. One real bug found
  by a test and fixed: `**bold *and italic***` closed the bold too early.
- **Database** (`message-actions.ts`, `read-state.ts`): edit (author, 24 hours on the database
  clock, still allowed to post; earlier text kept), delete as a tombstone (author, outranking room
  moderators, admins; audited when not the author), reactions (allow-list, at most 20 different),
  mentions (members only, outside code, not the author, not someone who blocked the author),
  read markers that only move forward and unread counts. Each change takes the next event number.
- **Realtime**: `message:edit`, `message:delete`, `reaction:toggle`, `read:update` (other tabs
  told), `typing:set` (members only, throttled), presence across tabs with invisible mode, a
  snapshot of who is online for a new tab, "last seen" when someone leaves (D-038).

| Check                          | Result                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm check`                   | 13 of 13 tasks; shared 160, db 97, web 64, realtime 56 (+2 Redis)            |
| On PostgreSQL 17.9             | db 97/97, realtime 56 (+2), web 64/64                                        |
| New tests                      | markdown 12; db message actions 12; realtime presence rules 3, live events 8 |
| End-to-end after these changes | 8 of 8 journeys still pass (27.7 s)                                          |

Also fixed on the way: a lint error that reached CI (a condition TypeScript already narrows), and
the room page passing an array index where reactions were expected (caught by the type check).

## What comes next

D2, the browser part: render messages with the markdown-lite tree; message actions (reply, react,
edit, delete) with keyboard support; reply quotes that jump to the original; the reaction picker;
@mention autocomplete; typing indicator; presence dots; unread counts in the sidebar, live across
tabs; invisible-mode switch in profile settings. Then E2E J3 (edit, delete, react, reply,
mention, formatting) and the typing and unread parts of J2.
