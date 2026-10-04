# PROGRESS

_Last updated: 2026-10-04, session 7 on the `continuation` branch (Stage E2 done; E3 next)._

## Current stage

**Stage E (random mode and safety) is in progress. E1 (the safety core) and E2 (random mode)
are done** and tested end to end. E2: the 18+ gate, matching by interest, a relay that stores no
text, links and contact details refused, the strict filter, reports with the server's record of
the chat, blocks, automatic pauses, sharing only when both ask, guests, room suggestions, a kill
switch. **Next is E3: the moderation dashboard** (see "Exact next step"). Step log:
`docs/development/steps/STEP-E-random-mode-and-safety.md`.

**D5, E1 and E2 live on the `continuation` branch**, not on `main`: they were built by sessions
that were not told they run on the owner's account (CLAUDE.md, "Branches"). The owner reviews
them in the draft pull request jawadm3/SocketSpace#1; decisions D-043 to D-050 are marked for
that review.

## Owner decisions (2026-10-01)

| Topic                 | Decision                                                                                                             | Record                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Stack                 | Approved as proposed (no Redis on free tier, Vercel Blob, Canvas-first hero, Drizzle, etc.)                          | D-009 to D-020               |
| Look                  | All three directions become user-selectable themes (light and dark); **Airmail is the default**                      | D-021                        |
| Sign-in               | Google, Facebook, GitHub first; Discord, Microsoft, LinkedIn, passkeys under "More ways to sign in"; no Apple (paid) | D-022                        |
| Profile pictures      | Required at onboarding: presets, avatar builder, or photo upload; no default avatar                                  | D-023                        |
| Names                 | Unique nickname in chats and @mentions; optional real name, private by default, display choice                       | D-024                        |
| Email                 | Resend with a free is-a.dev subdomain (set up in Stage H)                                                            | D-014                        |
| Random mode           | Guests allowed, with stricter limits                                                                                 | D-025                        |
| Priorities, retention | Not answered separately; proceeding with the proposed values (changeable any time)                                   | brief-critique 5, data-model |

All additions are logged in `docs/BRIEF_CHANGES.md`.

## Done

### Stage A: environment, repository transition, skeleton (2026-10-01)

- Toolchain inspected; `origin` set to `https://github.com/jawadm3/SocketSpace.git`.
- Annotated tag `v1.0.0` on `f7a75a3`, pushed; **GitHub Release published**:
  https://github.com/jawadm3/SocketSpace/releases/tag/v1.0.0 (`gh` was logged out at the start of
  the session and logged in later).
- v1 moved into `v1/` with `git mv`; `v1/README_V1.md`; brief in `docs/BRIEF.md`.
- Monorepo skeleton (pnpm 12, Turborepo 2, TypeScript 6.0 strict, ESLint 10, Prettier, Vitest 5).
- `CLAUDE.md`, storage doc, decisions, glossary, STEP-A log.

### Stage B: analysis and design (2026-10-01)

- v1 analysis with runtime evidence; brief critique; free-tier research with numbers.
- Architecture (stack, system overview, data model, real-time protocol, security and safety).
- Product design; three visual directions (now the three themes) with live mockups.
- Requirements matrix (177 requirements) and acceptance criteria (13 journeys, gates, exit
  criteria); stage plan with risk register; STEP-B log.
- Owner review incorporated (D-021 to D-025) across all documents.

### Stage C: foundations (2026-10-02, sessions 2 and 3; log: `docs/development/steps/STEP-C-foundations.md`)

- **C1 tooling** (`94e79d9`): pinned, SHA-256-verified gitleaks 8.30.1; pre-commit hook; env
  validation helper; `CHANGELOG.md`.
- **C2 database** (`b5c2f8b`): Drizzle schema for all 32 tables; reviewed migrations (0000 init,
  0001 append-only audit log); `sendMessage` with gap-free sequence numbers and idempotent client
  IDs; PGlite harness plus real-PostgreSQL mode; local PostgreSQL 17.9 (`pnpm db:start`, D-026).
- **C3 shared contracts** (`38e940e`): Zod schemas for every event; acks and error codes; text
  clean-up; nickname/real-name/avatar rules; signed internal events; authorisation module with
  table-driven tests; invisible-character source check.
