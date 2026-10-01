# Implementation plan (Stages C to I)

_Stage B, 2026-10-01. Proposed for approval. Each stage ends with: `PROGRESS.md` updated, a step
log, the requirements matrix updated, a commit and a push (brief section 10). Exit criteria per
stage are in `qa/acceptance_criteria.md` section 3._

## Stage C: Foundations

Goal: a secure skeleton where a signed-in user can open a live, authenticated connection, with CI
guarding every push.

| Milestone           | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 Tooling          | gitleaks portable binary in `.cache/tools` + pre-commit hook; `.env.example`; env validation helper; CHANGELOG; Playwright browsers path on D:                                                                                                                                                                                                                                                                                            |
| C2 Database         | Drizzle schema for the tables in `data-model.md` that C and D need; first migration; PGlite test harness; portable Postgres scripts (`pnpm db:start/stop/migrate/seed`); append-only trigger for the audit log                                                                                                                                                                                                                            |
| C3 Shared contracts | Zod schemas for every event and payload in `realtime-protocol.md`; error codes; limits; authorisation module with table-driven tests                                                                                                                                                                                                                                                                                                      |
| C4 Web app shell    | Next.js 16 app in `apps/web`, Tailwind 4, base tokens and theme switching skeleton (Airmail default), Better Auth (email/password, verification with local mail catcher, reset, passkeys, social providers configured from env: Google, Facebook, GitHub, Discord, Microsoft, LinkedIn; safe linking rules), guest sessions, onboarding gate (nickname + avatar required), sessions page, security headers and CSP, `/api/realtime/token` |
| C5 Realtime server  | Socket.IO server: origin check, JWKS token verification, connection caps, membership loading, `message:send` with transactional sequence numbers and idempotency, ack/error shape, rate limiter, `/healthz`, `/readyz`, `/metrics`, graceful shutdown, pino with redaction; Dockerfile                                                                                                                                                    |
| C6 CI               | GitHub Actions: install (with pnpm store cache), lint, typecheck, unit + integration (PGlite and Postgres service), realtime multi-client tests, two-instance Redis test, build, Docker build + container smoke test, gitleaks, `pnpm audit`, CodeQL                                                                                                                                                                                      |

## Stage D: Community mode

| Milestone                     | Contents                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 Profiles and rooms         | Onboarding screens (nickname with suggestions, optional real name with visibility and display choice, avatar gallery and customiser, theme step), viewer-aware user objects; create/join/leave, explore, private rooms, invites, roles, room mute/ban, internal events web → realtime, outbox |
| D2 Messaging                  | Edit (revisions), delete (tombstones), replies, reactions, mentions, markdown-lite parser, typing, presence, read state, delivery ticks                                                                                                                                                       |
| D3 History and reliability    | Cursor pagination, virtualised list, resync by event sequence, outbox with `localStorage`, reconnect UX, offline banner                                                                                                                                                                       |
| D4 DMs, notifications, search | DMs with policy and blocks, in-app notifications, full-text search                                                                                                                                                                                                                            |
| D5 Media                      | Upload pipeline (magic bytes, sharp re-encode, limits) used for messages and avatar photos, storage drivers (Vercel Blob, S3, local), text link previews with SSRF guard                                                                                                                      |

## Stage E: Random mode and safety

| Milestone               | Contents                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 Safety core          | Word-list filter (normaliser, severities, tests), report and block everywhere, sanctions model                                                                                                                   |
| E2 Random mode          | Gate, guest sessions with stricter limits, queue and matcher, relay, evidence buffer, offers (share/add contact, signed-in users only), cooldowns and timeouts, room suggestions, aggregate metrics, kill switch |
| E3 Moderation dashboard | Reports and flags queues, user actions, message removal/restore, audit log viewer, live enforcement, stats                                                                                                       |
| E4 AI moderation        | OpenAI-compatible client, Groq configuration, mock provider, caching, fallback, flag off by default; confirm Groq training policy                                                                                |
| E5 Data rights          | Legal pages (templates), account deletion, data export, daily retention job                                                                                                                                      |

## Stage F: Home page, design system, accessibility, performance

| Milestone                   | Contents                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 Design system and themes | Three token sets (Airmail default, Signal, Aurora) × light/dark in `packages/ui`, with contrast fixes from `visual-directions.md`; Settings > Appearance and header theme switcher; flash-free server rendering; components |
| F2 Home page                | One Canvas hero per theme (only the active one loads), scroll sections, reduced-motion and low-power fallbacks (Aurora without blur on low-power devices), lazy loading, measured LCP/TBT                                   |
| F3 Responsive and states    | Mobile and tablet layouts; empty/loading/error states audit                                                                                                                                                                 |
| F4 Visual QA                | Screenshots at 375, 768, 1440 px × light/dark for every key screen; fixes; Lighthouse runs                                                                                                                                  |

