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

## D2: Messaging (done)

### Part 1: data, contracts and realtime

- **Markdown-lite** (`packages/shared/src/markdown.ts`): one parser for browser and server. It
  produces a tree, never HTML: bold, italic, strike, code, code blocks, quotes, https links,
  @mentions, backslash escapes. 12 tests, including hostile input (`<img onerror>`, `javascript:`
  links) and 4,000 characters of unclosed markers (about 0.2 s worst case on a busy CI runner;
  the test allows one second). One real bug found
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

### Part 2: the browser

**Messages are drawn from the parser's tree** (`components/message-body.tsx`). Each part of the
tree becomes a React element: bold, italic, strike, code, code blocks, quotes, links and
@mentions. Nothing is ever turned into HTML, so `<img src=x onerror=...>` stays visible text.
Links open in a new tab with `rel="noopener noreferrer nofollow ugc"`: the new page cannot
reach back into ours, is not told where the click came from, and search engines know a user wrote
the link. A mention of your own nickname is highlighted more strongly. The ESLint ban on
`dangerouslySetInnerHTML` (and on writing `innerHTML`) already existed; a probe file proved it
fires.

**Chat state** (`lib/chat/state.ts`) gained these rules, each with tests:

- Edits, deletions and reaction changes apply only if they are newer than the copy held (by event
  number), so a late edit can never bring back a deleted message's text.
- A deletion leaves a tombstone ("Message deleted") in the same place.
- **Every room you belong to has a starting event number** from the server's room list, not just
  the room on screen. Before, a message in a room you were not looking at opened a "gap" from
  event 0, which asked the server for that room's whole recent history. Now a gap means a real
  gap, and unread counts in other rooms stay right after a reconnect.
- **Catching up happens on every connection**, including the first. Events between the page
  being drawn and the live connection opening used to be noticed only when a later event
  revealed the gap.
- Unread counts start from the server. They go up by one for each new message from someone else
  in a room you are not looking at. Opening the room sets them to zero, and reading on another
  tab clears them there too.
- "Is typing" entries expire after 6 seconds. Presence is kept per person, and everyone shows as
  offline while the connection is down.

**The provider** (`lib/chat/provider.tsx`) wires the new server events to these rules. It sends
the read marker for the room on screen (only while the tab is visible), tells the server whether
the tab is in use (`online` or `away`), and sends edits, deletions and reactions. A refusal
becomes a notice with the server's own reason.

**Throttles in the browser.** The server accepts one typing signal per person every 2 seconds and
one presence change every 5 seconds, and silently drops the rest. `lib/chat/typing.ts` repeats
"typing" every 3 seconds while keys keep coming, and never sends twice within 2.1 seconds. It
sends "stopped" only if "typing" went out recently, and cancels a queued "stopped" when typing
resumes. Presence changes are coalesced: only the latest state is sent, once the gap allows.

**The room page** (split into `room-view.tsx`, `message-item.tsx` and `composer.tsx`):

- An action bar on each message: reply, react, edit, delete. It appears on hover and whenever
  keyboard focus is inside the message, so Tab reaches every action. Edit appears for your own
  messages within 24 hours. Delete appears for your own messages, and for moderators who
  outrank the author. Deleting asks for confirmation, and focus starts on "Cancel".
- Reply: a chip above the composer (Esc cancels it). The reply shows a quote; clicking it
  scrolls to the original, focuses it and highlights it for 2 seconds.
- Reactions: a picker with the 20 allowed emoji (Esc closes it and returns focus), and toggle
  buttons under the message that show who reacted.
- Edit inline: Enter saves, Esc cancels. Up arrow in an empty composer edits your last message.
  Edited messages show "(edited)".
- @mention autocomplete (`lib/chat/mentions.ts`): typing "@" lists matching room members
  (names that start with the text first). Arrow keys move, Enter or Tab picks, Esc closes. A
  hidden status line tells screen readers how many people match.
- "Ava is typing…" under the messages, on a line that keeps its height so nothing jumps.
- Presence dots in the member list (online, away, do not disturb, offline with "last seen"),
  each with a text label for screen readers.
- Unread badges in the sidebar, and a total in the phone menu.
- A tick after your own acknowledged messages (read as "Sent").
- **Invisible mode**: a switch in Settings > Profile ("Show when I'm online") that saves at once.
  The realtime server learns of it through `user.updated`.

**Server fix found by looking at screenshots.** Presence was exchanged only when a tab
connected, so when someone joined a room live, the people already there kept seeing them as
offline until a reload. J2 had passed only because Ava reloaded the page before the presence
check. Now a live join tells the room whether the newcomer is online, and sends the newcomer who
is online there (`internal.ts`, `member.added`). The realtime join test and J2 (checked before
any reload) cover it.

**Contract change:** the `reaction:toggle` acknowledgement now carries the change's event
number. The reacting tab receives no broadcast of its own change. Without the number, its next
message looked like a gap and caused an unneeded resync (and resyncs are rate-limited).

### Decisions

D-039 (how the browser keeps chat state) and D-040 (Turborepo runs at most four tasks at once).

### Problems and fixes

- **The typing check in J2 failed twice.** First cause: after a reload, keystrokes arrived
  before the live connection was open. The throttle counted the dropped signal as sent and held
  back the next one for 3 seconds. Fix: the browser only feeds the throttle while connected.
  Second cause: the test itself. Ava had typed less than 2 seconds earlier (before the reload),
  so the server dropped the new signal as designed. The test now waits out that window, with a
  comment explaining why.
- **`pnpm check` crashed three times in a row, in three different places**: a type check, a
  PGlite database that failed to start, and a test worker that exited with code 0x80000003.
  Each package passed on its own. Turborepo started all 13 tasks at once (4 type-aware lint
  runs, 4 type checks, 4 test pools) on a laptop with about 7.3 GB of usable memory and 3.4 GB
  free. Limited to 4 tasks at a time, the full check passed in about 50 seconds (D-040).
- A test of mine expected "nova" to match "av". The test was wrong, not the code.

### Tests run, with actual results

| Check                         | Result                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                  | 13 of 13 tasks; shared 160, db 97, realtime 56 (+2 Redis tests that run in CI), web 93                                                                            |
| Same tests on PostgreSQL 17.9 | shared 160, db 97, realtime 56 (+2), web 93                                                                                                                       |
| New web tests                 | chat state 14 more (23 in all), typing throttle 4, mentions 6, message renderer 5                                                                                 |
| Realtime                      | the join test now also checks presence both ways                                                                                                                  |
| End-to-end                    | 9 of 9 in 41.3 s: J1, J11 (x2), headers, live connection, sign-out elsewhere, J2 (now with typing, unread on two tabs, presence and invisible mode), J3 (new), J5 |
| Raw-HTML lint ban             | A probe file with `dangerouslySetInnerHTML` gave "Raw HTML is not allowed" (exit 1); the probe was deleted                                                        |
| Screens inspected             | room with formatting, a reply, a mention, a reaction, the action bar, the typing line and the reaction picker (desktop)                                           |

## What comes next

D3, history and reliability: cursor pagination with infinite scroll (HIST-02), a virtualised
message list (HIST-04), the send outbox kept in `localStorage` so a message typed offline is sent
after reconnecting (RECON-04), reconnect UX and an offline banner, then journey J4.