- **C4 web app** (`cfbe9ba`): Next.js 16.3 + Better Auth 1.7 (email/password with HIBP check,
  verification, reset, passkeys, guests, six social providers from env, Facebook/Microsoft never
  auto-link); DB rate limits + per-account lockout; login-CSRF guard (D-029); stale-cookie sign-in
  fix (D-030); nonce CSP; onboarding gate (nickname + CC0 avatar presets); sessions page;
  `/api/realtime/token`; file mail catcher (`/dev/mail`); `pnpm setup:local`.
- **C5 realtime server** (`304920f`): Socket.IO with origin + JWKS token + live-session +
  account checks, connection caps, `message:send`, `sync:request`, per-user token buckets,
  internal events (HMAC, replay guard), outbox, health/readiness/metrics, graceful shutdown, Redis
  adapter behind `REDIS_URL`, esbuild single-file bundle, Dockerfile; live status on `/app`.
- **C6 CI** (`2792e87`, `4d31e43`): `ci.yml` (checks, PostgreSQL + Redis tests, E2E, Docker
  smoke tests, gitleaks, audit) and `codeql.yml`; actions pinned to SHAs; web Dockerfile
  (Next.js standalone, opt-in).
- **Docs** (`4cd3d42`): decisions D-029 to D-034, 26 new glossary terms, realtime protocol
  updated (`session:ended`, `user.sessions_revoked`, session check on connect), CLAUDE.md
  commands and conventions.
- **Close-out (session 3):**
  - CodeQL fixes (`47d9449`, D-035): exclusive file creation in `setup:local` and the gitleaks
    installer (checksum verified in memory first), correct Windows argument quoting in
    `db:start`. Three high alerts fixed; the medium "network data to file" alert, inherent to any
    downloader, dismissed as "won't fix" with a link to D-035. **0 open alerts.**
  - Gaps found by checking every "done when" against a real test, then closed: request and socket
    IDs on log lines (OBS-01), a restart-and-resync test (HIST-01), web logger reduced to error
    names and codes (D-033), a Microsoft no-auto-link test (AUTH-13, shown to fail when the rule is
    removed), and a verification-link reuse test (AUTH-02).
  - STEP-C log (with the Better Auth upstream report text), requirements matrix (50 Done, 35 In
    progress, 92 Planned of 177), storage notes re-measured, 9 glossary terms, changelog.

### Stage D: community mode (complete; log: `docs/development/steps/STEP-D-community-mode.md`)

- **D1 profiles and rooms** (`3570c15`, `7b5fc4f`, `1652b83`, `3d52162`; D-036, D-037):
  - Rooms in the database: create, join, leave, explore with search, settings, roles and
    ownership transfer, invites (code shown once, only its hash stored; expiry, use limits,
    cancel), room mute, remove and ban with reasons, delete (archive). Each change decides and
    writes in one transaction under the room's row lock; room moderation goes to the audit log
    (migration 0002).
  - Live: membership, role, mute, settings and profile events move sockets and broadcast
    `conversation:*`, `member:*`, `room:notice` (new) and `user:updated` (new), nickname only.
  - Web: app shell with one shared connection, sidebar, notices; room page with live messages,
    optimistic sending, resync on reconnect and on gaps; settings showing only allowed actions;
    invite page; "Room not found" that leaks nothing; `/api/users` (real names only where
    allowed); `/api/avatar` (our own server draws avatars).
  - Profiles: optional real name with visibility and display choice; 24 presets; avatar builder
    from DiceBear's descriptors with server-side validation; profile settings with live updates.
  - Fixed on the way: a flaky token rate-limit test (minute boundary); E2E address pool and proxy
    hop setting (D-037).

- **D2 messaging, server side** (D-038): shared markdown-lite parser (tree, never HTML; hostile
  input tests); edit with 30-day history, delete as tombstones (moderator deletions audited),
  reactions (allow-list, 20 distinct), @mentions (members only, blocks respected), read markers
  and unread counts; realtime `message:edit/delete`, `reaction:toggle`, `read:update`,
  `typing:set`, presence across tabs with invisible mode and "last seen".
- Two flaky tests fixed (minute boundary, burst timing) and one lint error that reached CI.

