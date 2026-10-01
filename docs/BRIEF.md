# SOCKETSPACE v2: MASTER BRIEF

Version 1.0. Prepared 2026-10-01 for the project owner (Jawad).
Once moved into the repository as `docs/BRIEF.md`, this file is the permanent source of truth. If anything conflicts with it, this brief wins unless the owner changes it; record changes in `docs/BRIEF_CHANGES.md`.

---

## 0. HOW TO RUN THIS BRIEF

### 0.1 Role and mission

Act as the lead engineer of a small professional product team: product design, architecture, backend, frontend, real-time systems, security, trust and safety, testing, DevOps, documentation and release.

SocketSpace v1 was a university mini project: a Next.js + Socket.IO chat page. Your mission is to build **SocketSpace v2, a production-grade real-time chat platform**, and deploy it live on free hosting tiers.

BUILD IT. This is an implementation task, not a proposal. Make reasonable decisions independently and keep going through implementation, testing, fixes, deployment and documentation.

### 0.2 Critical analysis first, and be willing to revamp

Before building, critically analyse v1 and this brief:
- Verify every v1 finding in section 2 against the code yourself. Add anything that was missed.
- Treat every technology suggested in this brief as a **default, not a mandate**. If you have a well-reasoned, better option (for reliability, cost on free tiers, security, scalability or developer experience), propose it with the trade-offs in Stage B. A complete revamp of the stack is acceptable.
- Never keep a v1 design just because it existed.

### 0.3 One brief, many sessions

- Maintain `CLAUDE.md` at the repo root: project summary, folder map, conventions, architecture rules, commands, and "read docs/BRIEF.md and PROGRESS.md before doing anything".
- Maintain `PROGRESS.md`: current stage, done, verified (with evidence), in progress, known problems, exact next step. Update it after every meaningful chunk of work and at the end of every stage.
- After context compaction or in a new session, re-read `CLAUDE.md`, `PROGRESS.md` and the requirements matrix before continuing.

### 0.4 Checkpoints and authorizations

There is exactly one mandatory approval stop: **after Stage B** (analysis, product design, architecture and plan), present a plan summary and wait for the owner's approval. After approval, continue without asking for routine decisions.

Standing authorizations (no need to ask):
- Create, edit, move and delete files inside `D:\mini project\socketspace\` only. Generated folders (`node_modules`, `.next`, build output, caches) may be deleted freely; they are regenerable.
- Install development tools and dependencies, keeping everything on the D: drive where the tools allow it.
- Commit and push to `https://github.com/jawadm3/SocketSpace.git` (branch `main`) after every milestone and at the end of every stage, without asking. Never force-push, never rewrite pushed history, never push secrets.
- Create and push git tags.

Things that require the owner:
- Creating accounts on any external service, and anything involving passwords, API keys or tokens. **You never create accounts, never handle secret values, and never read `.env` files.** Instead, give the owner an exact, step-by-step list: which service, which free plan, which setting, which environment variable name to create, and where to paste it (hosting dashboard or local `.env.local`). The owner does it and tells you when it is done.
- Spending money. Free tiers only. If a feature genuinely cannot work on any free tier, say so and propose an alternative.
- Anything outside the project folder.
- System changes on the laptop (for example installing WSL or Docker Desktop).

### 0.5 Parallel agents

Use parallel agents only for bounded, independent work, such as security review, accessibility audit, load-test analysis, documentation review and independent QA. Isolate parallel code edits in git worktrees; the main session owns integration. Describe agent reviews honestly as "a separate agent with an independent context, same underlying model".

---

## 1. REPOSITORY TRANSITION (STAGE A)

The owner wants v1 preserved in a `v1/` folder and v2 built at the repository root.

1. Confirm the working tree is clean and `main` matches `origin/main`.
2. Update the remote URL: the repo was renamed on GitHub, so set `origin` to `https://github.com/jawadm3/SocketSpace.git`.
3. Create an annotated tag `v1.0.0` on the current commit, describing it as the original mini-project version, and push the tag. Create a GitHub Release for it only if possible without new credentials; otherwise give the owner the steps.
4. Delete regenerable folders (`node_modules`, `.next`).
5. Use `git mv` to move all tracked v1 files into `v1/` so history follows them. Keep `LICENSE` at the root.
6. Add a short `v1/README_V1.md` explaining that this is the original version, how it differed, and that the `v1.0.0` tag is the canonical snapshot.
7. Exclude `v1/` from every v2 tool: workspace config, linting, type checking, tests, builds, Docker contexts and deployments.
8. Commit ("chore: move v1 into v1/ folder") and push.

---

## 2. V1 FINDINGS (VERIFY AND EXTEND)

