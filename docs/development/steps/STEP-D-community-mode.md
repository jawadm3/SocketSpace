# Step D: Community mode

- **Started:** 2026-10-02 (session 3).
- **Status:** Complete (2026-10-03, session 5). D1 to D5 are done and the stage exit criteria are
  met (see "Stage D close-out" at the end). D5 was built on the `continuation` branch and waits
  for the owner's review (pull request jawadm3/SocketSpace#1).

## Goal

From `docs/development/plan.md`: everything a community member uses every day. Rooms, direct
messages, the messaging features (edit, delete, replies, reactions, mentions, formatting, link
previews, images), presence, history, search, notifications and uploads, all live and reliable.
Stage exit (`qa/acceptance_criteria.md`): journeys J2 to J6, J9 and J11 pass as automated tests;
virtualised list; search; notifications; uploads.

| Milestone                     | Status | Commits                                              |
| ----------------------------- | ------ | ---------------------------------------------------- |
| D1 Profiles and rooms         | Done   | `3570c15`, `7b5fc4f`, `1652b83`                      |
| D2 Messaging                  | Done   | `cf8538d`, `7db91f1`, `c19528d`                      |
| D3 History and reliability    | Done   | `2c45809`                                            |
| D4 DMs, notifications, search | Done   | `f2c0587`                                            |
| D5 Media                      | Done   | `874a682` and the commits after it on `continuation` |

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

## D3: History and reliability (done)

### What was built, and how it works

- **Older messages on demand** (HIST-02). `GET /api/rooms/[slug]/messages?before=<seq>` returns
  the 100 messages before a message number, the people in them, and whether there are more.
  Cutting pages by number means a page never shifts when new messages arrive. The route uses the
  room page's rules: members, or anyone for a public room; banned people and outsiders of
  private rooms get the same "not found" as a room that does not exist.
- **A virtualised message list** (HIST-04, `message-list.tsx`, TanStack Virtual). Only the
  messages near the screen exist in the page, each measured as it appears. The list opens at the
  newest message, follows new ones while you are at the bottom, and shows "New messages" when you
  are reading further up. Scrolling near the top loads the previous page, and the message you
  were reading stays where it was. A button does the same for keyboard users.
- **Reply quotes find their original**, even when it is not loaded yet. The list loads up to 20
  older pages, then scrolls to the original and focuses it.
- **The outbox** (RECON-04, `lib/chat/outbox.ts`). Messages wait here until the server stores
  them, one at a time and in order. They are kept in `localStorage`, so a reload does not lose
  them. Offline time is not counted as failed attempts. Passing failures are retried after 1, 2,
  4 and 8 seconds; after 5 tries, or at once for a refusal, the message shows "Not sent" with
  "Try again". Signing out clears it. Re-sends use the same client ID, so nothing is stored
  twice.