- **D2 messaging, browser** (session 4; D-039, D-040):
  - Messages drawn from the markdown-lite tree as React elements (never HTML); links open in a
    new tab with `rel="noopener noreferrer nofollow ugc"`; your own @mentions highlighted.
  - Action bar on each message (reply, react, edit, delete), reachable by keyboard; reply chip
    and quotes that jump to the original; reaction picker; inline edit (Up arrow in an empty
    composer edits your last message); delete with confirmation; "(edited)"; a "Sent" tick.
  - @mention autocomplete (members only); "is typing" line; presence dots with "last seen";
    unread badges, cleared on every tab when the room is read; invisible-mode switch in
    Settings > Profile.
  - Chat state: changes applied by event number; every room starts from the server's event
    number and catches up on every connection; unread, typing and presence rules (all tested).
  - Browser throttles for typing and presence signals (the server drops extras silently).
  - Found by inspecting screenshots and fixed in the realtime server: a live room join now
    exchanges presence (before, newcomers looked offline until a reload).
  - `reaction:toggle` acknowledgement carries `eventSeq` (no needless resync).
  - Turborepo limited to 4 tasks at once: `pnpm check` was crashing from lack of memory (D-040).
  - Requirements matrix: 72 Done, 35 In progress, 70 Planned of 177 (MSG-06 stays in progress
    until D4 delivers mention notifications).

- **D3 history and reliability** (session 4; D-041):
  - `GET /api/rooms/[slug]/messages?before=<seq>`: older pages by message number, with the room
    page's read rules.
  - Virtualised message list (TanStack Virtual): opens at the newest, keeps your place when older
    pages load, "New messages" button, reply quotes load their original (up to 20 pages).
  - Outbox in `localStorage`: one at a time, in order; retries with back-off; survives reloads;
    cleared on sign-out.
  - Offline banner; offline/online events pause and resume the connection; the first connection
    is retried.
  - Found and fixed before release: one scroll to the top loaded every page (scroll anchor).
  - Requirements matrix: 77 Done (one "to be kept current"), 33 In progress, 67 Planned of 177.

- **D4 DMs, notifications and search** (session 4; D-042):
  - DMs from the member list ("Message"), one per pair; DM pages reuse the room view; DMs in the
    sidebar with unread badges; "who may message me" and read receipts in Settings.
  - Sent / Delivered / Seen ticks when both people allow read receipts (`delivery:ack`,
    `delivery:updated`, `read:updated` to the other person).
  - Blocking: DMs refused both ways, no notifications from the blocked person, their room
    messages folded; block in the DM header, unblock there or in Settings.
  - Notifications for mentions, replies and DMs, written with the message and pushed live; bell
    with count; notifications page that links to each message; opt-in browser notifications.
  - Search (`/app/search`): whole words, only your conversations, highlighted, jumps to the
    message.
  - Requirements matrix: 82 Done (one "to be kept current"), 33 In progress, 62 Planned of 177.
    NOTIF-02 waits for a hand check in a real browser (Stage G).

- **D5 pictures, photo avatars and link previews** (session 5, `continuation` branch; D-043):
  - Image pipeline (sharp): real type from the first bytes, 4 MB and 25 megapixel limits,
    re-encoded to WebP with every piece of metadata removed; fakes, oversized and damaged files
    refused with a reason.
  - `POST /api/uploads` (own pages only, confirmed email, 20 an hour) and `GET /api/media/<id>`
    (permission checked on every request). Storage drivers: Vercel Blob with private access,
    a local folder, memory.
  - Pictures in messages (button or paste, preview with upload state, text optional), kept in
    the outbox across reloads; a deleted message removes its pictures.
  - A photo as profile picture ("Upload a photo" tab in onboarding and settings), cropped to a
    256-pixel square, shown to others at once.
  - Text-only link previews fetched by the server: private and special addresses refused in
    IPv4 and IPv6, every redirect re-checked, the checked address is the one connected to,
    3 seconds, 512 KB, 7-day cache, one fetch per link however many readers.
  - Found and fixed on the way: two readers caused two fetches of one link (now one, by a
    claim in the cache); three visual faults seen in screenshots.
  - Requirements matrix: 88 Done (one "to be kept current"), 32 In progress, 57 Planned of 177.

### Stage E: random mode and safety (in progress; log: `docs/development/steps/STEP-E-random-mode-and-safety.md`)