- **The core claim is broken.** v1 advertises "anonymous 1-to-1 chat", but `server.js` uses `socket.broadcast.emit`, so every message goes to everyone connected. It is one global public room with no pairing.
- No identities, rooms, history or persistence.
- No message length limit, no rate limiting, no flood protection, no abuse controls (report, block, moderation).
- Hardcoded `localhost` URLs in the client and server CORS settings.
- The socket client is created twice (`src/lib/socket.ts` is unused; the chat page creates its own).
- The README references an `npm run server` script that does not exist, and states both Next.js 14 and 15.
- Two PostCSS configs; `<a href>` used instead of Next.js `Link` for internal navigation.
- No tests, no CI, never deployed.

---

## 3. PRODUCT: WHAT V2 IS

A real-time chat platform with two modes.

### 3.1 Community mode (the main product)

- Accounts: sign-up, sign-in, sign-out, email verification, password reset, optional sign-in with GitHub and/or Google if achievable on free tiers.
- Profiles: display name, avatar, short bio, online status.
- Rooms (channels): public and private, create, join, leave, invite, roles (owner, moderator, member).
- Direct messages: one-to-one conversations.
- Messaging: send, edit, delete, replies or threads, emoji reactions, @mentions, markdown-lite formatting, link previews (server-side and safe), image sharing with strict validation.
- Real-time features: presence, typing indicators, read receipts or unread counts, delivery state, live updates across tabs and devices.
- History: persisted messages, infinite scroll with pagination, search.
- Notifications: in-app notifications for mentions and DMs; browser notifications optional.
- Reconnection: offline/online handling, automatic reconnect, resync of missed messages, no duplicate or lost messages.

### 3.2 Random-match mode (the original idea, done safely)

An optional "talk to someone new" mode inside the platform:
- Text only (no images, files or links in this mode).
- **18+ gate:** clear age confirmation and terms acknowledgement before first use.
- Matching by optional interest tags, with a fallback to random.
- Skip/next, end chat, report, block.
- Strict rate limits, cooldowns after reports, automatic timeouts for abuse.
- Content filtering (see section 5).
- Conversations are ephemeral by default; keep only the minimum metadata needed for safety reports, with a documented retention period.
- Users who are signed in can choose to share their profile or add the other person as a contact only if both agree.
- Video and voice are **out of scope** for v2; list them as future improvements.
- **Product note:** random-discovery products (StumbleUpon-style sites, random-chat apps) historically struggle with retention because the novelty fades. Treat random mode as an entry point into the community: design a natural path from a good random conversation to adding a contact or joining a room, and measure that path with privacy-respecting aggregate counts only.

### 3.3 Administration

- An admin/moderator dashboard: review reports, view flagged content, warn, mute, suspend or ban users, remove messages, audit log of moderator actions.

---

## 4. ARCHITECTURE AND STACK (DEFAULTS, OPEN TO CHALLENGE)

Suggested defaults; verify current versions, compatibility and **current free-tier limits** from official sources before committing:

- **Monorepo:** pnpm workspaces with Turborepo (`apps/web`, `apps/realtime`, `packages/db`, `packages/shared`, `packages/ui`, `packages/config`).
- **Web app:** current stable Next.js (App Router) with TypeScript in strict mode, Tailwind CSS, shadcn/ui, accessible components.
- **Real-time server:** a dedicated long-running Node.js service (Socket.IO or an equally robust alternative), because serverless platforms do not keep WebSocket servers alive. Design for horizontal scaling (a pub/sub adapter) even if one instance runs on the free tier.
- **Shared contracts:** one typed definition of every real-time event and API payload (for example Zod schemas in `packages/shared`), validated on both ends.
- **Database:** PostgreSQL with a typed ORM/query builder (Prisma or Drizzle) and migrations.
- **Cache/pub-sub/presence:** Redis, or a Postgres-based alternative (for example LISTEN/NOTIFY adapter) if free-tier Redis command limits make Redis unsuitable. Decide with numbers.
- **Auth:** a maintained, self-hosted auth library (for example Better Auth or Auth.js) with secure sessions, CSRF protection, email verification and password reset.
- **Email:** a transactional email service with a free tier (for example Resend).
- **File storage:** an S3-compatible free tier (for example Cloudflare R2) with signed uploads, size and type limits, image re-encoding and metadata (EXIF) stripping.
- **Hosting (free tiers):** web app on Vercel; real-time server on a free host that supports WebSockets (evaluate options such as Render; document cold-start behaviour honestly); managed Postgres (for example Neon); managed Redis if used (for example Upstash).
- **Optional AI moderation:** see section 5.3.

### Development machine constraints

- Windows 11 Home laptop: Ryzen 5 5600H (6 cores/12 threads), about 7.35 GB usable RAM, NVIDIA GTX 1650.
- **WSL and Docker Desktop are not installed.** Local development must not require Docker. Options: in-process test databases (for example PGlite), native installs on the D: drive, or free-tier cloud development databases. Dockerfiles must still exist and be built and tested in CI (GitHub Actions).
- Keep everything on the D: drive where tools allow (package-manager store and caches included). List unavoidable exceptions in `docs/technical/storage.md`.
- Limit heavy concurrent processes because of RAM.

