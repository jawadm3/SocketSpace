# Decision log

Every important decision, in plain English: what we chose, what else we considered, and why.
Newest decisions are added at the bottom. Stage B decisions (the stack) are recorded here once
the owner approves the plan.

Status values: **Accepted** (in force), **Proposed** (waiting for owner approval), **Superseded** (replaced by a later decision).

---

## D-001: Keep v1 in a `v1/` folder, moved with `git mv`

- **Stage:** A. **Status:** Accepted.
- **Decision:** Move every tracked v1 file into `v1/` with `git mv`, keep `LICENSE` at the root, and tag the last v1 commit as `v1.0.0`.
- **Why:** The owner wants v1 kept for comparison. `git mv` lets git recognise the move as a rename, so `git log --follow v1/server.js` still shows the file's full history. The tag is an exact snapshot that never changes.
- **Detail:** The move commit was kept "pure" (only renames plus new v1-only files). The new v2 root `.gitignore` was added in a later commit. If both had gone in one commit, git would have seen the root `.gitignore` as _edited_ instead of _moved_, and v1's `.gitignore` would have lost its history.

## D-002: Keep the pnpm package store inside the project folder

- **Stage:** A. **Status:** Accepted.
- **Decision:** `storeDir: ./.pnpm-store` and `cacheDir: ./.cache/pnpm` in `pnpm-workspace.yaml`.
- **Alternatives:** pnpm's default for a project on D: is `D:\.pnpm-store` (drive root). That is on D: but outside the project folder, which the brief does not authorise.
- **Why:** Keeps everything on D: and inside the authorised folder. The cost is that another clone gets its own store.

## D-003: Supply-chain guard of 3 days

- **Stage:** A. **Status:** Accepted.
- **Decision:** `minimumReleaseAge: 4320` (minutes) in `pnpm-workspace.yaml`. pnpm will only install package versions that have been public for at least 3 days. Version ranges in `package.json` are kept loose (for example `^5`) so pnpm can choose the newest _mature_ version.
- **Why:** Attacks that publish a poisoned version of a popular package are usually spotted and removed within hours. Waiting 3 days avoids almost all of them. During setup, pnpm automatically added exemptions when exact brand-new versions were requested (turbo 2.11.6 was published the same morning). We removed those exemptions and reinstalled (turbo 2.11.5, vitest 5.0.2) instead of weakening the guard.

## D-004: TypeScript 6.0, not 7.0

- **Stage:** A. **Status:** Accepted.
- **Decision:** Use TypeScript `~6.0.2` (installed 6.0.3).
- **Alternatives:** TypeScript 7.0.2 is the npm "latest" release (the new, much faster native compiler).
- **Why:** `typescript-eslint` 8.x, which gives us type-aware lint rules, declares support only for TypeScript `>=4.8.4 <6.1.0`. Using 7.0 would break linting. Revisit when `typescript-eslint` supports 7.x.

## D-005: Node.js 22 LTS as the baseline

- **Stage:** A. **Status:** Accepted (revisit at deployment).
- **Decision:** Require Node `>=22.13.0`; CI and Docker images will use Node 22.
- **Why:** The laptop already has Node 22.13.0, and upgrading Node is a system change that needs the owner. Every chosen tool supports it (ESLint 10 needs `^22.13.0`, Vitest 5 needs `^22.12.0`, Next.js 16 needs `>=20.9.0`). Node 22 is supported until April 2027. Using the same major version locally, in CI and in Docker avoids "works on my machine" problems.

## D-006: One root ESLint flat config, with v1 ignored

- **Stage:** A. **Status:** Accepted.
- **Decision:** A single `eslint.config.mjs` at the root with `globalIgnores(['v1/**', ...])`, strict type-aware rules from `typescript-eslint`, and per-package `eslint .` scripts run by Turborepo.
- **Why:** One place to maintain rules. Verified that `eslint .` from the root never opens a v1 file (checked with `--debug`).
- **Known edge case:** ESLint 10 uses the _nearest_ config file for each file. If someone runs ESLint directly on a file inside `v1/`, ESLint uses v1's own `v1/eslint.config.mjs` (which fails because v1's dependencies are not installed). That is correct behaviour: v1 is a separate project. v2 commands never do this.

