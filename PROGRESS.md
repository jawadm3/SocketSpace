# PROGRESS

_Last updated: 2026-10-02, end of session 2 (Stage C: all six milestones built, CI green; stage close-out tasks remain)._

## Current stage

**Stage C: foundations. All six milestones (C1 to C6) are built, tested and pushed, and CI is green
on `main`.** Not yet closed: four CodeQL alerts in developer scripts must be fixed, and the
stage paperwork (STEP-C log, requirements matrix, storage notes, changelog) must be written. See
"Exact next step".

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

### Stage C: foundations (built 2026-10-02; close-out pending)

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
- **Docs in this commit:** decisions D-029 to D-034, 26 new glossary terms, realtime protocol
  updated (`session:ended`, `user.sessions_revoked`, session check on connect), CLAUDE.md
  commands and conventions.

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
| Test counts at the end of session 2                                         | shared 136, db 53 (PGlite and PostgreSQL 17.9), web 44, realtime 36 (+2 Redis tests in CI).                                                                                                  |
| Journeys J1, J11, SEC-05 headers, live connection, AUTH-06 revocation       | Playwright 5/5 locally and in CI (run 36956890831).                                                                                                                                          |
| CI green on `main`                                                          | Run 36956890831 on `4d31e43`: all 6 jobs succeeded; the two-instance Redis test ran (2 tests).                                                                                               |
| Docker images                                                               | CI smoke test: both run as `node`; healthz 200; handshake without Origin 403, with web origin 200; metrics without token 401; readyz database+keys true; realtime exit code 0 after SIGTERM. |
| Foreign-origin probe from v1 now fails                                      | `connection.test.ts` and the Docker smoke test (403).                                                                                                                                        |

## In progress

- Stage C close-out (see "Exact next step"). Nothing is half-edited in the code.

## Known problems and things waiting for the owner

1. **CodeQL: 4 open alerts, all in developer scripts** (none in the apps). Fix first next session:
   - `scripts/tools/gitleaks.mjs:80`: file-system race (high) and network data written to a file
     (medium). Plan: verify the download's SHA-256 in memory, write it with exclusive create into a
     fresh temporary folder, unpack, delete; no exists-then-write. (Streaming the zip into bsdtar
     was tried and does not work for zip files.) The medium alert may remain after the fix; record a
     disposition (the bytes are checksum-verified before they touch disk).
   - `scripts/setup-local.mjs:65`: file-system race (high). Plan: write with `flag: 'wx'`, handle
     EEXIST, roll back if only one of the two files could be created.
   - `packages/db/scripts/local-pg.mjs:65`: incomplete sanitisation (high). Plan: replace the
     quote helper with correct Windows command-line quoting (double the backslashes before a quote).
2. **pnpm state file on C:** (1 KB). Optional owner fix:
   `pnpm config set --global state-dir "D:/mini project/.pnpm-state"`.
3. **Optional:** test OAuth apps (for example GitHub, Google) with a `localhost` callback to try
   social sign-in locally before Stage H.
4. **Optional, owner's GitHub account:** report the Better Auth stale-cookie behaviour upstream
   (D-030); and switch on Dependabot security alerts in the repository settings.
5. **Accepted advisory:** one moderate `pnpm audit` finding (old esbuild inside drizzle-kit's dev
   loader, never used in production; D-034).

## Exact next step

1. Fix the three scripts above, push, and confirm CodeQL shows no open high alerts.
2. Stage C close-out: write `docs/development/steps/STEP-C-foundations.md` (goal, what was built,
   decisions, problems and fixes, tests with real results, next); update
   `qa/requirements_matrix.md` (C requirements to Done with evidence: AUTH-01..09/12/13 partly,
   PROF-03/05, RT-01/02/07/08, HIST-01, RECON-03, MSG-10, SEC-01/03/04/05/08/09/10/11/13, OBS-01/02/04,
   REL-01/02/03, DEV-01/03, CI-01/02, TEST-01/02); update `docs/technical/storage.md` (measured:
   `.cache/ms-playwright` 707 MB, `.cache/postgres` 75 MB, `.cache/tools` 30 MB, mail folders);
   update `CHANGELOG.md`; commit and push; check CI is green.
3. Then Stage D (community mode), starting with D1 (onboarding screens, profiles, rooms).

Local state: run `pnpm db:start` before tests against PostgreSQL or E2E (it was stopped at the
end of session 2). `apps/web/.env.local` and `apps/realtime/.env.local` exist (generated by
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
