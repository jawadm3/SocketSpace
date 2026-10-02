# PROGRESS

_Last updated: 2026-10-02, end of session 3 (Stage D in progress: D1 done; D2 data and realtime done, D2 browser part next)._

## Current stage

**Stage D (community mode) is in progress.** D1 (profiles and rooms) is done. D2 (messaging) has
its database, shared parser and realtime parts done and tested; **next is D2's browser part**
(see "Exact next step"). Stage C is complete and closed. Step log:
`docs/development/steps/STEP-D-community-mode.md`.

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

### Stage D: community mode (in progress; log: `docs/development/steps/STEP-D-community-mode.md`)

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

## Verified (with evidence)

| What                                                                        | Evidence                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline works                                                              | `pnpm check`: 3/3 Turborepo tasks successful; 1 Vitest test passed.                                                                                                                          |
| v1 excluded from workspace, Turborepo, TypeScript, Vitest, ESLint, Prettier | "Tests run" table in STEP-A.                                                                                                                                                                 |
| v1 history preserved                                                        | `git log --follow -- v1/server.js` reaches `0ef4f61`.                                                                                                                                        |
| pnpm store on D: inside the project                                         | store at `D:\mini project\socketspace\.pnpm-store\v11`.                                                                                                                                      |
| v1 behaviour problems                                                       | Raw outputs in `docs/analysis/evidence/`.                                                                                                                                                    |
| Stages A and B pushed                                                       | `main` on GitHub; tag `v1.0.0`; release page live.                                                                                                                                           |
| Full git history has no secrets (Stage C start)                             | gitleaks 8.30.1: 24 commits scanned, "no leaks found".                                                                                                                                       |
| Pre-commit hook blocks secrets                                              | Fake AWS-style key staged: hook exit 1, value redacted.                                                                                                                                      |
| Database tests on PGlite and real PostgreSQL 17.9                           | 46/46 on both (`TEST_DATABASE_URL` against `db:start`).                                                                                                                                      |
| Shared contract and authorisation tests                                     | 136/136 (52 of them the authorisation table).                                                                                                                                                |
| `pnpm check` after C3                                                       | 7/7 Turborepo tasks successful.                                                                                                                                                              |
| Test counts at the end of Stage C (session 3)                               | shared 136, db 53, web 49, realtime 39 (+2 Redis tests in CI); identical on PGlite and PostgreSQL 17.9. `pnpm check`: 13/13 tasks.                                                           |
| CodeQL clean                                                                | Alerts #1 to #4 fixed by `47d9449`; #5 dismissed with reason (D-035); 0 open.                                                                                                                |
| Windows quoting fix                                                         | Round trip through `Start-Process`: old helper 2/6 arguments intact, new 6/6; `db:start`/`db:stop` cycle works.                                                                              |
| Journeys J1, J11, SEC-05 headers, live connection, AUTH-06 revocation       | Playwright 5/5 locally and in CI (run 36956890831).                                                                                                                                          |
| CI green after D1 and D2 server side                                        | Run 37048118755 on `bd13d82`: all 6 jobs succeeded (checks, PostgreSQL + Redis, E2E, Docker, gitleaks, audit); CodeQL green, 0 open alerts.                                                  |
| Stage D2 server side locally                                                | `pnpm check` 13/13: shared 160, db 97, web 64, realtime 56 (+2 Redis); same on PostgreSQL 17.9; E2E 8/8 (27.7 s).                                                                            |
| Stage D1 locally                                                            | `pnpm check` 13/13: shared 148, db 85, web 64, realtime 45 (+2 Redis); E2E 8/8 (J1, J2, J5, J11 x2, headers, live connection, sign-out elsewhere).                                           |
| CI green on `main`                                                          | Run 36956890831 on `4d31e43` and run 37013142109 on `47d9449`: all 6 jobs succeeded; Redis tests ran; E2E 5/5; 34 commits scanned, no leaks.                                                 |
| Docker images                                                               | CI smoke test: both run as `node`; healthz 200; handshake without Origin 403, with web origin 200; metrics without token 401; readyz database+keys true; realtime exit code 0 after SIGTERM. |
| Foreign-origin probe from v1 now fails                                      | `connection.test.ts` and the Docker smoke test (403).                                                                                                                                        |