## Stage G: Testing completion and reviews

E2E journeys J1 to J13 in CI; coverage gates; visual regression baselines from CI; load harness and
results (laptop hardware recorded); independent security review, accessibility audit and design/UX
review (separate agents with independent contexts, same underlying model), with every finding fixed
or documented.

## Stage H: Deployment

1. Re-check all free-tier numbers.
2. Deployment guide and configuration (Vercel, Render with Dockerfile, Neon, Resend or SMTP, Vercel
   Blob, UptimeRobot, optional Sentry).
3. **Owner checklist** (one list: the is-a.dev subdomain request, accounts and developer apps for each sign-in provider, free plans, settings, environment variable names and
   where to paste them). Work pauses until the owner confirms.
4. Migrations and demo seed on Neon; deploy; live smoke tests (J1, J2, J7, J8) with results
   recorded; measure free-tier limits (cold start time, connection latency, throughput).

## Stage I: Documentation and release

Code walkthrough for every source file (line-by-line for auth, socket handling, matching,
moderation, persistence, reconnection); architecture docs refreshed; README with real screenshots
and the live link; CHANGELOG; full-history gitleaks scan; Definition of Done checklist; `v2.0.0`
tag and GitHub Release (or owner steps if credentials are needed).

## When the owner is needed

| When               | What                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done (2026-10-01)  | Plan approved; decisions recorded (D-009 to D-025)                                                                                                                                                                                    |
| Any time           | Optional: GitHub Release for `v1.0.0` (steps in `PROGRESS.md`)                                                                                                                                                                        |
| Stage C (optional) | Create test OAuth apps (for example GitHub and Google) with a `localhost` callback so social sign-in can be tested locally; otherwise it is tested in Stage H                                                                         |
| Stage H            | Request the is-a.dev subdomain; create accounts and developer apps (Vercel, Render, Neon, Resend, UptimeRobot, Google, Facebook, GitHub, Discord, Microsoft, LinkedIn; Sentry optional); set environment variables from the checklist |
| Stage I            | If `gh` stays logged out: publish the `v2.0.0` release from the given steps                                                                                                                                                           |

## Risk register

| #   | Risk                                                                                                    | Likelihood            | Impact | Mitigation                                                                                                                    | Owner of action                    |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| R1  | A free tier changes before or after deployment                                                          | Medium                | High   | Re-check in Stage H; portable Docker image; storage/email drivers                                                             | Assistant                          |
| R2  | Render cold start or restarts hurt the demo                                                             | High                  | Medium | 5-minute pinger; "waking up" screen; tested reconnect                                                                         | Assistant + owner (pinger account) |
| R3  | Neon compute budget exhausted                                                                           | Low (with rules)      | High   | No permanent connections; usage on admin page                                                                                 | Assistant                          |
| R4  | No email domain                                                                                         | Medium                | Medium | is-a.dev subdomain or SMTP fallback; GitHub sign-in; demo accounts                                                            | Owner decision                     |
| R5  | Scope larger than time allows                                                                           | Medium                | High   | MoSCoW priorities; working product after Stage D                                                                              | Assistant                          |
| R6  | Laptop RAM limits (E2E + builds)                                                                        | Medium                | Low    | Production builds for E2E, one browser engine locally, CI for the full matrix                                                 | Assistant                          |
| R7  | Legal exposure if operated publicly (UK OSA, GDPR)                                                      | Low (demo)            | High   | Honest positioning, templates marked as such, random-mode kill switch                                                         | Owner                              |
| R8  | Tool version drift (TypeScript 7, ESLint, Next.js)                                                      | Medium                | Low    | Pinned ranges, lockfile, 3-day release-age rule, decision log                                                                 | Assistant                          |
| R9  | Urgent security patch blocked by the release-age rule                                                   | Low                   | Medium | Documented exemption process                                                                                                  | Assistant                          |
| R10 | Visual regression flakiness across operating systems                                                    | High (if run locally) | Low    | Run only in CI with CI-generated baselines                                                                                    | Assistant                          |
| R11 | Three themes multiply design and QA work (six palettes)                                                 | High                  | Medium | Shared components and tokens only (no per-theme layouts); automated contrast checks; screenshot matrix limited to key screens | Assistant                          |
| R12 | Facebook or other providers need extra verification to go live (for example Meta business verification) | Medium                | Low    | Providers are optional per env; hidden until configured; check each provider's rules in Stage H                               | Owner                              |
| R13 | Inappropriate uploaded avatars                                                                          | Medium                | Medium | Report on profiles; moderators reset avatars to a preset; presets and builder as the default path                             | Assistant                          |
