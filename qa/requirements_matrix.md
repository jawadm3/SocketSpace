# Requirements matrix

_Created in Stage B (2026-10-01). Updated at the end of every stage. Every requirement from
`docs/BRIEF.md` appears here once, with the stage that delivers it, a "done when" criterion, how it
is verified, its status and evidence. Journey-level acceptance scenarios and global quality gates
are in `qa/acceptance_criteria.md`._

**Priority:** M = Must, S = Should, C = Could (see `docs/analysis/brief-critique.md` section 5).
**Verified by:** Unit, Integ (integration with a real database), RT (real-time test with several
simulated clients), E2E (Playwright, two browser users), Insp (inspection of config, code or docs),
Review (separate agent with an independent context, same underlying model), Load, LH (Lighthouse),
Smoke (live deployment smoke test), Shot (screenshots inspected).
**Status:** Done, Proposed (waiting for owner approval), Planned, In progress, Owner (waiting on
the owner).

## Repository transition and process

| ID      | Requirement                                                                   | Brief    | Pri | Stage   | Done when                                                                   | Verified by | Status      | Evidence                                                                                   |
| ------- | ----------------------------------------------------------------------------- | -------- | --- | ------- | --------------------------------------------------------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------ |
| REPO-01 | Clean tree and `main` = `origin/main` before the transition                   | 1.1      | M   | A       | Both at the same commit, nothing uncommitted                                | Insp        | Done        | STEP-A: both `f7a75a3`                                                                     |
| REPO-02 | `origin` points at `https://github.com/jawadm3/SocketSpace.git`               | 1.2      | M   | A       | `git remote -v` shows the new URL                                           | Insp        | Done        | STEP-A; set after owner said "Try again"                                                   |
| REPO-03 | Annotated tag `v1.0.0` on the last v1 commit, pushed                          | 1.3      | M   | A       | Tag exists on GitHub                                                        | Insp        | Done        | `git push origin v1.0.0` → new tag                                                         |
| REPO-04 | GitHub Release for `v1.0.0` (only without new credentials)                    | 1.3      | S   | A       | Release page exists, or owner has the steps                                 | Insp        | Owner       | `gh` not logged in; steps in PROGRESS.md                                                   |
| REPO-05 | Regenerable folders deleted                                                   | 1.4      | M   | A       | No `node_modules`/`.next` from v1                                           | Insp        | Done        | STEP-A                                                                                     |
| REPO-06 | v1 moved with `git mv` into `v1/`; `LICENSE` at root                          | 1.5      | M   | A       | 25 renames; `git log --follow` reaches v1 history                           | Insp        | Done        | Commit `6de4fb2`                                                                           |
| REPO-07 | `v1/README_V1.md`                                                             | 1.6      | M   | A       | File explains v1, differences, tag                                          | Insp        | Done        | `v1/README_V1.md`                                                                          |
| REPO-08 | v1 excluded from every v2 tool                                                | 1.7      | M   | A, C, H | Workspace, lint, types, tests, format, Docker, Vercel and CI all skip `v1/` | Insp, CI    | In progress | Workspace/lint/types/tests/format verified in STEP-A; Docker and deploy checked in C and H |
| REPO-09 | Brief in repo as `docs/BRIEF.md`; changes logged                              | 0, owner | M   | A       | File present, unchanged; change log started                                 | Insp        | Done        | `docs/BRIEF_CHANGES.md`                                                                    |
| PROC-01 | `CLAUDE.md` maintained                                                        | 0.3      | M   | All     | Up to date at each stage end                                                | Insp        | In progress | `CLAUDE.md`                                                                                |
| PROC-02 | `PROGRESS.md` maintained with evidence and exact next step                    | 0.3      | M   | All     | Updated after each chunk of work                                            | Insp        | In progress | `PROGRESS.md`                                                                              |
| PROC-03 | Step log per stage                                                            | 9        | M   | All     | `docs/development/steps/STEP-<letter>-*.md` for A to I                      | Insp        | In progress | STEP-A, STEP-B                                                                             |
| PROC-04 | Decision log                                                                  | 9        | M   | All     | Every significant decision recorded with reasons                            | Insp        | In progress | `docs/development/decisions.md`                                                            |
| PROC-05 | Commit and push after milestones and stages; never force-push or push secrets | 0.4      | M   | All     | Pushed at each stage end; secret scan clean                                 | Insp        | In progress | Stage A pushed                                                                             |
| PROC-06 | Approval stop after Stage B                                                   | 0.4      | M   | B       | Plan presented; work waits for approval                                     | Insp        | In progress | This stage                                                                                 |
| DEV-01  | Local development without Docker                                              | 4        | M   | C       | Apps, database and tests run on the laptop with no Docker                   | Insp        | Planned     | Portable Postgres + PGlite plan in research doc 3.4                                        |
| DEV-02  | Everything on D:; exceptions listed                                           | 4        | M   | A+      | `docs/technical/storage.md` current                                         | Insp        | In progress | storage.md                                                                                 |
| DEV-03  | Dockerfiles built and tested in CI                                            | 4        | M   | C       | CI builds both images and runs a container smoke test                       | CI          | Planned     |                                                                                            |
| DEV-04  | Limit heavy concurrent processes (RAM)                                        | 4        | M   | All     | E2E against production builds, one engine locally                           | Insp        | Planned     |                                                                                            |

