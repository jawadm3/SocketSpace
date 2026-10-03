# Changelog

All notable changes to SocketSpace are recorded here, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html): `MAJOR.MINOR.PATCH`, where a major
change can break things, a minor change adds features, and a patch fixes bugs. Commit messages
follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`feat:`, `fix:`,
`docs:` and so on), which makes this file easy to keep up to date.

Each entry is grouped as **Added**, **Changed**, **Fixed**, **Security** or **Removed**.

## [Unreleased]: v2 development

v2 is being built in stages (A to I, see `docs/development/plan.md`). It will be released as
`2.0.0` at the end of Stage I.

### Added

- **Stage E (random mode and safety), in progress**
  - E1 safety core: a word-list filter that undoes disguised spellings and matches whole words
    (mild words allowed in rooms, harsher ones masked and flagged, the worst not sent);
    "Report" on messages, people (including profile pictures) and rooms, with evidence taken
    by the server; sanctions (warning, mute, suspension, ban, random-mode timeout) with a
    required reason, an audit-log entry and live enforcement; an "Account standing" page.

- **Stage D (community mode), in progress**
  - D1 rooms: create public or private rooms, explore and search, join and leave, invite links
    (shown once, stored as a fingerprint, expiry and use limits), roles and ownership transfer,
    room mute, remove and ban with reasons, rename and delete; all audited and live.
  - The app shell: one live connection for every page, sidebar of your rooms, live messages with
    optimistic sending, automatic resync after reconnects and gaps, moderator notices.
  - Profiles: optional real name with who may see it, 24 preset pictures and an avatar builder,
    profile settings; a new nickname or picture reaches people at once.
  - D2 messaging (server side): markdown-lite parser, edit with 30-day history, delete as
    tombstones, reactions, @mentions, read markers and unread counts, typing indicators, presence
    across tabs with invisible mode.
  - D2 messaging (browser): messages drawn from the markdown-lite tree (never HTML); reply,
    react, edit and delete from an action bar reachable by keyboard; reply quotes that jump to
    the original; the reaction picker; Up arrow edits your last message; @mention autocomplete;
    "is typing" line; presence dots; unread badges cleared across tabs; an invisible-mode switch
    in profile settings; a tick on acknowledged messages.
  - D3 history and reliability: older messages load as you scroll up, keeping your place; a
    virtualised message list (10,000 messages measured); reply quotes load their original;
    an outbox that keeps unsent messages across reloads and sends them in order; an offline
    banner, and reconnecting as soon as the network returns.
  - D5 media: pictures in messages (button or paste; JPEG, PNG, WebP, GIF up to 4 MB), a photo
    as profile picture, and text-only link previews. Every picture is checked by its real type,
    re-encoded to WebP and stripped of metadata such as GPS location before it is stored; storage
    is Vercel Blob (private) in production and a local folder in development.
  - D4: direct messages (one per pair, "who may message me", Delivered and Seen ticks when both
    allow read receipts), blocking, in-app notifications for mentions, replies and DMs with a
    bell and an opt-in for browser notifications, and full-text search that jumps to the
    message.
- **Stage C (foundations), 2026-10-02**
  - Secret scanning: a pinned, checksum-verified gitleaks 8.30.1 (`scripts/tools/gitleaks.mjs`),
    run by a git pre-commit hook (`.githooks/pre-commit`) and by `pnpm secrets:scan`.
  - Environment validation helper (`packages/shared/src/env.ts`): programs stop at start-up with
    a message naming each missing or malformed variable, never its value.
  - Database: Drizzle schema (32 tables), reviewed migrations, append-only audit log, gap-free
    message numbering with idempotent client IDs, local PostgreSQL 17.9 without Docker.
  - Shared contracts: Zod schemas for every real-time event, error codes, profile rules, signed
    internal events, authorisation module.
  - Web app (Next.js 16): sign-up and sign-in with Better Auth (email, passkeys, guests, social
    providers), verification, password reset, onboarding, sessions page, nonce-based CSP, realtime
    connection tokens.
  - Realtime server (Socket.IO): authenticated connections, message sending and resync, rate
    limits, internal events, health and metrics endpoints, graceful shutdown, Docker image.
  - CI on GitHub Actions (checks, PostgreSQL and Redis tests, end-to-end tests, Docker smoke tests,
    secret scan, dependency audit) and CodeQL.
  - Log correlation IDs: every realtime HTTP response carries an `X-Request-Id`, and log lines
    about a connection carry its `socketId`.