- **Offline and reconnecting** (RECON-01, RECON-02). The browser's offline event pauses the
  connection at once and shows a banner ("You are offline. Messages you send will go out when the
  connection returns."). The online event reconnects at once. After a reconnect the browser
  catches up (D2) and then sends the outbox. A first connection that fails is tried again with
  growing waits. A reconnect shows the banner only after 2 seconds, so short blips stay quiet.
- **Screen readers** hear new messages from others through a separate polite announcement. The
  list itself does not announce, because virtualisation adds old messages while scrolling up.

### Decisions

D-041.

### Problems and fixes

- **One scroll to the top loaded the whole history.** The history test reached the start of
  10,000 messages suspiciously fast. A probe test showed 10 page requests for a single scroll in
  a 1,000-message room, with the reader thrown to message 1. Cause: the "start of the room" line
  was the first row of the virtual list, so the library anchored the reader's place to it, and
  it never moves. Fix: the line now sits above the list, outside the measured rows. The same
  probe then showed one request, with the reader still on the same message. The history test now
  checks exactly this.
- **J3 failed after the list change.** The old text of an edited message was still in the page,
  in the hidden screen-reader announcement. Announcements are now cleared after 5 seconds, and
  the test looks inside the message list only.
- The test seed failed twice on SQL details: message IDs come from the app (not the database),
  and PostgreSQL needed explicit number types for added parameters.

### Tests run, with actual results

| Check                         | Result                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                  | 13 of 13 tasks; shared 160, db 97, realtime 56 (+2 Redis tests that run in CI), web 107                                                                                                                                         |
| Same tests on PostgreSQL 17.9 | shared 160, db 97, realtime 56 (+2), web 107                                                                                                                                                                                    |
| New web tests                 | outbox 9, history route 3, older pages in state 2                                                                                                                                                                               |
| End-to-end                    | 11 of 11 in 1.4 min, including J4 (new) and the 10,000-message history test (new)                                                                                                                                               |
| 10,000 messages (HIST-04)     | at most 24 message rows in the page; whole history scrolled one screen per frame: p95 30.6 ms, worst 51.2 ms, 1 of 548 frames over 50 ms; start reached after 100 page requests, 18.6 s (development laptop, headless Chromium) |
| CI (GitHub runner)            | run 37058505770: all 6 jobs green; E2E 11 of 11; 10,000 messages: p95 33.4 ms, worst 54.3 ms, 1 of 548 frames over 50 ms                                                                                                        |
| Screens inspected             | room offline (banner, a waiting message, everyone shown offline), room at phone width                                                                                                                                           |

## D4: Direct messages, notifications and search (done)

### What was built, and how it works

- **Direct messages** (DM-01). "Message" next to each person in a room's member list opens your
  DM with them, creating it the first time. There is only ever one DM per pair, even if both
  start it at the same moment. A DM page is the room page without room tools: the other person
  in the header with "Block", messages, replies, reactions, edits and the composer. New DMs
  appear in both people's sidebars at once, with unread badges.
- **Who may message me** (Settings > Profile > Privacy): anyone, only my contacts, or no new
  conversations. Existing DMs stay open.
- **Receipts** (DM-02): your messages in a DM show one tick ("Sent"), two ticks ("Delivered":
  the other person's device received it) and two blue ticks ("Seen"). They appear only if both
  people allow read receipts.
- **Blocking** (SAFE-01): "Block" in the DM header; "Unblock" there or in settings. Neither
  person can write in the DM or start a new one; the refusal reads the same whoever blocked, so
  a block is never revealed. Mentions and DMs from a blocked person notify nothing, and their
  room messages are folded behind "Show".
- **Notifications** (NOTIF-01, MSG-06): a mention, a reply to your message, or a DM creates a
  notification in the same database transaction as the message, and it is pushed live. The bell
  in the sidebar counts them; the notifications page lists them with a link to each message and
  marks them seen. A burst of DMs makes one notification until it is read.
- **Browser notifications** (NOTIF-02): an opt-in switch on the notifications page. They show only
  while the tab is hidden, and never contain message text.
- **Search** (HIST-03): `/app/search` finds whole words in any letter case, in your rooms and DMs
  only, newest first, with the words highlighted. A result opens the conversation and scrolls to
  the message (`?m=`), loading older pages if needed.
- History pages now live at `/api/conversations/[id]/messages`, shared by rooms and DMs.

### Decisions

D-042.

### Problems and fixes

- **The local database had stopped** while the session was paused (usage limit). The first E2E
  run failed to connect; `pnpm db:start` fixed it.
- **J11 broke:** it chose the real-name "Everyone" radio by name, and the new "who can message
  me" choices also said "Everyone". The new choices now say what they mean ("Anyone can message
  me", "Only my contacts", "No new conversations"), which is also clearer with a screen reader.
- **A screenshot showed a DM as "Someone"** until the browser fetched the person. The layout now
  sends DM partners with the page.
- A shell heredoc collapsed backslashes in a helper script (the problem CLAUDE.md warns about);
  nothing had been written. The helper was rewritten with the Write tool.

### Tests run, with actual results

| Check                         | Result                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                  | 13 of 13 tasks; shared 160, db 107, realtime 59 (+2 Redis tests that run in CI), web 114                                                            |
| Same tests on PostgreSQL 17.9 | shared 160, db 107, realtime 59 (+2), web 114                                                                                                       |
| New tests                     | db 10 (DMs, policy, blocks, notifications, receipts, search, reading rules); realtime 3 (notification push, receipts, opt-out); web 7               |
| End-to-end                    | 13 of 13 in 1.6 min, including J6 (new: one DM per pair, Sent → Delivered → Seen, notifications, blocking) and search (new); J3 checks the bell now |
| Screens inspected             | DM with "Seen" ticks, notifications page, search results with highlights                                                                            |

## D5: Pictures, photo avatars and link previews (done)

### What was built, and how it works

- **The image pipeline** (MSG-09, SEC-12). Every uploaded file goes through the same checks
  before anything is stored: at most 4 MB; the type is read from the file's first bytes ("magic
  bytes"), so a script renamed to `.png` is refused whatever it is called; the picture must really
  decode as that type; at most 25 million pixels, read from the file's header before decoding
  (a tiny file can claim to be enormous: a "decompression bomb"). The pixels are then drawn again
  into a new WebP file. Only that new file is kept, so nothing else from the original survives:
  no GPS position, no camera details, and nothing hidden after the picture (a "polyglot" file).
- **Pictures in messages.** The picture button (or pasting a picture) uploads at once and shows a
  small preview above the message box with "Uploading", "Ready to send" or the reason it was
  refused. The next message carries the ready pictures; text is optional. Both people see the
  picture at once, sized before it loads so the list does not jump. A click opens it in a new
  tab. An unsent message keeps its pictures across a reload.
- **Who can see a picture.** Pictures are stored privately and always served by our own server
  (`/api/media/<id>`), which checks every request: a message picture needs the right to read
  that conversation; an unsent upload belongs to its uploader; a profile photo needs a signed-in
  account. Deleting a message removes its pictures for everyone.
- **A photo as profile picture** (PROF-08). The picture chooser has a third tab, "Upload a
  photo", in onboarding and in settings. The photo is cropped to a 256-pixel square and stripped
  of metadata like any other picture. Other people see it at once. Going back to a generated
  picture removes the photo. Uploading needs a confirmed email address; until then the tab says
  so.
- **Storage.** A small "driver" interface with three implementations: Vercel Blob with private
  access (production), a folder under `.cache` (development and end-to-end tests) and memory
  (automated tests). File names are random and made by the server.
- **Link previews** (MSG-08, SEC-07). A message with a link shows a small text card under it:
  site name, title, description. No picture, and the reader's browser never contacts the linked
  site. The server fetches the page under strict rules (below), reads only those three pieces of
  text, and keeps the result for 7 days.
- **The fetcher's safety rules.** Only http and https on the standard ports. The server looks
  the name up itself, refuses it if any of its addresses is private (this computer, the local
  network, the cloud provider's metadata address 169.254.169.254, and their IPv6 forms), and
  connects to exactly the address it checked. Every redirect is checked again in full. At most 3
  redirects, 3 seconds, 512 KB, HTML only. The browser cannot name an address at all: it names a
  message, and the server reads the links from that message's text.
- **Clean-up.** A function deletes the files of removed pictures and of uploads never used
  within 24 hours. The daily retention job of Stage E will call it.

### Decisions

D-043 (marked "continuation, needs owner review").

### Problems and fixes

- **Two readers, two fetches.** The first end-to-end run showed the preview server being asked
  twice for one new link, once per reader. In a large room, one message could have made our
  server send a burst of requests to someone else's site. Fix: the first request "claims" the
  address in the cache for 10 seconds; the others are told to ask again a moment later. Tested
  with four simultaneous readers: one fetch.
- **That new test then failed on real PostgreSQL** (it passed on the in-memory test database):
  it assumed the slower requests always arrive before the fetch finishes. With real concurrency
  some arrived after and were answered from the cache, which is also correct. The test now holds
  the fetch open until the other three have been answered.
- **The pixel limit made the header check fail in the wrong way.** With the image library's own
  pixel limit switched on, reading the header of a 30-megapixel picture threw an error, so the
  person would have been told "damaged" instead of "too large". The header is now read without
  that limit (no pixels are decoded for it), the size is checked by us, and the limit stays on
  for decoding.
- **A direction-changing character landed in a test file** (the problem CLAUDE.md warns about):
  the escape for U+202E was written as the real character. The source check caught it; the test
  now builds the character from its number.
- **Shell commands with embedded multi-line text failed to parse** twice and wrote nothing. Edits
  were redone with the file tools and a small find-and-replace helper.
- **Screenshots showed three faults**, all fixed: a refused file showed a broken-image mark in
  the composer (now an icon); a picture-only message showed its "sent" tick on an empty line
  above the picture (now beside it); a picture that can no longer be loaded showed a broken
  image with its label spilling out (now "Picture not available").
- **Lint**: a few findings in new code (an unneeded `String()`, a condition TypeScript could not
  follow across a callback, unbound methods in a test), fixed before the first commit.

### Tests run, with actual results

| Check                         | Result                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                  | 13 of 13 tasks; shared 168, db 119, realtime 61 (+2 Redis tests that run in CI), web 231                                                                                                                                                                                                                                      |
| Same tests on PostgreSQL 17.9 | shared 168, db 119, realtime 61 (+2), web 231                                                                                                                                                                                                                                                                                 |
| New tests                     | shared 8 (file signatures, picture messages, wire shapes, link extraction); db 12 (attaching, who may see, deletion, clean-up, photo avatars, preview cache); realtime 2 (picture messages live, refusals); web 117 (image pipeline 19, uploads, media and storage 10, safe fetcher and page reader 79, previews 8, outbox 1) |
| Guard really tested           | With the IPv4 private-address check switched off, 28 of the link-preview tests fail (then restored)                                                                                                                                                                                                                           |
| End-to-end                    | 16 of 16 in 2.1 min, including three new journeys: J9 pictures, J9 link previews, J11 profile photo. J9 also covers a refused message with "Try again" and "Delete" (UI-05)                                                                                                                                                   |
| HIST-04 in the same run       | 10,000 messages: p95 frame 40.7 ms, worst 91.4 ms, 4 of 548 frames over 50 ms (an earlier run in this session, with the laptop less busy: p95 31.5 ms, worst 56.8 ms, 1 over 50 ms)                                                                                                                                           |
| Screens inspected             | Composer with a picture ready, a refused file, a room with pictures at desktop and phone width, a link preview card, the "Upload a photo" tab, a refused message                                                                                                                                                              |

Not covered by an automated test: the fetcher over https (the tests use http on this computer;
https uses the same code with Node's own certificate checks) and Vercel Blob itself (the driver
is tested against a stand-in; the real store needs the owner's token, Stage H). Both are on the
Stage H smoke-test list.

## Stage D close-out

Exit criteria (`qa/acceptance_criteria.md`): "Journeys J2 to J6, J9 and J11 pass locally as
automated tests; virtualised list; search; notifications; uploads."

| Criterion        | Evidence                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| J2               | `e2e/rooms.spec.ts` "J2: two people chat in a public room, live"                                                       |
| J3               | `e2e/messaging.spec.ts` "J3: format, edit, react, reply, mention and delete"                                           |
| J4               | `e2e/reconnect.spec.ts` "J4: offline sending, catching up, and an outbox that survives a reload"                       |
| J5               | `e2e/rooms.spec.ts` "J5: private room, one-use invite, mute and ban reach the person at once"                          |
| J6               | `e2e/dms.spec.ts` "J6: one DM per pair, Sent, Delivered, Seen, notifications, and blocking"                            |
| J9               | `e2e/media.spec.ts`, two tests (pictures; link previews)                                                               |
| J11              | `e2e/j1-sign-up-and-verify.spec.ts` (suggestions), `e2e/profile.spec.ts` (names, avatars), `e2e/media.spec.ts` (photo) |
| Virtualised list | `e2e/history.spec.ts` (10,000 messages, at most 24 rows in the page)                                                   |
| Search           | `e2e/dms.spec.ts` "HIST-03"                                                                                            |
| Notifications    | `e2e/dms.spec.ts` J6, `e2e/messaging.spec.ts` J3                                                                       |
| Uploads          | `e2e/media.spec.ts`; `upload.test.ts`, `image.test.ts`                                                                 |

All 16 end-to-end tests passed in one run on 2026-10-03 (2.1 min).

Carried into later stages, as the requirements matrix shows:

- J4's third point (restarting the realtime server in the middle of a conversation) is covered
  by realtime tests, not end to end (D-041).
- J11's Google line (a Google name becomes a private real name) needs a real Google app: Stage H.
- NOTIF-02 (browser notifications) needs a hand check in a real browser: Stage G.
- UI-04 (empty, loading and error states on every screen) and A11Y-01 (axe checks, keyboard
  pass) are finished and checked in Stage F.
- SAFE-01: reporting (everywhere, including profile photos) arrives with the report system in
  Stage E.

## What comes next

Stage E: random mode and safety (plan.md). Guests and the 18+ gate, matching, the word filter and
AI moderation module, reports and the moderation dashboard, legal pages, account deletion and
export, and the daily retention job (which will also run the picture clean-up from D5).