---

## 5. TRUST, SAFETY AND SECURITY

### 5.1 Security baseline

Meet the intent of OWASP ASVS Level 2 for the relevant areas. At minimum:
- Validate every input on the server (HTTP and socket events), with size limits.
- Authenticate and authorise every socket connection and event (room membership checks on every message).
- Rate limits per user and per IP for HTTP and socket events; flood protection.
- Secure session cookies, CSRF protection, strict CORS from configuration (never hardcoded localhost), security headers and a Content Security Policy.
- Safe rendering of user content (no raw HTML injection); safe link previews (no server-side request forgery).
- Secrets only in environment variables; `.env*` files git-ignored; an `.env.example` with names and descriptions but no values.
- Secret scanning (for example gitleaks) in a pre-commit hook and in CI; dependency auditing; GitHub CodeQL (free for public repositories).
- Structured logs that never contain passwords, tokens, message contents in random mode, or personal data beyond what is needed.

### 5.2 Safety features

- Report and block everywhere; blocked users cannot contact the blocker.
- Moderation queue and actions (section 3.3).
- A word-list based content filter as a baseline, with severity levels.
- Clear Terms of Use, Privacy Policy and Community Guidelines pages, written in plain language, appropriate for the UK and the EU (data rights, retention, contact for abuse). State honestly that they are templates and not legal advice.
- Account deletion and data export (GDPR-style) in settings.

### 5.3 Optional AI moderation (open models)

Build a provider-agnostic AI moderation module behind a feature flag, **off by default**:
- Use an OpenAI-compatible interface so the provider can be swapped by configuration: a free hosted open-model API (for example Groq or OpenRouter running Llama, Qwen or Kimi models) or another free provider. Do not use Ollama or other local models (the owner does not want them installed); use a mock provider for tests.
- Only send the minimum text needed for classification, never account details.
- Respect free-tier rate limits; cache and degrade gracefully to the word-list filter if the provider is unavailable.
- Check and document each provider's data-retention and training policy before recommending it.

---

## 6. FRONTEND, DESIGN AND MOTION

The owner wants a genuinely impressive frontend.

### 6.1 Visual direction

- Build a design system first: tokens for colour, typography, spacing, radius, elevation and motion; light and dark themes; one consistent icon set (for example Lucide).
- Study, but never copy, best-in-class product UIs such as Discord, Slack, Linear, Telegram Web and Vercel for layout, density and interaction patterns. No third-party branding, logos or copied assets.
- In Stage B, present 2 to 3 distinct visual directions (palette, typography, mood and a hero concept for the home page), each with a rendered mockup or screenshot, and let the owner choose.

### 6.2 Animated home page

- A memorable animated landing page. Default approach: a WebGL hero built with Three.js through React Three Fiber (and drei), for example an interactive constellation of glowing nodes with messages travelling between them that reacts to the cursor, combined with scroll-driven section animations (Motion or GSAP ScrollTrigger) and tasteful micro-interactions.
- Choose the lightest tool that achieves the effect. If a canvas, SVG or CSS animation gives the same impact at a fraction of the cost, prefer it and justify the choice.
- Performance and accessibility rules:
  - Load 3D code lazily after first paint (dynamic import, client only); pause rendering when off-screen or when the tab is hidden; cap the device pixel ratio.
  - Respect `prefers-reduced-motion` with a static but still attractive fallback, and provide a fallback when WebGL is unavailable or the device is low-power.
  - Keep the home page fast: record Largest Contentful Paint, Total Blocking Time and Lighthouse scores for desktop and mobile emulation, and keep LCP under about 2.5 seconds on the development laptop.
- Heavy animation belongs on marketing pages only. Inside the app, motion is subtle and fast (about 150 to 250 ms) and never slows down chatting.

### 6.3 Visual QA

- Capture screenshots of every key screen at mobile, tablet and desktop widths in light and dark themes, inspect them, and fix layout problems.
- Add visual regression tests for key screens.
- Run a design and UX review with an independent agent before release.

---

## 7. QUALITY BAR: WHAT "PRODUCTION LEVEL" MEANS HERE

