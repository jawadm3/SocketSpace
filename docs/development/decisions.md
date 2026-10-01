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
