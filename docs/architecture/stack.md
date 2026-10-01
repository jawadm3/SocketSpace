# Technology stack

_Stage B, 2026-10-01. Status: **Accepted by the owner on 2026-10-01** (decisions D-009 to D-025 in
`docs/development/decisions.md`). Versions are the newest releases that are at least 3 days old (our
supply-chain rule), checked on the npm registry on 2026-10-01._

The brief lists defaults and invites better options. For each layer: what we pick, what else we
considered, and why. Where the brief's default is kept, we say why it is still the best choice.

## Summary table

| Layer                  | Choice                                                                                                                                                                                                     | Brief default?                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Monorepo               | pnpm 12 workspaces + Turborepo 2                                                                                                                                                                           | Yes                                                   |
| Language               | TypeScript 6.0 (strict), Node.js 22 LTS                                                                                                                                                                    | Yes (version pinned, see D-004)                       |
| Web app                | Next.js 16 (App Router, Turbopack), React 19                                                                                                                                                               | Yes                                                   |
| Styling and components | Tailwind CSS 4, shadcn/ui (Radix primitives), Lucide icons                                                                                                                                                 | Yes                                                   |
| Themes                 | Three themes (Airmail default, Signal, Aurora) × light/dark, as CSS custom-property token sets switched by `data-theme` and `data-mode`; saved per account and in a cookie for flash-free server rendering | New (owner)                                           |
| Avatars                | DiceBear (MIT library) with CC0 styles only, rendered locally from a saved config; optional photo upload through the image pipeline                                                                        | New (owner)                                           |
| In-app motion          | Motion (formerly Framer Motion), CSS transitions                                                                                                                                                           | Yes                                                   |
| Home-page hero         | **Canvas 2D** (hand-written, about 3 to 6 KB), lazy-loaded; Three.js / React Three Fiber only if a measured prototype proves Canvas cannot reach the chosen design                                         | **Changed** (lighter tool, as the brief allows)       |
| Real-time server       | Node.js 22 + Socket.IO 4.8, Docker                                                                                                                                                                         | Yes                                                   |
| Shared contracts       | Zod 4 schemas in `packages/shared`                                                                                                                                                                         | Yes                                                   |
| Database               | PostgreSQL 17 on Neon + Drizzle ORM 0.45 + drizzle-kit migrations                                                                                                                                          | Yes (Drizzle chosen over Prisma)                      |
| Cache / pub-sub        | **None on the free deployment**; Socket.IO Redis adapter switched on by `REDIS_URL`                                                                                                                        | **Changed** (decided with numbers)                    |
| Auth                   | Better Auth 1.7: email + password, verification, reset, passkeys; Google, Facebook, GitHub first, then Discord, Microsoft, LinkedIn; anonymous guests for random mode; JWT plugin for realtime tokens      | Yes                                                   |
| Email                  | Resend with a free is-a.dev subdomain (owner choice); Nodemailer SMTP fallback; local mail catcher in development                                                                                          | Yes, with a domain caveat                             |
| File storage           | **Vercel Blob** by default behind a driver interface (R2/S3 and local drivers too); sharp for re-encoding                                                                                                  | **Changed** (R2 needs a card)                         |
| Search                 | PostgreSQL full-text search (tsvector + GIN index)                                                                                                                                                         | New (no extra service)                                |
| AI moderation          | OpenAI-compatible client; Groq by default; mock provider for tests; off by default                                                                                                                         | Yes                                                   |
| Logging and metrics    | pino (structured JSON, redaction), Prometheus-format `/metrics`, optional Sentry                                                                                                                           | Yes                                                   |
| Unit/integration tests | Vitest 5, PGlite, real Socket.IO clients                                                                                                                                                                   | Yes                                                   |
| End-to-end tests       | Playwright 1.63 (two browser users)                                                                                                                                                                        | Yes                                                   |
| Load tests             | A Node.js harness using `socket.io-client` (speaks the real protocol), with Artillery as an alternative                                                                                                    | Changed (k6 needs extra work for Socket.IO's framing) |
| CI                     | GitHub Actions: lint, types, tests, e2e, build, Docker build and smoke test, gitleaks, `pnpm audit`, CodeQL                                                                                                | Yes                                                   |
| Hosting                | Vercel Hobby (web), Render Free (realtime, Docker), Neon Free (Postgres), UptimeRobot (keep-awake)                                                                                                         | Yes (Render confirmed with numbers)                   |

## Layer by layer

### Monorepo: pnpm + Turborepo (kept)

- **Why:** pnpm is fast and strict (packages cannot use dependencies they did not declare); its
  store is set up on D:. Turborepo runs tasks in dependency order and caches results. Both are
  already installed and working (Stage A).
- **Considered:** Nx (more powerful, heavier, more configuration); npm workspaces (no task runner).

### Web app: Next.js 16 (kept)

- **Why:** server components let pages read from the database without a separate API for every
  screen; mature routing; first-class on Vercel. Version 16 makes Turbopack the default and removes
  `next lint` (we use ESLint directly, already set up). Request interception now lives in
  `proxy.ts` (formerly `middleware.ts`).
- **Considered:** Remix/React Router 7 (good, but weaker Vercel integration); a plain Vite SPA
  (would need a separate API server for auth and SEO pages).

### Real-time server: Node.js + Socket.IO (kept, after a real challenge)

- **Why:** Socket.IO gives acknowledgements (the server confirms each message), rooms, automatic
  reconnection with back-off, connection-state recovery for short drops, and a long-polling fallback
  for networks that block WebSockets. It is portable: the same Docker image runs locally, in CI,
  and on any host.
- **Considered:**
  - _Cloudflare Durable Objects:_ no cold start, but hard daily free limits (one busy object uses
    83% of the daily allowance), vendor lock-in, and our own protocol to write. Kept as the
    documented fallback. Numbers in `docs/research/free-tier-research.md` section 2.
  - _Raw `ws` / uWebSockets.js:_ faster, but we would rebuild acknowledgements, rooms and
    reconnection ourselves.
  - _Managed services (Ably, Pusher, Supabase Realtime):_ less to build, but connection caps on
    free plans, an extra vendor for every message, and far less to show as engineering work.

### Database: PostgreSQL on Neon with Drizzle (Drizzle chosen over Prisma)

- **Why Postgres:** relational data (users, rooms, members, messages, reports) with strict
  integrity; built-in full-text search; mature.
- **Why Drizzle over Prisma:** Drizzle is a thin TypeScript layer that looks like SQL, has no
  separate engine process, works in serverless functions, in the Node server and with PGlite in
  tests (one code path everywhere), and Better Auth supports it directly. Prisma's current stable
  line (7.x) is good too, but its `latest` tag on npm currently points at a release candidate
  (8.0.0-rc.19), and Drizzle's smaller runtime suits Vercel's CPU allowance.
- **Migrations:** generated SQL files reviewed in pull requests; applied by a CI/deploy step,
  never automatically by app start-up. Only additive changes in a single release ("expand, then
  contract") so the old and new app versions can run side by side during a deploy.

### Cache / pub-sub: no Redis on the free tier (changed, decided with numbers)

Upstash Free allows about 16,100 commands per day: six users' presence heartbeats alone would use
it up. Postgres LISTEN/NOTIFY would keep Neon awake 24/7 (186% of the compute budget). With one
instance, in-memory is correct. Multi-instance support is built and tested in CI with Redis, and
switched on by one environment variable. Details: research doc section 4.

### Auth: Better Auth (kept)

- **Why:** self-hosted (user data stays in our database), maintained, supports Drizzle,
  email/password with verification and reset, social sign-in, database sessions, built-in rate
  limiting (stricter on sign-in: 3 attempts per 10 seconds by default), an anonymous-session plugin
  (for guests in random mode, approved in D-025) and a JWT plugin (signed short-lived tokens for the
  realtime server). The Auth.js project is now maintained by the Better Auth team, so this is also
  the "Auth.js" path.
- **How the realtime server trusts users:** the web app and the realtime server live on different
  domains (for example `socketspace.vercel.app` and `socketspace-rt.onrender.com`), so browser
  cookies cannot be shared safely. The web app issues a **signed token valid for 5 minutes**; the
  browser hands it to the realtime server when connecting; the server checks the signature using
  the web app's public key (JWKS). Details in `docs/architecture/security.md`.

### Email: Resend with a free is-a.dev subdomain (owner choice)

Resend only emails people other than the account owner after a domain is verified. The owner chose a
free `is-a.dev` subdomain (requested through a GitHub pull request; exact steps come with the Stage H
checklist). See research doc section 5.

### Themes, avatars and names (owner additions)

- **Themes (D-021):** each theme is a set of design tokens (colours, fonts, radii, shadows, motion).
  Switching changes two attributes on the page, so there is no re-render cost. Only the active
  theme's web fonts and hero script are loaded.
- **Avatars (D-023):** DiceBear's library (MIT) generates SVG avatars from a small settings object.
  Only CC0 styles are used (no attribution required). Rendering happens in our app, so no
  third-party service sees who looks at which profile.
- **Names (D-024):** a unique nickname plus an optional real name with its own visibility setting.
  The server decides per viewer which name to send, so a hidden real name never reaches a browser
  that may not show it.

### File storage: Vercel Blob (changed)

R2 has the best free numbers but requires a payment card to enable. Vercel Blob is free on Hobby
with no card, in the same account as the web app. A driver interface keeps R2 (or any S3-compatible
store) one configuration change away. Every image is decoded and re-encoded with **sharp** (strips
EXIF/location metadata, defeats "polyglot" files), with size and pixel limits.

### Home-page hero: Canvas 2D first (changed, as the brief allows)

The brief's example effect (a constellation of glowing nodes with messages travelling between
them, reacting to the cursor) is a 2D effect. Three.js + React Three Fiber + drei add roughly
150 to 250 KB of compressed JavaScript; a hand-written Canvas 2D version is a few kilobytes. The
visual-direction mockups in this stage already include working Canvas prototypes. In Stage F, the
chosen direction is built in Canvas first and measured (LCP, TBT, bundle size). If the chosen
direction genuinely needs 3D depth, a lazy-loaded React Three Fiber version is built and both are
measured; the lighter one that achieves the look wins. All rules from the brief apply either way:
loaded after first paint, paused off-screen and in hidden tabs, capped pixel ratio, static
fallback for reduced motion and no-WebGL/low-power devices.

### Load testing: Node harness (changed)

k6 supports raw WebSockets but not Socket.IO's packet framing without hand-written encoding.
A small Node.js script using the real `socket.io-client` (in worker threads) measures exactly what
users experience. Artillery (which has a Socket.IO engine) is the alternative if the harness proves
limiting.

## What is deliberately not used

- **Docker for local development:** not installed on the laptop. Dockerfiles are built and tested
  in CI only.
- **Ollama / local AI models:** the owner does not want them.
- **Paid tiers of anything.**