- **Testing:** unit and integration tests (for example Vitest), real-time tests with multiple simulated clients, end-to-end tests (for example Playwright) in which two browser users chat, reconnect, edit, react and moderate. Aim for meaningful coverage of business logic (target about 80 percent for `packages/shared`, `packages/db` and the realtime handlers) rather than vanity numbers.
- **Load testing:** a reproducible load test (for example k6 or Artillery) with concurrent socket connections and message throughput. Run what the laptop can handle, record the hardware, and report real numbers only. Document the free-tier deployment's measured limits separately.
- **CI (GitHub Actions):** lint, type-check, unit and integration tests, end-to-end tests, build, Docker image build, secret scan, dependency audit. The `main` branch must stay green.
- **Accessibility:** WCAG 2.2 AA intent: keyboard navigation, screen-reader labels, focus management, live regions for new messages, colour contrast, reduced motion.
- **Performance:** Lighthouse scores recorded for key pages; fast first load; efficient message list rendering (virtualisation for long histories).
- **Observability:** structured logging, health and readiness endpoints, error tracking (for example Sentry free tier, optional), basic metrics (connections, messages per second, errors).
- **Reliability:** graceful shutdown, reconnection with message resync, idempotent message sending (client-generated IDs), database migrations that run safely.
- **UX:** responsive (mobile and desktop), light and dark themes, empty, loading and error states everywhere, optimistic sending with clear failure handling.
- **Versioning:** semantic versioning, `CHANGELOG.md`, conventional commits, a `v2.0.0` tag and GitHub Release at the end.

---

## 8. DEPLOYMENT (FREE TIERS)

- Produce a deployment guide and configuration for every service.
- At the right stage, give the owner a single checklist: accounts to create, free plans to choose, settings to change, environment variables to set and where. Wait for the owner to confirm, then continue.
- After deployment, run smoke tests against the live URLs (sign-up, verify email, chat between two users, random mode, moderation) and record results.
- Document free-tier limitations honestly (cold starts, connection limits, monthly quotas) in the README and docs.
- Provide a seeded demo setup (demo rooms and content) for portfolio visitors, without real personal data.

---

## 9. DOCUMENTATION AND LOGGING (PLAIN LANGUAGE)

The owner wants documentation a non-specialist can understand. Length is fine; unclear writing is not.

- Plain English, short sentences, every technical term explained with an everyday example, plus `docs/glossary.md`.
- **Step logs:** for every stage, `docs/development/steps/STEP-<letter>-<name>.md`: goal, what was built and how it works, decisions and why (also in `docs/development/decisions.md`), problems and fixes, tests run with actual results, what comes next.
- **Code walkthrough:** `docs/code_walkthrough/` explains every source file in plain language; every important function (auth, socket event handling, matching, moderation, message persistence, reconnection) gets a line-by-line walkthrough.
- **Architecture docs** with diagrams (Mermaid is fine): system overview, real-time message flow, random-match flow, moderation flow, data model.
- **README.md** for GitHub: what SocketSpace is, live demo link, screenshots of the real app, features, tech stack, architecture diagram, local setup, deployment, testing, security notes, honest limitations, v1 vs v2 comparison, license.
- Never invent test results, measurements, users or history.

---

## 10. STAGES

A. Inspect the environment and toolchain; perform the repository transition (section 1); set up `CLAUDE.md`, `PROGRESS.md` and the monorepo skeleton.
B. Critical analysis of v1 and this brief; product design (screens, flows), architecture, data model, event contracts, security and safety design, free-tier research with numbers, requirements matrix (`qa/requirements_matrix.md`) and acceptance criteria. **Stop for the owner's approval.**
C. Foundations: database and migrations, auth, shared contracts, real-time server with authenticated connections, CI pipeline.
D. Community mode: rooms, DMs, messaging features, presence, history, search, notifications, uploads.
E. Random-match mode and safety: matching, gates, filters, reports, blocks, moderation dashboard, optional AI moderation module.
F. Animated home page, design-system polish (section 6), accessibility, performance, responsive design, themes.
G. Testing completion: end-to-end suites, load tests, security review (an independent agent), accessibility audit.
H. Deployment to free tiers with the owner's account checklist; live smoke tests.
I. Documentation, code walkthrough, README with real screenshots, `v2.0.0` tag and release.

At the end of every stage: update `PROGRESS.md`, write the step log, update the requirements matrix, commit and push.

---

## 11. DEFINITION OF DONE

- Every feature in section 3 works end to end and is covered by tests.
- Security and safety measures in section 5 are implemented and verified; the security review findings are fixed or documented.
- CI is green on `main`.
- The app is deployed and live smoke tests pass, with honest notes on free-tier limits.
- Load-test, Lighthouse and accessibility results are recorded with real numbers.
- Documentation, step logs, code walkthrough and README are complete and match the shipped product.
- `v1/` is preserved and excluded from v2 tooling; `v1.0.0` and `v2.0.0` tags exist.
- No secret has ever been committed (secret scan of the full history passes).

If a genuine limitation blocks something, finish everything else, state the exact limitation and what is needed. Never claim something works without evidence.

## 12. BEGIN

Begin with Stage A, then complete Stage B and stop for approval. After approval, continue until everything in the definition of done is achieved.
