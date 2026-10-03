# PROGRESS

_Last updated: 2026-10-03, session 5 on the `continuation` branch (Stage D complete: D1 to D5
done; Stage E next)._

## Current stage

**Stage D (community mode) is complete.** D1 (profiles and rooms), D2 (messaging), D3 (history
and reliability), D4 (DMs, notifications, search) and D5 (pictures, photo avatars, link previews)
are done and tested end to end, and the stage's exit criteria are met (step log, "Stage D
close-out"). **Next is Stage E: random mode and safety** (see "Exact next step").

**D5 lives on the `continuation` branch**, not on `main`: it was built by a session that was not
told it runs on the owner's account (CLAUDE.md, "Branches"). The owner reviews it in the draft
pull request jawadm3/SocketSpace#1; decision D-043 is marked for that review.
Step log: `docs/development/steps/STEP-D-community-mode.md`.

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

## Verified (with evidence)

| What                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pipeline works                                                              | `pnpm check`: 3/3 Turborepo tasks successful; 1 Vitest test passed.                                                                                                                                                                                                                                                                                                                                                      |
| v1 excluded from workspace, Turborepo, TypeScript, Vitest, ESLint, Prettier | "Tests run" table in STEP-A.                                                                                                                                                                                                                                                                                                                                                                                             |
| v1 history preserved                                                        | `git log --follow -- v1/server.js` reaches `0ef4f61`.                                                                                                                                                                                                                                                                                                                                                                    |
| pnpm store on D: inside the project                                         | store at `D:\mini project\socketspace\.pnpm-store\v11`.                                                                                                                                                                                                                                                                                                                                                                  |
| v1 behaviour problems                                                       | Raw outputs in `docs/analysis/evidence/`.                                                                                                                                                                                                                                                                                                                                                                                |
| Stages A and B pushed                                                       | `main` on GitHub; tag `v1.0.0`; release page live.                                                                                                                                                                                                                                                                                                                                                                       |
| Full git history has no secrets (Stage C start)                             | gitleaks 8.30.1: 24 commits scanned, "no leaks found".                                                                                                                                                                                                                                                                                                                                                                   |
| Pre-commit hook blocks secrets                                              | Fake AWS-style key staged: hook exit 1, value redacted.                                                                                                                                                                                                                                                                                                                                                                  |
| Database tests on PGlite and real PostgreSQL 17.9                           | 46/46 on both (`TEST_DATABASE_URL` against `db:start`).                                                                                                                                                                                                                                                                                                                                                                  |
| Shared contract and authorisation tests                                     | 136/136 (52 of them the authorisation table).                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm check` after C3                                                       | 7/7 Turborepo tasks successful.                                                                                                                                                                                                                                                                                                                                                                                          |
| Test counts at the end of Stage C (session 3)                               | shared 136, db 53, web 49, realtime 39 (+2 Redis tests in CI); identical on PGlite and PostgreSQL 17.9. `pnpm check`: 13/13 tasks.                                                                                                                                                                                                                                                                                       |
| CodeQL clean                                                                | Alerts #1 to #4 fixed by `47d9449`; #5 dismissed with reason (D-035); 0 open.                                                                                                                                                                                                                                                                                                                                            |
| Windows quoting fix                                                         | Round trip through `Start-Process`: old helper 2/6 arguments intact, new 6/6; `db:start`/`db:stop` cycle works.                                                                                                                                                                                                                                                                                                          |
| Journeys J1, J11, SEC-05 headers, live connection, AUTH-06 revocation       | Playwright 5/5 locally and in CI (run 36956890831).                                                                                                                                                                                                                                                                                                                                                                      |
| CI green after D1 and D2 server side                                        | Run 37048118755 on `bd13d82`: all 6 jobs succeeded (checks, PostgreSQL + Redis, E2E, Docker, gitleaks, audit); CodeQL green, 0 open alerts.                                                                                                                                                                                                                                                                              |
| CI green after D3                                                           | Run 37058505770 on `4f19ce0` (D3 plus the CLAUDE.md handover rules): all 6 jobs succeeded; E2E 11 passed in 1.5 min; on the CI runner the 10,000-message test gave p95 33.4 ms, worst 54.3 ms, 1 of 548 frames over 50 ms. CodeQL green; 0 open code-scanning and Dependabot alerts. (Run 37058395720 on `3d12f46` was cancelled by CI when the newer push arrived.)                                                     |
| Stage D5 and Stage D complete locally (session 5)                           | `pnpm check` 13/13 (shared 168, db 119, realtime 61 +2 Redis, web 231); same on PostgreSQL 17.9; E2E 16/16 in 2.1 min including J9 (pictures; link previews) and the J11 photo; the 10,000-message test in that run gave p95 40.7 ms, worst 91.4 ms, 4 of 548 frames over 50 ms (31.5 ms, 56.8 ms and 1 in an earlier run of the session). With the IPv4 private-address check switched off, 28 link-preview tests fail. |
| Stage D4 complete locally (session 4)                                       | `pnpm check` 13/13 (shared 160, db 107, realtime 59 +2 Redis, web 114); same on PostgreSQL 17.9; E2E 13/13 in 1.6 min including J6 and search.                                                                                                                                                                                                                                                                           |
| Stage D3 complete locally (session 4)                                       | `pnpm check` 13/13 (shared 160, db 97, realtime 56 +2 Redis, web 107); same on PostgreSQL 17.9; E2E 11/11 in 1.4 min including J4 and the 10,000-message test (p95 frame 30.6 ms, at most 24 rows in the page).                                                                                                                                                                                                          |
| Stage D2 complete locally (session 4)                                       | `pnpm check` 13/13 (shared 160, db 97, realtime 56 +2 Redis, web 93); same on PostgreSQL 17.9; E2E 9/9 in 41.3 s including J2 (typing, unread on two tabs, presence, invisible mode) and J3 (new).                                                                                                                                                                                                                       |
| CI green after D2                                                           | Run 37054784622 on `8f790f4`: all 6 jobs succeeded (E2E 9 passed in 35.7 s); CodeQL green; 0 open code-scanning and 0 open Dependabot alerts.                                                                                                                                                                                                                                                                            |
| Raw-HTML lint ban fires (SEC-06)                                            | Probe file with `dangerouslySetInnerHTML`: ESLint "Raw HTML is not allowed", exit 1 (probe deleted).                                                                                                                                                                                                                                                                                                                     |
| Dependabot alerts                                                           | 75 alerts, all in the archived `v1/package-lock.json`, dismissed as "not used" with a comment (owner decision, 2026-10-02); 0 open.                                                                                                                                                                                                                                                                                      |
| Stage D2 server side locally                                                | `pnpm check` 13/13: shared 160, db 97, web 64, realtime 56 (+2 Redis); same on PostgreSQL 17.9; E2E 8/8 (27.7 s).                                                                                                                                                                                                                                                                                                        |
| Stage D1 locally                                                            | `pnpm check` 13/13: shared 148, db 85, web 64, realtime 45 (+2 Redis); E2E 8/8 (J1, J2, J5, J11 x2, headers, live connection, sign-out elsewhere).                                                                                                                                                                                                                                                                       |
| CI green on `main`                                                          | Run 36956890831 on `4d31e43` and run 37013142109 on `47d9449`: all 6 jobs succeeded; Redis tests ran; E2E 5/5; 34 commits scanned, no leaks.                                                                                                                                                                                                                                                                             |
| Docker images                                                               | CI smoke test: both run as `node`; healthz 200; handshake without Origin 403, with web origin 200; metrics without token 401; readyz database+keys true; realtime exit code 0 after SIGTERM.                                                                                                                                                                                                                             |
| Foreign-origin probe from v1 now fails                                      | `connection.test.ts` and the Docker smoke test (403).                                                                                                                                                                                                                                                                                                                                                                    |

## In progress

- **Stage E1 (safety core), session 6, `continuation` branch.** Server side done and tested
  (`pnpm check` 13/13: shared 251, db 156, realtime 72 +2 Redis, web 231; db and realtime the same
  on PostgreSQL 17.9):
  - word-list filter in `packages/shared/src/moderation/` (normaliser, list, matcher, masking,
    `moderateText` for community and random mode), wired into `message:send` and `message:edit`
    (high blocked with `CONTENT_BLOCKED`, medium stored as written, masked for readers and
    flagged in `content_flag`);
  - reports in `packages/db/src/queries/reports.ts` (`createReport` with the server's own
    snapshot; reported pictures are kept while a report is open);
  - sanctions in `packages/db/src/queries/sanctions.ts` (`applySanction`, `liftSanction`,
    `resolveSignInStanding`; migration 0003 adds two audit-log action kinds), announced live by
    the realtime server (`user.sanctioned`, `user.unsanctioned`).
  - **Still to do for E1:** the web side (report dialog and buttons on messages, people and
    rooms; the server action with its rate limit; sign-in refusal that names the reason; the
    account-standing page; `sanctionUser`/`liftUserSanction` wrappers that send the internal
    events), an E2E journey, then the documents (decisions, step log STEP-E, matrix, glossary,
    protocol and security docs, changelog).

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
3. **For Stage H (owner):** create the Vercel Blob store with **private** access; Vercel then
   sets `BLOB_READ_WRITE_TOKEN`. Set `STORAGE_DRIVER=vercel-blob` (the app refuses to start in
   production without it). Smoke-test one upload and one https link preview there: neither Vercel
   Blob itself nor https fetching can be tested on this laptop.
4. **Seen, not yet looked into:** during E2E runs the web server prints Node warnings ("11 drain
   listeners added to [Gzip]") and "The destination stream closed early". They appear in journeys
   that D5 did not touch (J1, J2, J6), and every test passes. To look at in Stage G.
5. **Pictures in the web Docker image** are not exercised by the Docker smoke test (it checks
   health only). Production uses Vercel; check an upload if the Docker image is ever used.
6. **Accepted advisory:** one moderate `pnpm audit` finding (old esbuild inside drizzle-kit's dev
   loader, never used in production; D-034).
7. **Social sign-in apps:** the owner decided (2026-10-02) to create every provider's developer
   app at once in Stage H, with the live URLs; no local test apps before then.
8. **Optional, owner:** the old pnpm state file is still at
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

Stage E, **E1: safety core** (plan.md; requirements SAFE-01, SAFE-02, and the sanctions model
used by ADMIN-03 and RAND-05; journeys J7 and J8 in `qa/acceptance_criteria.md` come with E2 and
E3):

1. **Word-list filter** in `packages/shared` (SAFE-02): a normaliser (letter case, accents,
   look-alike characters, repeated letters, separators), three severities, and tests for both
   misses and false positives ("Scunthorpe" must pass). `message.filter_severity` already exists.
2. **Report everywhere** (SAFE-01): messages, people (including profile photos, PROF-08), rooms.
   The `report` table exists; the server takes its own snapshot of the reported content
   (ADMIN-01). Rate-limited.
3. **Sanctions model**: warn, mute, suspend, ban, random-mode timeout (`user_sanction` exists and
   `checkCanPost` already reads it); functions to apply and lift them, with the audit log, and
   live enforcement through the realtime server (`moderation:notice`, `session:ended`).
4. Then E2 (random mode), E3 (moderation dashboard), E4 (AI moderation), E5 (legal pages, account
   deletion, export, and the daily retention job, which must also call
   `collectAttachmentGarbage` from D5 and delete expired `link_preview` rows).

Branch: a session on the owner's account works on `main` (after the owner merges the pull
request); any other session continues on `continuation` (CLAUDE.md, "Branches").

Local state: run `pnpm db:start` before tests against PostgreSQL or E2E (it stops when the laptop
restarts), and `pnpm db:migrate:local` after pulling. `apps/web/.env.local` and
`apps/realtime/.env.local` exist (generated by `pnpm setup:local`); D5 needs no new entries
there (pictures go to `.cache/uploads` by default). `pnpm build` before
`pnpm --filter @socketspace/web e2e`. E2E uses ports 3100, 4100 and 4199 (the pretend web site
for link previews). `E2E_SHOTS=1` also writes screenshots to `apps/web/test-results/shots`.

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
| next          | E: random mode and safety           | Extra                                                              |
| then          | F: themes, home page, accessibility | High                                                               |
| then          | G: testing, load tests, reviews     | Ultracode (or Max for the security review)                         |
| then          | H: deployment                       | Medium (High if live debugging)                                    |
| last          | I: docs, walkthrough, release       | Medium; `ultracode:` prompt for the file-by-file code walkthrough  |