## Stage B analysis deliverables

| ID     | Requirement                                                   | Brief  | Pri | Stage | Done when                                                     | Verified by | Status                    | Evidence                                    |
| ------ | ------------------------------------------------------------- | ------ | --- | ----- | ------------------------------------------------------------- | ----------- | ------------------------- | ------------------------------------------- |
| ANA-01 | Verify and extend v1 findings                                 | 0.2, 2 | M   | B     | Each finding has a verdict and evidence; new findings listed  | Insp        | Done                      | `docs/analysis/v1-analysis.md`, `evidence/` |
| ANA-02 | Critique the brief; propose better options with trade-offs    | 0.2    | M   | B     | Alternatives with numbers and a recommendation                | Insp        | Done                      | `brief-critique.md`, `stack.md`             |
| ANA-03 | Free-tier research with numbers from official sources         | 4, 10B | M   | B     | Every service: limits, card requirement, maths, sources, date | Insp        | Done                      | `docs/research/free-tier-research.md`       |
| ANA-04 | Product design: screens and flows                             | 10B    | M   | B     | Screen inventory with states; key flows                       | Insp        | Done                      | `docs/design/product.md`                    |
| ANA-05 | Architecture, data model, event contracts                     | 10B    | M   | B     | Diagrams, tables, every event with checks                     | Insp        | Done                      | `docs/architecture/*`                       |
| ANA-06 | Security and safety design                                    | 10B    | M   | B     | Threat model, controls per area, safety features              | Insp        | Done                      | `security.md`                               |
| ANA-07 | Requirements matrix and acceptance criteria                   | 10B    | M   | B     | This file and `acceptance_criteria.md`                        | Insp        | Done                      | `qa/`                                       |
| UI-03  | 2 to 3 visual directions with rendered mockups; owner chooses | 6.1    | M   | B     | Three mockups with screenshots presented                      | Shot        | Done (waiting for choice) | `docs/design/visual-directions.md`, mockups |

## Accounts and profiles

| ID      | Requirement                                            | Brief | Pri | Stage | Done when                                         | Verified by | Status  | Evidence |
| ------- | ------------------------------------------------------ | ----- | --- | ----- | ------------------------------------------------- | ----------- | ------- | -------- |
| AUTH-01 | Sign up, sign in, sign out (email + password)          | 3.1   | M   | C     | Full flow works; session cookie secure            | Integ, E2E  | Planned |          |
| AUTH-02 | Email verification                                     | 3.1   | M   | C     | Unverified users cannot post; link verifies once  | Integ, E2E  | Planned |          |
| AUTH-03 | Password reset                                         | 3.1   | M   | C     | Single-use link, 30-min expiry, revokes sessions  | Integ, E2E  | Planned |          |
| AUTH-04 | Sign in with GitHub                                    | 3.1   | S   | C     | OAuth flow works locally (test app) and live      | E2E, Smoke  | Planned |          |
| AUTH-05 | Sign in with Google                                    | 3.1   | C   | C/H   | Works if owner configures it                      | Smoke       | Planned |          |
| AUTH-06 | Secure sessions; list and revoke sessions              | 5.1   | M   | C     | Cookie flags verified; revoke disconnects sockets | Integ, RT   | Planned |          |
| AUTH-07 | Password rules (10 to 128) and breached-password check | 5.1   | M   | C     | Breached password rejected; only hash prefix sent | Unit, Integ | Planned |          |
| AUTH-08 | Auth rate limits and progressive lockout               | 5.1   | M   | C     | 4th sign-in in 10 s rejected with retry time      | Integ       | Planned |          |
| AUTH-09 | No account enumeration                                 | 5.1   | M   | C     | Same response for known/unknown emails            | Integ       | Planned |          |
| PROF-01 | Display name, avatar, short bio                        | 3.1   | M   | D     | Edit in settings; avatar re-encoded               | Integ, E2E  | Planned |          |
| PROF-02 | Online status, with invisible mode                     | 3.1   | M   | D     | Presence updates live; invisible hides it         | RT          | Planned |          |
| PROF-03 | Unique username for @mentions                          | 3.1   | M   | D     | Unique, validated, case-insensitive               | Unit, Integ | Planned |          |