## D-007: pnpm settings live in `pnpm-workspace.yaml`

- **Stage:** A. **Status:** Accepted.
- **Decision:** Put pnpm settings in `pnpm-workspace.yaml`, not `.npmrc`.
- **Why:** Tested on pnpm 12.8.1: the workspace file's `storeDir` takes precedence over `.npmrc`. One settings file is simpler. Note: pnpm 12 ignores `stateDir` in this file (it is a machine-wide setting), so it is listed as an exception in `docs/technical/storage.md`.

## D-008: Turborepo's auto-generated `AGENTS.md` switched off

- **Stage:** A. **Status:** Accepted.
- **Decision:** `"agentGuidance": false` in `turbo.json`; the generated `AGENTS.md` was deleted.
- **Why:** turbo 2.11 writes an `AGENTS.md` block when it detects an AI agent. `CLAUDE.md` is our single agent guide; two guides would drift apart. The option was confirmed in the installed turbo's own `schema.json` before use.

---

## Stage B decisions (accepted by the owner on 2026-10-01)

Full reasoning and numbers: `docs/architecture/stack.md` and `docs/research/free-tier-research.md`.

## D-009: Real-time server is Node.js + Socket.IO in Docker on Render Free

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Alternatives:** Cloudflare Durable Objects (no cold start, but one busy object uses 83% of the daily free duration, hard daily cut-offs, own protocol, lock-in); Koyeb/Northflank/Fly.io (card required); Railway ($1 monthly credit, too fragile); managed real-time services.
- **Why:** portable Docker image, mature acknowledgements/rooms/reconnection, matches the brief's Docker and CI requirements. Cold starts handled with a 5-minute pinger and a clear "waking up" screen.

## D-010: No Redis on the free deployment; Redis adapter behind `REDIS_URL`

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** Upstash Free allows about 16,100 commands/day (presence for six users would use it all); Postgres LISTEN/NOTIFY would keep Neon awake (186% of free compute). One instance makes in-memory correct. Multi-instance fan-out is tested in CI with two instances and a Redis service.

## D-011: PostgreSQL on Neon with Drizzle ORM; PGlite for tests; portable Postgres for local runs

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** Neon's free plan is permanent with no card; Drizzle is stable (0.45), thin, works everywhere we need, and Better Auth supports it. Rules to protect Neon's 100 CU-hours: no permanent connections, idle pools close within 60 s, keep-alive never touches the database.

## D-012: Better Auth, with 5-minute signed tokens for the realtime server

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** self-hosted, maintained (and now also the home of Auth.js), Drizzle support, verification, reset, social sign-in, rate limiting, anonymous sessions and a JWT plugin. The web app and realtime server are on different domains, so the browser carries a short-lived signed token instead of a cookie.

## D-013: Vercel Blob for images (R2 and local drivers available)

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** Cloudflare R2 requires a payment card even for its free tier. Vercel Blob is free on Hobby (1 GB, 2,000 uploads/month) in the same account as the web app. A driver interface keeps R2 one config change away.

## D-014: Resend for email, with a verified domain chosen by the owner

- **Stage:** B. **Status:** Accepted (owner, 2026-10-01): free is-a.dev subdomain + Resend.
- **Why:** Resend's free plan is generous (3,000/month, 100/day) but only sends to other people from a verified domain. Recommended: a free is-a.dev subdomain. Fallback: SMTP through a dedicated Gmail account. Development uses a local mail catcher.

## D-015: Canvas 2D first for the home-page hero

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** the brief's example effect is 2D; Canvas costs a few kilobytes versus roughly 150 to 250 KB for Three.js + React Three Fiber. Working Canvas prototypes exist for all three visual directions. 3D only if a measured prototype proves it necessary.

## D-016: Messages are written only by the realtime server, with per-conversation sequence numbers

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** one writer gives one order. The sequence number is assigned inside the same transaction that checks membership, so permission checks and writes cannot race. Client-generated IDs make re-sends harmless.

