# PROGRESS

_Last updated: 2026-10-02 (Stage C in progress: C1 to C3 done and pushed; C4 next)._

## Current stage

**Stage C: foundations, in progress.** Milestones C1 (tooling), C2 (database) and C3 (shared
contracts) are done, tested and pushed. Next: C4 (web app shell with Better Auth), then C5
(realtime server) and C6 (CI).

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

### Stage C: foundations (in progress, 2026-10-02)

- **C1 tooling** (`94e79d9`): pinned, SHA-256-verified gitleaks 8.30.1 in `.cache/tools`; git
  pre-commit hook (`.githooks/`, enabled by `pnpm install`); `pnpm secrets:scan`; env validation
  helper; `CHANGELOG.md`.
- **C2 database** (`b5c2f8b`): Drizzle schema for all 32 tables; reviewed migrations (0000 init,
  0001 append-only audit log); `sendMessage` with gap-free sequence numbers and idempotent client
  IDs; PGlite test harness plus real-PostgreSQL mode (`TEST_DATABASE_URL`); local PostgreSQL 17.9
  via `pnpm --filter @socketspace/db db:start` (D-026); migrate and seed scripts.
- **C3 shared contracts** (`38e940e`): Zod schemas for every event; error codes and acks; text
  clean-up; nickname, real-name and avatar rules; signed internal events; authorisation module
  with table-driven tests; source check against invisible/bidi characters.

## Verified (with evidence)

| What                                                                        | Evidence                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Pipeline works                                                              | `pnpm check`: 3/3 Turborepo tasks successful; 1 Vitest test passed. |
| v1 excluded from workspace, Turborepo, TypeScript, Vitest, ESLint, Prettier | "Tests run" table in STEP-A.                                        |
| v1 history preserved                                                        | `git log --follow -- v1/server.js` reaches `0ef4f61`.               |
| pnpm store on D: inside the project                                         | store at `D:\mini project\socketspace\.pnpm-store\v11`.             |
| v1 behaviour problems                                                       | Raw outputs in `docs/analysis/evidence/`.                           |
| Stages A and B pushed                                                       | `main` on GitHub; tag `v1.0.0`; release page live.                  |
| Full git history has no secrets (Stage C start)                             | gitleaks 8.30.1: 24 commits scanned, "no leaks found".              |
| Pre-commit hook blocks secrets                                              | Fake AWS-style key staged: hook exit 1, value redacted.             |
| Database tests on PGlite and real PostgreSQL 17.9                           | 46/46 on both (`TEST_DATABASE_URL` against `db:start`).             |
| Shared contract and authorisation tests                                     | 136/136 (52 of them the authorisation table).                       |
| `pnpm check` after C3                                                       | 7/7 Turborepo tasks successful.                                     |

## In progress

- Stage C, milestone C4 (web app shell): Next.js 16, Better Auth (email/password, verification,
  reset, passkeys, social providers from env, guests), onboarding gate, security headers and CSP,
  `/api/realtime/token`.

## Known problems and things waiting for the owner

1. **pnpm state file on C:** (1 KB). Optional owner fix (machine setting):
   `pnpm config set --global state-dir "D:/mini project/.pnpm-state"`.
2. **Optional for Stage C:** test OAuth apps (for example GitHub, Google) with a `localhost`
   callback, if the owner wants social sign-in tested locally before deployment.

## Exact next step

Milestone C4: scaffold Next.js 16 in `apps/web`; Better Auth with the Drizzle adapter and UUID v7
IDs; email driver (file-based mail catcher locally); `apps/web/.env.example`; onboarding gate;
security headers and CSP; `/api/realtime/token`; Playwright (browsers in `.cache/ms-playwright`)
with an automated journey J1. Then C5 (realtime server) and C6 (CI).

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