## Rooms, DMs and messaging

| ID      | Requirement                                                     | Brief    | Pri | Stage | Done when                                                          | Verified by | Status  | Evidence |
| ------- | --------------------------------------------------------------- | -------- | --- | ----- | ------------------------------------------------------------------ | ----------- | ------- | -------- |
| ROOM-01 | Create public and private rooms                                 | 3.1      | M   | D     | Created with owner role; slug unique                               | Integ, E2E  | Planned |          |
| ROOM-02 | Join/leave public rooms; explore directory                      | 3.1      | M   | D     | Join updates live members; leave stops delivery                    | RT, E2E     | Planned |          |
| ROOM-03 | Invites for private rooms (expiry, uses, revoke)                | 3.1      | M   | D     | Expired/revoked/used-up invites refused                            | Integ       | Planned |          |
| ROOM-04 | Roles: owner, moderator, member                                 | 3.1      | M   | D     | Role matrix test passes for every action                           | Unit        | Planned |          |
| ROOM-05 | Room-level mute and ban by owner/moderators                     | 3.1      | M   | D     | Muted user's send refused; banned user removed live                | RT          | Planned |          |
| ROOM-06 | Room settings: name, topic, delete                              | 3.1      | M   | D     | Owner-only actions refused for others                              | Integ       | Planned |          |
| DM-01   | One-to-one DMs (one per pair), respecting DM policy and blocks  | 3.1      | M   | D     | Second DM to same person reuses it; blocked refused                | Integ       | Planned |          |
| DM-02   | Delivered and seen states in DMs (reciprocal opt-out)           | 3.1      | S   | D     | Ticks change correctly in a two-client test                        | RT, E2E     | Planned |          |
| MSG-01  | Send with acknowledgement and optimistic UI                     | 3.1, 7   | M   | C/D   | Ack returns server message; UI replaces optimistic copy            | RT, E2E     | Planned |          |
| MSG-02  | Edit (author, 24 h) with revision history                       | 3.1      | M   | D     | Edit broadcast; revision stored 30 days                            | RT, Integ   | Planned |          |
| MSG-03  | Delete (author, room mod, admin) as tombstone                   | 3.1      | M   | D     | Body cleared; ordering intact; broadcast                           | RT          | Planned |          |
| MSG-04  | Replies (quote + jump)                                          | 3.1      | M   | D     | Reply links to original, even if original deleted                  | E2E         | Planned |          |
| MSG-05  | Emoji reactions (allow-list)                                    | 3.1      | M   | D     | Toggle broadcast; non-listed emoji refused                         | RT, Unit    | Planned |          |
| MSG-06  | @mentions with autocomplete and notifications                   | 3.1      | M   | D     | Mentioned member notified; non-members not                         | Integ, E2E  | Planned |          |
| MSG-07  | Markdown-lite rendered safely                                   | 3.1, 5.1 | M   | D     | Parser tests incl. hostile input; no raw HTML                      | Unit        | Planned |          |
| MSG-08  | Link previews (server-side, SSRF-safe, text only)               | 3.1, 5.1 | S   | D     | Private/metadata IPs refused; redirects re-checked                 | Unit, Integ | Planned |          |
| MSG-09  | Image sharing with strict validation, re-encoding, EXIF removal | 3.1, 4   | S   | D     | Polyglot/oversized/fake-type files refused; output has no metadata | Unit, Integ | Planned |          |
| MSG-10  | Message size limits                                             | 5.1      | M   | C     | 4,000 chars and 16 KB packet enforced                              | Unit, RT    | Planned |          |