## D-017: Random-mode text is never stored

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** the brief asks for ephemeral conversations. The server keeps the last 20 messages of a live session in memory only, so a report within 5 minutes of the end can include server-captured (not reporter-supplied) evidence. Metadata is kept 30 days.

## D-018: Inline replies instead of threads; text-only link previews

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** both satisfy the brief ("replies or threads"; "link previews, server-side and safe") at lower cost and risk. Threads and preview images are listed as future improvements.

## D-019: Load testing with a Node harness using the real Socket.IO client

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** k6 would need hand-written Socket.IO framing; the real client measures what users experience. Artillery is the fallback.

## D-020: Visual regression tests run only in CI

- **Stage:** B. **Status:** Accepted (owner approved the stack, 2026-10-01).
- **Why:** fonts render differently on Windows and Linux, so local screenshots would never match CI baselines. Baselines are generated by a CI job and committed.

---

## Owner additions after the Stage B review (2026-10-01)

The owner approved the stack and added the product changes below. They are also logged in `docs/BRIEF_CHANGES.md`.

## D-021: Three user-selectable themes; Airmail is the default

- **Stage:** B (owner). **Status:** Accepted.
- **Decision:** instead of choosing one visual direction, all three (Signal, Airmail, Aurora) become themes people can pick, each with a light and a dark mode, plus "match my device". **Airmail (light) is the default** for first-time visitors and for the home page.
- **How:** one set of design tokens per theme, switched with a `data-theme` attribute and a `data-mode` attribute on the page. The choice is saved per account (and in a cookie, so the server renders the right theme with no flash). The home page hero follows the active theme; only the active theme's Canvas hero is loaded.
- **Cost:** three themes × two modes = six palettes to design, check for contrast and screenshot. Aurora gets a simplified, blur-free version on low-power and mobile devices.

## D-022: Social sign-in with the best options first

- **Stage:** B (owner). **Status:** Accepted.
- **Decision:** top of the sign-in screen: "Continue with Google" (large), then Facebook and GitHub side by side. Under "More ways to sign in": Discord, Microsoft, LinkedIn and passkeys (fingerprint or face, no password). Email and password below. A "Last used" badge marks the method the person used before on that device.
- **Not included:** Apple (needs a paid Apple Developer Program membership, US$99 per year, which breaks the free-only rule); X/Twitter (frequently changing developer rules; can be added later).
- **Safety:** an account is only linked to an existing one automatically when the provider's email is trustworthy. Better Auth's documentation lists Google, Apple, Discord, GitHub and LinkedIn as trustworthy and warns that Facebook and Microsoft are not, so those two never auto-merge by email; the person signs in the original way and links them from settings.
- **Real names from providers** (for example from Google or Facebook) are stored as the optional real name, hidden by default (see D-024).

## D-023: Every account picks a profile picture during onboarding

- **Stage:** B (owner). **Status:** Accepted.
- **Decision:** no grey default avatar. Onboarding cannot finish until the person picks (1) one of the preset illustrated avatars, (2) a custom avatar built in an avatar builder (face, hair, accessories, colours), or (3) an uploaded photo.
- **How:** presets and the builder use DiceBear (MIT-licensed library) with **CC0** styles only (no attribution needed, commercial use allowed), rendered inside our own app, so no third-party request reveals who is viewing. Presets and custom avatars are stored as a small settings object (style, seed, options), not as image files, so they cost no storage. Photos go through the image pipeline (type check, re-encode, metadata removed) and can be reported like any content.
- **Random mode:** avatars and names stay hidden ("Stranger") until both people agree to share profiles.

## D-024: Nicknames in chats; real name optional and private by default

- **Stage:** B (owner). **Status:** Accepted.
- **Decision:** everyone picks a **unique nickname** (used in chats and for @mentions; suggestions offered). A **real name is optional**. Each person chooses who can see their real name (nobody, contacts, everyone; default nobody) and what chats show (nickname, real name, or both; default nickname). The real name is only ever shown to people allowed to see it.
- **Replaces:** the earlier separate "display name" and "username" fields in `data-model.md`.

## D-025: Guests may use random mode