- **E1 safety core** (session 6, `continuation` branch; `8efd3b6`, `837923d`; D-045 to D-047):
  - Word-list filter (`packages/shared/src/moderation/`): a normaliser that undoes capitals,
    accents, invisible characters, look-alike letters, leet-speak, repeated and spaced-out
    letters; about 110 words and phrases in three severities; whole-word matching, so
    "Scunthorpe" and "class" pass. In rooms and DMs: mild words are left alone, harsher ones are
    stored as written but shown masked and flagged for a moderator, the worst are not sent at
    all (`CONTENT_BLOCKED`). Edits are checked the same way. `moderateText` already knows the
    stricter random-mode rules for E2. The list never reaches a browser bundle.
  - Reports: "Report" on every message from someone else, on people (behaviour, profile picture,
    name or bio) in the member list and the DM header, and on rooms. The server stores its own
    snapshot as evidence (message as written, earlier versions, five messages around it; the
    profile as the reporter saw it; the room). Ten attempts an hour; the same thing once. A
    reported picture is kept until the report is closed. Block and unblock are now in the member
    list too.
  - Sanctions: warning, mute, suspension, ban and random-mode timeout (`applySanction`,
    `liftSanction`), administrators only, each with a required reason and an audit-log entry
    (migration 0003 adds two action kinds). Enforced by the database (writes refused), the
    realtime server (the person is told the reason; suspension and ban close every connection)
    and at sign-in (refused with the reason; allowed again when a suspension has run out).
  - What the person sees: a live notice, a "message from the moderators" notification, the new
    Settings > Account standing page, and the reason in place of the message box while muted.
  - Found and fixed on the way: a slow worst case in the filter (114 ms to 18 ms), a sign-in
    check that could have waited on a lock, "Try again" on a blocked message, a report dialog
    taller than the screen.
  - Requirements matrix: 89 Done (one "to be kept current"), 35 In progress, 53 Planned of 177.

- **E2 random mode, server side** (session 7, `continuation` branch; `d43c219`):
  - Shared: the 18+ rules with a version (`packages/shared/src/random.ts`), random-mode limits
    and rate limits, a new event `random:resume`, and a detector for links and contact details
    (`packages/shared/src/moderation/contact.ts`: emails, phone numbers also spelled as words,
    usernames on other apps, "example dot com" and similar disguises; 26 ordinary sentences pass).
  - Database (`packages/db/src/queries/random.ts`): gate record, `random_session` metadata
    without text, reports with the realtime server's record of the chat as evidence, automatic
    timeouts through the sanction model (`applyAutomaticRandomTimeout`; guests also by hashed
    network address in `network_ban`), contacts both people agreed to, room suggestions,
    aggregate daily counters, deletion of metadata after 30 days. No migration was needed.
  - Realtime (`apps/realtime/src/random/`, `handlers/random.ts`): queue and matcher in memory
    (shared interests first; anyone once both have waited 10 seconds or named no interests; never
    blocked pairs, never the same pair within 10 minutes), relay with the strict filter, evidence
    buffer of 20 messages kept 5 minutes after a chat, skip, end, report, block (guests: in
    memory), share profile and add contact only when both ask, 15-second reconnect grace,
    10-minute silence ending, 2-minute pause after three skips within seconds, kill switch
    `RANDOM_MODE_ENABLED`, metrics.
- **E2 random mode, web side and documents** (session 7, `continuation` branch; D-048 to D-050):
  - The gate page (six rules, two boxes, an honest note that it is a self-declaration), stored
    per rules version. `/app/random` for signed-in people and `/random` for guests (a guest
    account is created when the gate is accepted), with a "Random chat" link in the sidebar and a
    guest link on the home page, all hidden when `RANDOM_MODE_ENABLED=false`.
  - Four screens: lobby (interests, the pause notice with its end and reason), search (time
    waited, "Widening the search to everyone", cancel), chat (Next, End, Report, Block, Share
    profiles, Add contact, refused messages with the reason, typing), end (why it ended, new chat,
    report, suggested rooms). The screen rules are a pure function with 18 tests
    (`apps/web/src/lib/random/state.ts`); nothing of a chat is kept in the browser.
  - Counters from the web side: a suggested room opened, a room joined from a suggestion.
  - Journey J7 in real browsers (`apps/web/e2e/random.spec.ts`, 3 tests).
  - Found and fixed on the way: a newcomer losing their chance of a shared-interest match, a
    filter flag that would have stored chat text, two automatic pauses at the same moment, a
    report without the chat's end time, a pause notice that said the same thing twice, an end
    screen that forgot the contact just added.
  - Requirements matrix: 102 Done (one "to be kept current"), 33 In progress, 42 Planned of 177.

## Verified (with evidence)