## In progress

- Nothing. Stage C is closed and nothing is half-edited.

## Known problems and things waiting for the owner

1. **Accepted advisory:** one moderate `pnpm audit` finding (old esbuild inside drizzle-kit's dev
   loader, never used in production; D-034).
2. **Social sign-in apps:** the owner decided (2026-10-02) to create every provider's developer
   app at once in Stage H, with the live URLs; no local test apps before then.
3. **Optional, owner:** the old pnpm state file is still at
   `C:\Users\jawad\AppData\Local\pnpm-state\` (51 bytes) after the move; it can be deleted.

Done with the owner on 2026-10-02: pnpm's state directory moved to
`D:/mini project/.pnpm-state` (owner); the Better Auth bug reported upstream as
[better-auth/better-auth#11533](https://github.com/better-auth/better-auth/issues/11533) (D-030);
Dependabot security alerts switched on for the repository (0 open alerts at first check).

## Exact next step

Stage D, **D2's browser part** (the server side is done and tested; D-038). In
`apps/web/src/app/(app)/app/r/[slug]/room-view.tsx` and `apps/web/src/lib/chat/`:

1. **Render messages from the markdown-lite tree** (`@socketspace/shared/markdown`) as React
   elements: bold, italic, strike, code, code blocks, quotes, links (`rel="noopener noreferrer
nofollow ugc"`, new tab), @mentions highlighted (your own nickname stronger). Add an ESLint ban
   on `dangerouslySetInnerHTML` (SEC-06).
2. **Chat state** (`lib/chat/state.ts`, with tests): apply `message:updated`,
   `message:deleted` (tombstone) and `reaction:updated` by `eventSeq`; unread counts per room;
   typing per room (expire after 6 s); presence per person. Provider: handle `typing`,
   `presence`, `read:updated`, `reaction:updated`, `message:deleted`; send `presence:set` on tab
   visibility changes; send `read:update` when a room is open and visible.
3. **Message actions**, keyboard reachable: reply (chip in the composer, quote that jumps to and
   highlights the original, "deleted" quote when gone), react (allow-list picker), edit (author,
   24 h; Up arrow in an empty composer edits your last message), delete (author, moderators by
   rank; confirm).
4. **@mention autocomplete** in the composer from the room's members (arrow keys, Enter, Esc).
5. **Typing indicator** under the list ("Ava is typing…", throttled `typing:set` while typing);
   **presence dots** in the member list; **unread badges** in the sidebar (initial counts from
   `unreadCounts`), cleared live across tabs.
6. **Invisible mode** switch in Settings > Profile (`setShowPresence` + `user.updated` event).
7. **E2E**: J3 (edit, delete, react, reply, mention notification row exists, formatting and
   `<img onerror>` shown as text) and J2's typing and unread parts. Then update the matrix
   (MSG-02..07, RT-03..05, PROF-02, SEC-06), STEP-D, PROGRESS, commit and push; check CI.

Local state: run `pnpm db:start` before tests against PostgreSQL or E2E. Run
`pnpm db:migrate:local` after pulling (migration 0002 was added in D1). `apps/web/.env.local` and `apps/realtime/.env.local` exist (generated by
`pnpm setup:local`).

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

| Session  | Stage                               | Effort                                                             |
| -------- | ----------------------------------- | ------------------------------------------------------------------ |
| 1 (done) | A + B: analysis and design          | Ultracode was selected; no workflows were launched in this session |
| 2        | C: foundations                      | Extra                                                              |
| 3        | D: community mode                   | High (Extra if reconnect/resync bugs get subtle)                   |
| 4        | E: random mode and safety           | Extra                                                              |
| 5        | F: themes, home page, accessibility | High                                                               |
| 6        | G: testing, load tests, reviews     | Ultracode (or Max for the security review)                         |
| 7        | H: deployment                       | Medium (High if live debugging)                                    |
| 8        | I: docs, walkthrough, release       | Medium; `ultracode:` prompt for the file-by-file code walkthrough  |