- **Stage:** B (owner). **Status:** Accepted.
- **Decision:** people without an account can use random mode through an anonymous guest session, with stricter limits (half the message rate), no contact exchange or profile sharing, and bans applied to the guest session and a hashed IP address. Guests are invited to create an account to keep a good contact.

---

## Stage C decisions

## D-026: Local PostgreSQL from the `embedded-postgres` npm packages

- **Stage:** C. **Status:** Accepted.
- **Decision:** `pnpm db:start` runs PostgreSQL 17.9 from the `@embedded-postgres/<platform>` npm packages (official PostgreSQL builds, about 100 MB for Windows), managed with `initdb` and `pg_ctl`. Data lives in `.cache/postgres/17/` on D:. The server listens on `127.0.0.1:54329` only, with "trust" authentication, so the local connection string contains no password.
- **Alternatives:** the EnterpriseDB Windows zip (about 300 MB, includes pgAdmin; a manual download with no lockfile); PGlite's socket server (one connection at a time, so the web app and realtime server would block each other); a free Neon development branch (needs the internet and an account).
- **Why:** installed through pnpm, so it stays on D:, follows the 3-day release rule and is pinned by the lockfile's integrity hashes. No administrator rights, no Windows service. CI uses a real PostgreSQL service container instead.
- **Windows detail:** `pg_ctl` passes every inheritable handle to the server it starts, which kept the caller's output pipe open forever. On Windows the script launches `pg_ctl` through PowerShell's `Start-Process` (ShellExecute, no inherited handles) and waits for `pg_ctl` alone.

## D-027: Time checks in queries use the database clock

- **Stage:** C. **Status:** Accepted.
- **Decision:** mute, ban and sanction checks compare against PostgreSQL's `now()`, not the app server's clock. Tests can pass a fixed instant.
- **Why:** found by running the test suite against real PostgreSQL. A sanction created a moment earlier looked "not started yet", because JavaScript dates have millisecond precision and PostgreSQL stores microseconds. The app server's clock (Render) and the database's (Neon) can also drift apart. One clock removes both problems.

## D-028: Schema details that differ from the Stage B data model

- **Stage:** C. **Status:** Accepted.
- **Real name stored as an empty string, not NULL:** Better Auth 1.7 requires its `name` column. An empty string means "no real name".
- **Case-insensitive uniqueness with `lower()` indexes instead of the `citext` extension:** unique indexes on `lower(nickname)` and `lower(slug)` give the same guarantee with no extension to install, so PGlite, local PostgreSQL and Neon behave identically. Better Auth already lower-cases emails.
- **Audit log (`moderation_action`) has no foreign keys,** and its trigger refuses UPDATE always, and DELETE only for rows younger than 365 days. A foreign-key action (`SET NULL`) would need an UPDATE, which an append-only table must refuse, and a log entry must outlive what it describes. The 365-day rule lets the daily retention job remove expired rows without weakening the guarantee for recent ones. TRUNCATE is refused too.
- **New table `auth_lockout`:** the per-account sign-in lockout from `security.md` 3.1, keyed by a hash of the email (no addresses stored).
- **Sequence numbers without gaps:** `sendMessage` locks the conversation row, checks for a re-sent client ID **before** taking a number, and rolls back on any refusal. A re-send or a refused message never uses up a number, so a gap in `eventSeq` always means a missed event.

## D-029: Extra sign-in protections on top of Better Auth's defaults

- **Stage:** C. **Status:** Accepted.
- **Login CSRF:** Better Auth checks a request's `Origin` only when it carries cookies. A cross-site page could therefore sign a visitor into an account the attacker controls. Every state-changing auth request is now refused when its `Origin` is not our own or the browser marks it `Sec-Fetch-Site: cross-site` (found by an integration test that expected 403 and got 200).
- **Endpoints switched off over HTTP:** profile, email and session changes go through our own validated server actions (which also disconnect live sockets), and provider access tokens are never handed to browsers (`/update-user`, `/update-session`, `/change-email`, `/delete-user`, `/revoke-session(s)`, `/revoke-other-sessions`, `/get-access-token`, `/refresh-token`, `/account-info`, `/verify-password`, `/token`).
- **Facebook and Microsoft never auto-link (D-022):** leaving them off `trustedProviders` is not enough, because Better Auth also links when the provider says the email is verified. Both providers' `mapProfileToUser` forces `emailVerified: false`; a stubbed OAuth round trip proves a Facebook sign-in with a "verified" matching email does not reach the existing account.
- **Breached-password check fails closed:** if Have I Been Pwned cannot be reached, sign-up with a password is refused with "try again later" (social sign-in still works). Safer than silently accepting unchecked passwords; revisit if it causes trouble.