| What                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline works                                                              | `pnpm check`: 3/3 Turborepo tasks successful; 1 Vitest test passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| v1 excluded from workspace, Turborepo, TypeScript, Vitest, ESLint, Prettier | "Tests run" table in STEP-A.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| v1 history preserved                                                        | `git log --follow -- v1/server.js` reaches `0ef4f61`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| pnpm store on D: inside the project                                         | store at `D:\mini project\socketspace\.pnpm-store\v11`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| v1 behaviour problems                                                       | Raw outputs in `docs/analysis/evidence/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Stages A and B pushed                                                       | `main` on GitHub; tag `v1.0.0`; release page live.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Full git history has no secrets (Stage C start)                             | gitleaks 8.30.1: 24 commits scanned, "no leaks found".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pre-commit hook blocks secrets                                              | Fake AWS-style key staged: hook exit 1, value redacted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Database tests on PGlite and real PostgreSQL 17.9                           | 46/46 on both (`TEST_DATABASE_URL` against `db:start`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Shared contract and authorisation tests                                     | 136/136 (52 of them the authorisation table).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm check` after C3                                                       | 7/7 Turborepo tasks successful.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Test counts at the end of Stage C (session 3)                               | shared 136, db 53, web 49, realtime 39 (+2 Redis tests in CI); identical on PGlite and PostgreSQL 17.9. `pnpm check`: 13/13 tasks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CodeQL clean                                                                | Alerts #1 to #4 fixed by `47d9449`; #5 dismissed with reason (D-035); 0 open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Windows quoting fix                                                         | Round trip through `Start-Process`: old helper 2/6 arguments intact, new 6/6; `db:start`/`db:stop` cycle works.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Journeys J1, J11, SEC-05 headers, live connection, AUTH-06 revocation       | Playwright 5/5 locally and in CI (run 36956890831).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CI green after D1 and D2 server side                                        | Run 37048118755 on `bd13d82`: all 6 jobs succeeded (checks, PostgreSQL + Redis, E2E, Docker, gitleaks, audit); CodeQL green, 0 open alerts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CI green after D3                                                           | Run 37058505770 on `4f19ce0` (D3 plus the CLAUDE.md handover rules): all 6 jobs succeeded; E2E 11 passed in 1.5 min; on the CI runner the 10,000-message test gave p95 33.4 ms, worst 54.3 ms, 1 of 548 frames over 50 ms. CodeQL green; 0 open code-scanning and Dependabot alerts. (Run 37058395720 on `3d12f46` was cancelled by CI when the newer push arrived.)                                                                                                                                                                                                                                       |
| Stage E2 complete locally (session 7)                                       | `pnpm check` 13/13 (shared 317, db 181, realtime 124 +2 Redis, web 268); db 181, realtime 124 (+2 skipped), web 268, with `TEST_DATABASE_URL`. E2E 21/21 in 2.7 min including the three J7 tests (one of them was then made independent of timing after it failed in CI, and passed 3 times in a row). Links and contact details: 66 tests; with that check switched off 5 realtime tests fail, with the matcher's block check switched off 4 fail. Web kill switch checked against a production build. Screenshots of the new screens inspected.                                                          |
| Stage E1 complete locally (session 6)                                       | `pnpm check` 13/13 (shared 251, db 156, realtime 72 +2 Redis, web 250); db, realtime and web the same on PostgreSQL 17.9; E2E 18/18 in 2.4 min including the two new safety journeys; the 10,000-message test in that run gave p95 34.8 ms, worst 57.2 ms, 3 of 548 frames over 50 ms. Filter: 83 tests; with the plural rule or the doubled-letter rule switched off, 2 tests fail each. After `pnpm build`, 0 files under `.next/static` contain a list word. Screenshots of the new screens inspected. The 10,000-message test in that run gave p95 39.4 ms, worst 61.4 ms, 9 of 548 frames over 50 ms. |
| Stage D5 and Stage D complete locally (session 5)                           | `pnpm check` 13/13 (shared 168, db 119, realtime 61 +2 Redis, web 231); same on PostgreSQL 17.9; E2E 16/16 in 2.1 min including J9 (pictures; link previews) and the J11 photo; the 10,000-message test in that run gave p95 40.7 ms, worst 91.4 ms, 4 of 548 frames over 50 ms (31.5 ms, 56.8 ms and 1 in an earlier run of the session). With the IPv4 private-address check switched off, 28 link-preview tests fail.                                                                                                                                                                                   |
| Stage D4 complete locally (session 4)                                       | `pnpm check` 13/13 (shared 160, db 107, realtime 59 +2 Redis, web 114); same on PostgreSQL 17.9; E2E 13/13 in 1.6 min including J6 and search.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Stage D3 complete locally (session 4)                                       | `pnpm check` 13/13 (shared 160, db 97, realtime 56 +2 Redis, web 107); same on PostgreSQL 17.9; E2E 11/11 in 1.4 min including J4 and the 10,000-message test (p95 frame 30.6 ms, at most 24 rows in the page).                                                                                                                                                                                                                                                                                                                                                                                            |
| Stage D2 complete locally (session 4)                                       | `pnpm check` 13/13 (shared 160, db 97, realtime 56 +2 Redis, web 93); same on PostgreSQL 17.9; E2E 9/9 in 41.3 s including J2 (typing, unread on two tabs, presence, invisible mode) and J3 (new).                                                                                                                                                                                                                                                                                                                                                                                                         |
| CI green after D2                                                           | Run 37054784622 on `8f790f4`: all 6 jobs succeeded (E2E 9 passed in 35.7 s); CodeQL green; 0 open code-scanning and 0 open Dependabot alerts.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Raw-HTML lint ban fires (SEC-06)                                            | Probe file with `dangerouslySetInnerHTML`: ESLint "Raw HTML is not allowed", exit 1 (probe deleted).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Dependabot alerts                                                           | 75 alerts, all in the archived `v1/package-lock.json`, dismissed as "not used" with a comment (owner decision, 2026-10-02); 0 open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Stage D2 server side locally                                                | `pnpm check` 13/13: shared 160, db 97, web 64, realtime 56 (+2 Redis); same on PostgreSQL 17.9; E2E 8/8 (27.7 s).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Stage D1 locally                                                            | `pnpm check` 13/13: shared 148, db 85, web 64, realtime 45 (+2 Redis); E2E 8/8 (J1, J2, J5, J11 x2, headers, live connection, sign-out elsewhere).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CI green on `main`                                                          | Run 36956890831 on `4d31e43` and run 37013142109 on `47d9449`: all 6 jobs succeeded; Redis tests ran; E2E 5/5; 34 commits scanned, no leaks.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Docker images                                                               | CI smoke test: both run as `node`; healthz 200; handshake without Origin 403, with web origin 200; metrics without token 401; readyz database+keys true; realtime exit code 0 after SIGTERM.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Foreign-origin probe from v1 now fails                                      | `connection.test.ts` and the Docker smoke test (403).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## In progress