- **Stage B (analysis and design), 2026-10-01**
  - v1 analysis with runtime evidence, brief critique, free-tier research, architecture, data
    model, real-time protocol, security design, product design, three visual directions,
    requirements matrix (177 requirements), acceptance criteria and the stage plan.
- **Stage A (repository transition), 2026-10-01**
  - Monorepo skeleton: pnpm workspaces, Turborepo, TypeScript 6.0 strict, ESLint 10, Prettier,
    Vitest 5.
  - `CLAUDE.md`, `PROGRESS.md`, decision log, glossary and storage notes.

### Changed

- v1 moved into `v1/` with its history preserved, and excluded from all v2 tooling.
- The `reaction:toggle` acknowledgement carries the change's event number, and browsers catch
  up on every connection for every room they belong to, not just the open one (D-039).
- Turborepo runs at most four tasks at once, because `pnpm check` ran out of memory on the
  development laptop (D-040).

### Fixed

- Scrolling to the top of a room loaded every older page at once instead of one (found before
  release by a probe test, Stage D3).
- Someone who joined a room while others were online looked offline to them until a reload,
  and saw everyone there as offline too (Stage D2).
- A message in a room you were not looking at made the browser fetch that room's recent history
  (its catch-up started from zero) (Stage D2).
- Two timing-sensitive tests could fail on slow machines: a token rate-limit test that
  straddled a clock minute, and a message burst test whose sends took over a second (Stage D1).
- Signing in while the browser still held the cookie of an ended session silently signed the
  person out again (Stage C, D-030).
- `pnpm db:start` quoted Windows command-line arguments incorrectly (a path ending in `\` was
  mangled); `pnpm setup:local` and the gitleaks installer checked for a file before writing it,
  leaving a gap for a race (CodeQL findings, D-035).

### Security

- One advisory in a development-only tool (`braces`, no fix published yet) is accepted by ID so
  the dependency audit keeps failing on anything else (D-044).
- Uploaded files are never stored as sent: fakes (a script renamed to `.png`), oversized and
  damaged files are refused, and accepted pictures are rebuilt from their pixels, which removes
  location data and anything hidden in the file. Pictures are served only through a route that
  checks who is asking (D-043).
- Link previews are fetched by the server under strict rules (public addresses only, every
  redirect re-checked, the checked address is the one connected to, size and time limits), so a
  link can never make the server read from the private network or a cloud metadata address. One
  message causes at most one fetch per link, however many people read it (D-043).
- Unsent messages kept in the browser are cleared on sign-out and when a session ends (D-041).

- Cross-site sign-in requests are refused (login CSRF), Facebook and Microsoft sign-ins never take
  over an existing account by email, and logs never contain message text or tokens (D-029, D-033).
- The web app's logs no longer include error messages, which can repeat database query
  parameters such as an email address (D-033).
- The gitleaks download is checked against its pinned SHA-256 in memory, before anything is
  written to disk (D-035).

## [1.0.0]: 2025 (the original mini project)

The original university mini project: a Next.js page and a Socket.IO server that sent every
message to everyone connected. Preserved in `v1/` and as the git tag `v1.0.0`
([release page](https://github.com/jawadm3/SocketSpace/releases/tag/v1.0.0)).

[Unreleased]: https://github.com/jawadm3/SocketSpace/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jawadm3/SocketSpace/releases/tag/v1.0.0