## D-030: Dropping dead session cookies before sign-in (workaround for a Better Auth behaviour)

- **Stage:** C. **Status:** Accepted.
- **Problem:** found by the end-to-end test. A browser still holding the cookie of a session that ended (for example after a password reset elsewhere) signs in successfully, but Better Auth's guest (anonymous) plugin then looks the old session up, finds nothing, and appends "delete the session cookie" headers that cancel the fresh one. The person is silently signed out again.
- **Fix:** a `before` hook on session-starting paths removes a session cookie that no longer matches a live session from the request. A live guest cookie is kept, so upgrading a guest to a full account still works. Regression tests cover both.
- **Upstream:** worth reporting to Better Auth (1.7.6). Filing an issue needs the owner's GitHub account; the description is in `docs/development/steps/STEP-C-foundations.md`.

## D-031: Realtime server bundled into one file; small Docker images

- **Stage:** C. **Status:** Accepted.
- **Decision:** esbuild bundles the realtime server and all its dependencies into `dist/server.mjs` (3.3 MB). The image holds only Node.js 22 and that file, runs as the `node` user and receives SIGTERM directly. The web app also gets a Dockerfile (Next.js standalone output, switched on with `NEXT_OUTPUT=standalone`) as a portable alternative to Vercel (risk R1). Both are built and smoke-tested in CI only (no Docker on the laptop).

## D-032: Protocol refinements found while building

- **Stage:** C. **Status:** Accepted. `realtime-protocol.md` updated.
- `session:revoked` became **`session:ended`** with a reason (`revoked`, `banned`, `suspended`, `deleted`, `server_shutdown`, `abuse`) and an optional `reconnectAfterMs`, so one event covers revocation, sanctions, abuse and graceful shutdown.
- A new internal event, **`user.sessions_revoked`**, disconnects every socket of a person (password reset, "sign out everywhere").
- On connect the server also checks that the **session behind the token still exists**, so a token issued just before a sign-out cannot open a connection during its remaining minutes.
- The token endpoint answers with the realtime server's address as well as the token, so no server address is compiled into the browser bundle.

## D-033: Logs carry error names and codes only

- **Stage:** C. **Status:** Accepted.
- **Why:** database driver errors repeat the query's parameters, which for `message:send` include the message text. Handler failures log `{ name, code }` and nothing else; a test checks that a unique marker sent as a message never appears in the logs, and that no token does either.

## D-034: Smaller tooling choices in Stage C

- **Stage:** C. **Status:** Accepted.
- **`typedRoutes` off** in Next.js: route types exist only after a build, so plain type checks and lint disagreed with the build about the same code (a CI trap). Links are few and covered by end-to-end tests.
- **Per-device IP addresses in end-to-end tests:** every test and every extra "device" sends its own `X-Forwarded-For` from the documentation range 203.0.113.0/24; otherwise tests share one address and trip each other's sign-in rate limits, which work as designed.
- **`X-Forwarded-For` trust:** Vercel overwrites this header, so per-IP limits are reliable there. A self-hosted `next start` keeps whatever a visitor sends; `.env.example` says to put an overwriting proxy in front (the per-account lockout still applies).
- **Install scripts reviewed and allowed** for the `@embedded-postgres/<platform>` packages (identical symlink step in every package); esbuild's stays blocked.
- **Known advisory accepted:** `pnpm audit` reports one moderate issue in an old esbuild (≤0.24.2) used only by drizzle-kit's development loader. It concerns esbuild's local development server, which that loader never starts; nothing of it runs in production. CI fails only on high and critical advisories.