- Nothing. E2 is complete; nothing is half-edited.

## Known problems and things waiting for the owner

0. **D4 reached `main` before the continuation rule was seen (2026-10-03). Owner decision:
   keep it on `main`** (decided 2026-10-03). The rule commit `723db87` and D4 (`f2c0587`,
   `383e921`) are on `main`; nothing was rewritten. **Branches (owner, 2026-10-03):** sessions on
   the owner's own account work on `main`; sessions on any other account work on `continuation`
   (draft pull request jawadm3/SocketSpace#1), as CLAUDE.md "Branches" describes. Sessions fetch and re-read CLAUDE.md before every
   push.
1. **For the owner's review (continuation branch):** decision D-043 (how pictures are stored
   and served, no thumbnails, no S3 driver yet, link previews by message). The draft pull request
   jawadm3/SocketSpace#1 carries all of D5.
2. **For the owner's review (continuation branch): one accepted security advisory, D-044.** A new
   high advisory for `braces` (no fixed version exists) reaches the repository only through the
   Next.js lint plugin, a development tool; `pnpm audit --prod` does not list it. It is ignored by ID in
   `pnpm-workspace.yaml` so CI's audit job keeps working. Remove the entry when a fix is
   published.
3. **For the owner's review (continuation branch): decisions D-048 to D-050** (Stage E2): the
   matching rule (two people without a shared interest are paired once both have waited 10
   seconds), what random mode refuses and records (flags without text; automatic pauses; guests
   kept out by a hash of their network address, keyed with a secret the server already has),
   and the gate, guests, kill switch and counters. Each can be changed without touching the
   rest. **One known weakness to weigh (D-049):** one person can make three guest accounts and
   report the same person three times, if they are paired with them three times.
4. **For the owner's review (continuation branch): decisions D-045 to D-047** (Stage E1): what
   the word list contains and which words are only "medium"; what a report keeps as evidence
   (including up to ten surrounding messages of a DM); who may sanction whom, and how long a
   warning is shown. Each can be changed without touching the rest.