## Real-time, history, notifications, reconnection

| ID       | Requirement                                                    | Brief  | Pri | Stage | Done when                                                                        | Verified by      | Status  | Evidence |
| -------- | -------------------------------------------------------------- | ------ | --- | ----- | -------------------------------------------------------------------------------- | ---------------- | ------- | -------- |
| RT-01    | Authenticated socket connections (signed token + origin check) | 4, 5.1 | M   | C     | Bad/expired token and foreign origin refused (v1's N8 test now fails to connect) | RT               | Planned |          |
| RT-02    | Authorisation on every event (membership on every message)     | 5.1    | M   | C     | Non-member send refused even with a valid socket                                 | RT               | Planned |          |
| RT-03    | Presence                                                       | 3.1    | M   | D     | Online/away/offline correct across tabs                                          | RT               | Planned |          |
| RT-04    | Typing indicators                                              | 3.1    | M   | D     | Shown to others, throttled, auto-expire                                          | RT               | Planned |          |
| RT-05    | Unread counts and read state                                   | 3.1    | M   | D     | Counts correct after reads on another tab                                        | RT, E2E          | Planned |          |
| RT-06    | Live updates across tabs and devices                           | 3.1    | M   | D     | Action in tab 1 appears in tab 2                                                 | E2E              | Planned |          |
| RT-07    | Horizontal scaling design (pub/sub adapter)                    | 4      | M   | C     | CI: two instances + Redis deliver across instances                               | RT (CI)          | Planned |          |
| RT-08    | Connection caps per user and IP                                | 5.1    | M   | C     | 11th socket for a user refused                                                   | RT               | Planned |          |
| HIST-01  | Persisted messages                                             | 3.1    | M   | C     | Survive server restart                                                           | Integ            | Planned |          |
| HIST-02  | Infinite scroll with cursor pagination                         | 3.1    | M   | D     | Stable pages while new messages arrive                                           | Integ, E2E       | Planned |          |
| HIST-03  | Search (Postgres full-text)                                    | 3.1    | S   | D     | Finds words only in conversations you belong to                                  | Integ            | Planned |          |
| HIST-04  | Virtualised message list for long histories                    | 7      | M   | D     | 10,000-message room scrolls smoothly                                             | E2E, manual perf | Planned |          |
| NOTIF-01 | In-app notifications for mentions, replies, DMs                | 3.1    | S   | D     | Created and pushed live; mark as read                                            | RT, E2E          | Planned |          |
| NOTIF-02 | Browser notifications (optional)                               | 3.1    | C   | D/F   | Opt-in only; works when tab hidden                                               | Manual           | Planned |          |
| RECON-01 | Automatic reconnect with back-off; offline banner              | 3.1    | M   | C/D   | Banner shows; reconnects without reload                                          | E2E              | Planned |          |
| RECON-02 | Resync of missed messages by sequence number                   | 3.1, 7 | M   | C/D   | Messages sent while offline appear after reconnect                               | RT, E2E          | Planned |          |
| RECON-03 | No duplicates (client IDs, idempotent writes)                  | 3.1, 7 | M   | C     | Re-send with same client ID returns original                                     | RT, Integ        | Planned |          |
| RECON-04 | No lost messages (outbox survives reload, retries)             | 3.1    | M   | D     | Message typed offline is delivered after reconnect                               | E2E              | Planned |          |

## Random-match mode

| ID      | Requirement                                                     | Brief      | Pri | Stage | Done when                                                      | Verified by | Status   | Evidence       |
| ------- | --------------------------------------------------------------- | ---------- | --- | ----- | -------------------------------------------------------------- | ----------- | -------- | -------------- |
| RAND-01 | Text only; links, images, files refused                         | 3.2        | M   | E     | Link and obfuscated link refused with reason                   | Unit, RT    | Planned  |                |
| RAND-02 | 18+ gate and terms acknowledgement (versioned)                  | 3.2        | M   | E     | Cannot join without accepting current version                  | Integ, E2E  | Planned  |                |
| RAND-03 | Interest matching with random fallback                          | 3.2        | M   | E     | Shared-tag pairs first; fallback after 10 s                    | Unit, RT    | Planned  |                |
| RAND-04 | Skip/next, end, report, block                                   | 3.2        | M   | E     | Each ends session correctly; block prevents rematch            | RT, E2E     | Planned  |                |
| RAND-05 | Strict rate limits, cooldowns after reports, automatic timeouts | 3.2        | M   | E     | 3 reports in 24 h → 24 h timeout; filter hit → 1 h             | RT          | Planned  |                |
| RAND-06 | Content filtering (strict)                                      | 3.2, 5.2   | M   | E     | High severity blocked and ends session                         | Unit, RT    | Planned  |                |
| RAND-07 | Ephemeral; minimum metadata; documented retention               | 3.2        | M   | E     | No message text in DB or logs; metadata deleted after 30 days  | Integ, Insp | Planned  |                |
| RAND-08 | Mutual profile share / add contact (signed-in users)            | 3.2        | M   | E     | Happens only after both accept                                 | RT, E2E     | Planned  |                |
| RAND-09 | Path to community + privacy-respecting aggregate metrics        | 3.2        | M   | E     | Room suggestions shown; counters increment; no user IDs stored | Integ       | Planned  |                |
| RAND-10 | Guest access policy                                             | 3.2        | M   | E     | As decided by the owner                                        | RT          | Proposed | Owner decision |
| RAND-11 | Random mode kill switch                                         | (critique) | M   | E     | `RANDOM_MODE_ENABLED=false` hides and refuses it               | Integ       | Proposed |                |
| RAND-12 | Video and voice out of scope; listed as future work             | 3.2        | M   | I     | In README "Future improvements"                                | Insp        | Planned  |                |

## Administration and moderation

| ID       | Requirement                                               | Brief    | Pri | Stage | Done when                                          | Verified by | Status  | Evidence |
| -------- | --------------------------------------------------------- | -------- | --- | ----- | -------------------------------------------------- | ----------- | ------- | -------- |
| ADMIN-01 | Review reports with server-side evidence                  | 3.3      | M   | E     | Queue lists reports with snapshot and context      | Integ, E2E  | Planned |          |
| ADMIN-02 | View flagged content                                      | 3.3      | M   | E     | Filter/AI flags listed by severity                 | Integ       | Planned |          |
| ADMIN-03 | Warn, mute, suspend, ban (and lift)                       | 3.3      | M   | E     | Each enforced live; reason required; user notified | RT, E2E     | Planned |          |
| ADMIN-04 | Remove (and restore) messages                             | 3.3      | M   | E     | Removal broadcast; body kept 30 days for review    | RT          | Planned |          |
| ADMIN-05 | Audit log of moderator actions (append-only)              | 3.3      | M   | E     | UPDATE/DELETE on the table fails; viewer lists all | Integ, E2E  | Planned |          |
| ADMIN-06 | Admin-only access to the dashboard                        | 3.3, 5.1 | M   | E     | Non-admin requests refused server-side             | Integ       | Planned |          |
| ADMIN-07 | Stats: connections, messages/min, funnel, free-tier usage | 3.2, 7   | S   | E/F   | Shown from metrics and aggregates                  | Shot        | Planned |          |

## Security baseline (section 5.1)

| ID     | Requirement                                                               | Brief   | Pri | Stage | Done when                                                          | Verified by | Status  | Evidence                             |
| ------ | ------------------------------------------------------------------------- | ------- | --- | ----- | ------------------------------------------------------------------ | ----------- | ------- | ------------------------------------ |
| SEC-01 | Validate every input on the server with size limits                       | 5.1     | M   | C     | Every route and event has a strict schema (lint/check script)      | Unit, Insp  | Planned |                                      |
| SEC-02 | Rate limits per user and IP (HTTP and socket); flood protection           | 5.1     | M   | C/E   | Limits enforced with `retryAfterMs`; repeat offenders disconnected | RT, Integ   | Planned |                                      |
| SEC-03 | Secure session cookies and CSRF protection                                | 5.1     | M   | C     | Cookie flags; cross-origin POST refused                            | Integ       | Planned |                                      |
| SEC-04 | Strict CORS from configuration, never hardcoded                           | 5.1     | M   | C     | Origins only from env; tests for foreign origin                    | RT, Insp    | Planned |                                      |
| SEC-05 | Security headers and Content Security Policy                              | 5.1     | M   | C/F   | Headers present on all pages (automated check)                     | Integ       | Planned |                                      |
| SEC-06 | Safe rendering; no raw HTML                                               | 5.1     | M   | D     | Lint rule bans `dangerouslySetInnerHTML`; XSS tests                | Unit, Insp  | Planned |                                      |
| SEC-07 | Safe link previews (no SSRF)                                              | 5.1     | S   | D     | SSRF test suite passes (IPv4, IPv6, redirects, rebinding)          | Unit, Integ | Planned |                                      |
| SEC-08 | Secrets only in env; `.env*` ignored; `.env.example`                      | 5.1     | M   | C     | Example has names and descriptions only                            | Insp        | Planned | `.gitignore` already ignores `.env*` |
| SEC-09 | gitleaks pre-commit and CI; full-history scan                             | 5.1, 11 | M   | C, I  | CI job green; full-history scan clean before release               | CI          | Planned |                                      |
| SEC-10 | Dependency audit and CodeQL                                               | 5.1     | M   | C     | `pnpm audit` and CodeQL jobs green                                 | CI          | Planned |                                      |
| SEC-11 | Structured logs without passwords, tokens, random-mode text or excess PII | 5.1     | M   | C     | Redaction tests; grep of logs in E2E finds no message text         | Unit, E2E   | Planned |                                      |
| SEC-12 | Secure file uploads                                                       | 4, 5.1  | S   | D     | Magic-byte, size, pixel limits, re-encode tests                    | Unit        | Planned |                                      |
| SEC-13 | Authorisation module with table-driven tests                              | 5.1     | M   | C     | Every role × action combination tested                             | Unit        | Planned |                                      |
| SEC-14 | Independent security review; findings fixed or documented                 | 7, 11   | M   | G     | Review report with dispositions                                    | Review      | Planned |                                      |

## Safety (section 5.2) and AI moderation (section 5.3)

| ID      | Requirement                                                                                       | Brief    | Pri | Stage | Done when                                                    | Verified by | Status      | Evidence               |
| ------- | ------------------------------------------------------------------------------------------------- | -------- | --- | ----- | ------------------------------------------------------------ | ----------- | ----------- | ---------------------- |
| SAFE-01 | Report and block everywhere; blocked users cannot contact the blocker                             | 5.2      | M   | D/E   | Blocked DM/mention/match refused                             | RT, E2E     | Planned     |                        |
| SAFE-02 | Word-list filter with severity levels                                                             | 5.2      | M   | E     | Normalisation and false-positive tests pass                  | Unit        | Planned     |                        |
| SAFE-03 | Terms, Privacy Policy, Community Guidelines (UK/EU, plain language, "template, not legal advice") | 5.2      | M   | E     | Pages live and linked from sign-up and random gate           | Insp        | Planned     |                        |
| SAFE-04 | Account deletion                                                                                  | 5.2      | M   | E     | Data removed per policy; re-auth required                    | Integ, E2E  | Planned     |                        |
| SAFE-05 | Data export                                                                                       | 5.2      | M   | E     | JSON download with documented contents; 1 per day            | Integ       | Planned     |                        |
| SAFE-06 | Retention job                                                                                     | 3.2, 5.2 | M   | E     | Daily job deletes expired data (tested with fake clock)      | Integ       | Planned     |                        |
| AI-01   | Provider-agnostic, OpenAI-compatible module behind a flag, off by default                         | 5.3      | S   | E     | Provider switched by config only                             | Unit        | Planned     |                        |
| AI-02   | Mock provider for tests; no local models                                                          | 5.3      | S   | E     | All tests use the mock                                       | Insp        | Planned     |                        |
| AI-03   | Send only minimum text, never account details                                                     | 5.3      | S   | E     | Request payload test                                         | Unit        | Planned     |                        |
| AI-04   | Respect rate limits; cache; fall back to word list                                                | 5.3      | S   | E     | Fallback on timeout/429 tested                               | Unit        | Planned     |                        |
| AI-05   | Provider data-retention and training policy documented                                            | 5.3      | S   | B/E   | Groq retention documented (B); training policy confirmed (E) | Insp        | In progress | research doc section 8 |

## Frontend, design and motion (section 6)

| ID      | Requirement                                                                             | Brief | Pri | Stage | Done when                                                   | Verified by | Status      | Evidence                            |
| ------- | --------------------------------------------------------------------------------------- | ----- | --- | ----- | ----------------------------------------------------------- | ----------- | ----------- | ----------------------------------- |
| UI-01   | Design system tokens (colour, type, spacing, radius, elevation, motion), light and dark | 6.1   | M   | C/F   | Tokens in `packages/ui`; both themes complete               | Insp, Shot  | Planned     |                                     |
| UI-02   | One icon set (Lucide)                                                                   | 6.1   | M   | C/F   | No other icon sources                                       | Insp        | Planned     |                                     |
| UI-04   | Empty, loading and error states everywhere                                              | 7     | M   | D/F   | Each screen in `product.md` has all three                   | Shot        | Planned     |                                     |
| UI-05   | Optimistic sending with clear failure handling                                          | 7     | M   | D     | Failed message shows reason and retry                       | E2E         | Planned     |                                     |
| UI-06   | Responsive (mobile, tablet, desktop)                                                    | 7     | M   | F     | Screenshots at 375, 768, 1440 px have no layout faults      | Shot        | Planned     |                                     |
| UI-07   | In-app motion subtle (150 to 250 ms); never slows chatting                              | 6.2   | M   | F     | Motion tokens; no animation on message insert beyond 200 ms | Insp        | Planned     |                                     |
| HOME-01 | Memorable animated landing page                                                         | 6.2   | M   | F     | Built from the chosen direction                             | Shot        | Planned     | Prototypes in mockups               |
| HOME-02 | Lightest tool that achieves the effect, justified                                       | 6.2   | M   | B/F   | Measured comparison if 3D is considered                     | LH, Insp    | In progress | Canvas-first decision in `stack.md` |
| HOME-03 | Lazy-load after first paint; pause off-screen/hidden; cap DPR                           | 6.2   | M   | F     | Verified in code and with a performance trace               | Insp        | Planned     |                                     |
| HOME-04 | Reduced-motion and no-WebGL/low-power fallbacks                                         | 6.2   | M   | F     | Static fallback screenshots                                 | Shot        | Planned     |                                     |
| HOME-05 | LCP, TBT, Lighthouse recorded (desktop and mobile); LCP under about 2.5 s               | 6.2   | M   | F/G   | Numbers recorded with method and hardware                   | LH          | Planned     |                                     |
| VQA-01  | Screenshots of key screens at 3 widths × 2 themes, inspected and fixed                  | 6.3   | M   | F     | Screenshot set committed with notes                         | Shot        | Planned     |                                     |
| VQA-02  | Visual regression tests for key screens                                                 | 6.3   | S   | G     | CI job compares against committed baselines                 | CI          | Planned     |                                     |
| VQA-03  | Independent design and UX review before release                                         | 6.3   | M   | G     | Review report with dispositions                             | Review      | Planned     |                                     |

## Quality bar (section 7)

| ID      | Requirement                                                                         | Brief | Pri | Stage | Done when                                               | Verified by | Status      | Evidence                           |
| ------- | ----------------------------------------------------------------------------------- | ----- | --- | ----- | ------------------------------------------------------- | ----------- | ----------- | ---------------------------------- |
| TEST-01 | Unit and integration tests (Vitest)                                                 | 7     | M   | C+    | Run in CI on every push                                 | CI          | In progress | Toolchain smoke test (Stage A)     |
| TEST-02 | Real-time tests with multiple simulated clients                                     | 7     | M   | C+    | Suites for messaging, presence, random, moderation      | RT          | Planned     |                                    |
| TEST-03 | E2E: two users chat, reconnect, edit, react, moderate                               | 7     | M   | G     | Playwright suite green in CI                            | E2E         | Planned     |                                    |
| TEST-04 | About 80% coverage for `shared`, `db`, realtime handlers                            | 7     | M   | G     | Coverage report per package                             | CI          | Planned     |                                    |
| LOAD-01 | Reproducible load test with real numbers and recorded hardware                      | 7     | S   | G     | Script + results doc                                    | Load        | Planned     |                                    |
| LOAD-02 | Free-tier deployment's measured limits documented separately                        | 7     | S   | H     | Results doc section for live deployment                 | Load        | Planned     |                                    |
| CI-01   | CI: lint, types, unit/integration, E2E, build, Docker build, secret scan, audit     | 7     | M   | C/G   | All jobs present and green                              | CI          | Planned     |                                    |
| CI-02   | `main` stays green                                                                  | 7     | M   | All   | CI status green at each stage end                       | CI          | Planned     |                                    |
| A11Y-01 | WCAG 2.2 AA intent: keyboard, labels, focus, live regions, contrast, reduced motion | 7     | M   | D/F   | axe checks pass in E2E; manual keyboard pass            | E2E, Insp   | Planned     | Contrast measured for mockups      |
| A11Y-02 | Accessibility audit                                                                 | 10G   | M   | G     | Independent review + axe report                         | Review      | Planned     |                                    |
| PERF-01 | Lighthouse scores for key pages                                                     | 7     | M   | F/G   | Recorded for home, sign-in, app                         | LH          | Planned     |                                    |
| OBS-01  | Structured logging                                                                  | 7     | M   | C     | pino JSON with request IDs                              | Insp        | Planned     |                                    |
| OBS-02  | Health and readiness endpoints                                                      | 7     | M   | C     | `/healthz` (no DB), `/readyz` (DB)                      | Integ       | Planned     |                                    |
| OBS-03  | Error tracking (Sentry, optional)                                                   | 7     | C   | H     | Enabled by `SENTRY_DSN`                                 | Smoke       | Planned     |                                    |
| OBS-04  | Basic metrics: connections, messages/s, errors                                      | 7     | M   | C/E   | `/metrics` with token                                   | Integ       | Planned     |                                    |
| REL-01  | Graceful shutdown                                                                   | 7     | M   | C     | SIGTERM test: clients told to reconnect, no lost writes | RT          | Planned     |                                    |
| REL-02  | Idempotent sending with client IDs                                                  | 7     | M   | C     | See RECON-03                                            | RT          | Planned     |                                    |
| REL-03  | Safe database migrations                                                            | 7     | M   | C     | Reviewed SQL, expand/contract, applied by a deploy step | Insp, CI    | Planned     |                                    |
| VER-01  | SemVer, `CHANGELOG.md`, conventional commits                                        | 7     | M   | C+    | Changelog kept per stage                                | Insp        | In progress | Conventional commits since Stage A |
| VER-02  | `v2.0.0` tag and GitHub Release                                                     | 7, 11 | M   | I     | Tag and release exist                                   | Insp        | Planned     |                                    |

## Deployment (section 8) and documentation (section 9)

| ID     | Requirement                                                                                                                                     | Brief  | Pri | Stage | Done when                                                        | Verified by | Status                    | Evidence                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --- | ----- | ---------------------------------------------------------------- | ----------- | ------------------------- | ------------------------------------------ |
| DEP-01 | Deployment guide and config for every service                                                                                                   | 8      | M   | H     | Guide covers Vercel, Render, Neon, email, storage, pinger        | Insp        | Planned                   |                                            |
| DEP-02 | One owner checklist (accounts, plans, settings, env vars, where)                                                                                | 8, 0.4 | M   | H     | Checklist delivered; work waits for confirmation                 | Insp        | Planned                   |                                            |
| DEP-03 | Live smoke tests: sign-up, verify, two-user chat, random, moderation                                                                            | 8      | M   | H     | Results recorded with dates                                      | Smoke       | Planned                   |                                            |
| DEP-04 | Free-tier limitations documented honestly                                                                                                       | 8      | M   | H/I   | README and docs section                                          | Insp        | Planned                   | Research doc                               |
| DEP-05 | Seeded demo setup without real personal data                                                                                                    | 8      | M   | H     | Seed script; demo accounts clearly fictional                     | Insp, Smoke | Planned                   |                                            |
| DOC-01 | Plain English; glossary                                                                                                                         | 9      | M   | All   | Every term in `docs/glossary.md`                                 | Review      | In progress               | glossary.md                                |
| DOC-02 | Step logs with real test results                                                                                                                | 9      | M   | All   | One per stage                                                    | Insp        | In progress               |                                            |
| DOC-03 | Code walkthrough of every source file; line-by-line for key functions                                                                           | 9      | M   | I     | `docs/code_walkthrough/` complete                                | Review      | Planned                   |                                            |
| DOC-04 | Architecture docs with diagrams                                                                                                                 | 9      | M   | B+    | Overview, message flow, random flow, moderation flow, data model | Insp        | Done (to be kept current) | `docs/architecture/`                       |
| DOC-05 | README for GitHub (live link, real screenshots, features, stack, diagram, setup, deployment, testing, security, limitations, v1 vs v2, license) | 9      | M   | I     | All sections present and accurate                                | Review      | Planned                   |                                            |
| DOC-06 | Never invent results, measurements, users or history                                                                                            | 9      | M   | All   | Every number traceable to evidence                               | Review      | In progress               | Unmeasured claims removed from mockup copy |