5. **A question for the owner (D-045):** nicknames, real names, bios, room names and topics are
   **not** checked against the word list yet. It is a small addition, but refusing names has its
   own false positives (people really are called Dick). Say the word and a session adds it
   (medium and high refused, low allowed).
6. **Nobody is an administrator yet, and nothing in the app applies a sanction.** The functions
   exist and are tested (`sanctionUser`, `liftUserSanction`); the moderation dashboard (E3) will
   call them, and E3 must also decide how the first administrator is made (for example a list of
   email addresses in the configuration). Reports and flags are stored but nobody can read them
   in the app until E3; that includes reports of random chats (E2). Only the automatic
   random-mode pauses of E2 act without a moderator.
7. **For Stage H (owner):** create the Vercel Blob store with **private** access; Vercel then
   sets `BLOB_READ_WRITE_TOKEN`. Set `STORAGE_DRIVER=vercel-blob` (the app refuses to start in
   production without it). Smoke-test one upload and one https link preview there: neither Vercel
   Blob itself nor https fetching can be tested on this laptop.
8. **Seen, not yet looked into:** during E2E runs the web server prints Node warnings ("11 drain
   listeners added to [Gzip]") and "The destination stream closed early". They appear in journeys
   that D5 did not touch (J1, J2, J6), and every test passes. To look at in Stage G.
9. **Pictures in the web Docker image** are not exercised by the Docker smoke test (it checks
   health only). Production uses Vercel; check an upload if the Docker image is ever used.
10. **Accepted advisory:** one moderate `pnpm audit` finding (old esbuild inside drizzle-kit's dev
    loader, never used in production; D-034).
11. **Social sign-in apps:** the owner decided (2026-10-02) to create every provider's developer
    app at once in Stage H, with the live URLs; no local test apps before then.
12. **Optional, owner:** the old pnpm state file is still at
    `C:\Users\jawad\AppData\Local\pnpm-state\` (51 bytes) after the move; it can be deleted.

Done with the owner on 2026-10-02: pnpm's state directory moved to
`D:/mini project/.pnpm-state` (owner); the Better Auth bug reported upstream as
[better-auth/better-auth#11533](https://github.com/better-auth/better-auth/issues/11533) (D-030);
Dependabot security alerts switched on for the repository. Its first full scan found 75 alerts
(3 critical, 37 high, 30 moderate, 5 low), **all in the archived `v1/package-lock.json`**, which
is never installed, built or deployed; v2's `pnpm-lock.yaml` has none. On the owner's decision
(2026-10-02) all 75 were dismissed as "not used", with a comment; 0 are open. Dismissals are
reversible on GitHub. Any new alert in v1's lockfile would need the same treatment.

## Exact next step

**First, look at CI for the E2 pushes.** The server side was green (CI run 37194501279 and CodeQL
run 37194501192 on `e59ee32`; run 37194460107 was cancelled by CI when that newer push arrived).
The first push of the web side failed in CI (run 37195603223 on `f8559d7`): one new browser
test depended on catching a line that is on screen for under half a second. The test was fixed
(the product was right) and passed three times in a row locally. **Look at the CI run of that
fix and of the commit after it** (`gh run list --branch continuation --limit 6`); if one
failed, fix that before anything else.

Stage E, **E3: the moderation dashboard** (plan.md; requirements ADMIN-01 to ADMIN-07; journey J8
in `qa/acceptance_criteria.md`; "Moderation flow" in `docs/architecture/realtime-protocol.md`;
security.md 4.4):

1. **Who is an administrator, and admin-only access** (ADMIN-06): decide how the first
   administrator is made (for example a list of email addresses in the configuration, checked
   when the account's email is confirmed) and record it as a decision. Every `/admin` page and
   action is refused on the server for anyone else (`decideGlobal(actor, 'admin.access')`).
2. **Queues** (ADMIN-01, ADMIN-02): open reports with their evidence, and filter flags by
   severity. The evidence has a version and four shapes (`ReportEvidence` in
   `packages/db/src/queries/reports.ts`): message, user, room, and since E2 `random_session`
   (the chat's metadata and its last messages as written, with who sent each and whether it was
   delivered). Flags from random mode have an empty excerpt and name the `random_session_id`.
   An admin-only view of pictures kept as evidence.
3. **Actions** (ADMIN-03, ADMIN-04): warn, mute, suspend, ban, random-mode timeout and lifting
   them, through `sanctionUser` / `liftUserSanction` (`apps/web/src/server/moderation.ts`);
   resolve or dismiss a report (and tell the reporter); remove and restore a message through the
   `message.moderated` internal event (the realtime server's handler for it is still empty).
4. **Audit log viewer** (ADMIN-05) and **statistics** (ADMIN-07): the counters of E2 are in
   `metric_daily` (`RANDOM_METRICS` in `packages/shared/src/random.ts`, `getMetricTotal`);
   live numbers come from the realtime server's `/metrics`.
5. Then E4 (AI moderation) and E5 (legal pages, linked from sign-up and the random gate; account
   deletion; export; and the daily retention job, which must call `deleteOldRandomSessions`
   from E2, `collectAttachmentGarbage` from D5, and delete expired `link_preview` and
   `network_ban` rows).

Branch: a session on the owner's account works on `main` (after the owner merges the pull
request); any other session continues on `continuation` (CLAUDE.md, "Branches").

Local state: run `pnpm db:start` before tests against PostgreSQL or E2E (it stops when the laptop
restarts), and `pnpm db:migrate:local` after pulling (E1 added migration 0003; E2 added none).
`apps/web/.env.local` and `apps/realtime/.env.local` exist (generated by `pnpm setup:local`); E1
and E2 need no new entries there (`RANDOM_MODE_ENABLED` defaults to on). `pnpm build` before `pnpm --filter @socketspace/web e2e` (always
through that script: it points Playwright at the browser kept on D:). E2E uses ports 3100, 4100
and 4199 (the pretend web site for link previews). `E2E_SHOTS=1` also writes screenshots to
`apps/web/test-results/shots`.

Tools worth knowing: patch scripts with backslashes or apostrophes must be written as files (the
Write tool), not typed into a shell heredoc: a heredoc turned a newline escape into a real line
break in this session (CLAUDE.md, "Invisible characters and backslash escapes").

## Effort guide (from Anthropic's Claude Code docs, checked 2026-10-01)

Sources: [Model configuration](https://code.claude.com/docs/en/model-config) and
[Dynamic workflows](https://code.claude.com/docs/en/workflows).

| Setting         | What it is                                                                                                                                                                                                                  | Use it here for                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low             | Quick exchanges you review each time (brainstorming, a rename)                                                                                                                                                              | Quick questions between stages, tiny fixes                                                                                                          |
| Medium          | The default on Opus 5.5 (your slider's "Recommended"); day-to-day work with a clear scope                                                                                                                                   | Stage H (deployment), Stage I (docs), routine follow-ups                                                                                            |
| High            | Work where verification matters or edge cases are likely (bug fixing in existing code)                                                                                                                                      | Stage D (community features), Stage F (themes, home page, accessibility)                                                                            |
| Extra (`xhigh`) | Deeper reasoning at higher token spend                                                                                                                                                                                      | Stage C (auth, database, real-time server, CI), Stage E (random mode, safety, moderation)                                                           |
| Max             | Deepest reasoning, current session only; for hard problems worked through without you, such as finding security vulnerabilities; can overthink                                                                              | Only when Extra gets stuck on a hard bug, or the Stage G security hunt if Ultracode is off                                                          |
| Ultracode       | Not a level: a setting that makes Claude plan a dynamic workflow (many sub-agents, cross-checked) for each substantive task. Uses noticeably more tokens and reaches usage limits sooner; launching with it also sets Extra | Stage G (codebase-wide audits: security, accessibility, test gaps). For a single big fan-out task, start just that prompt with `ultracode:` instead |

| Session       | Stage                               | Effort                                                             |
| ------------- | ----------------------------------- | ------------------------------------------------------------------ |
| 1 (done)      | A + B: analysis and design          | Ultracode was selected; no workflows were launched in this session |
| 2, 3 (done)   | C: foundations                      | Extra                                                              |
| 3 to 5 (done) | D: community mode                   | High (Extra if reconnect/resync bugs get subtle)                   |
| 6 (E1 done)   | E: random mode and safety           | Extra                                                              |
| 7 (E2 done)   | E: random mode                      | Extra                                                              |
| next          | E3 to E5                            | Extra                                                              |
| then          | F: themes, home page, accessibility | High                                                               |
| then          | G: testing, load tests, reviews     | Ultracode (or Max for the security review)                         |
| then          | H: deployment                       | Medium (High if live debugging)                                    |
| last          | I: docs, walkthrough, release       | Medium; `ultracode:` prompt for the file-by-file code walkthrough  |
