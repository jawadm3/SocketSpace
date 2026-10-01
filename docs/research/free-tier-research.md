# Free-tier research (with numbers)

_Researched 2026-10-01 from official pricing and documentation pages. Free tiers change often:
re-check every number in Stage H before deploying. "Card" means the provider asks for a payment
card even on the free plan (usually a small temporary hold, not a charge). The brief allows free
tiers only; a card on file is not spending, but it is the owner's choice, so card-requiring
options are marked._

## 1. The short answer

| Job                                      | Recommended free service                                  | Key limits that shape the design                                                                                                            | Card?                             |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Web app (Next.js)                        | **Vercel Hobby**                                          | 1M function invocations, 4 active CPU-hours, 100 GB transfer per month; **personal, non-commercial use only**                               | No                                |
| Real-time server (Node.js, long-running) | **Render Free web service**                               | 512 MB RAM, 0.1 CPU; **sleeps after 15 min without inbound traffic, ~1 min to wake**; 750 instance-hours per month; may restart at any time | Sometimes asked, for verification |
| Keep-awake pinger                        | **UptimeRobot Free**                                      | 50 monitors, 5-minute interval                                                                                                              | No                                |
| PostgreSQL                               | **Neon Free**                                             | 100 CU-hours compute and 0.5 GB storage per project; scales to zero after 5 min; wakes in "a few hundred milliseconds"                      | No                                |
| Redis                                    | **None by default** (Upstash Free available as an option) | Upstash: 500K commands per month: too few for real-time traffic (see 4.4)                                                                   | No                                |
| Email                                    | **Resend Free + a verified domain**                       | 3,000 per month, 100 per day; **must verify a domain** to email anyone except the account owner                                             | No                                |
| Image storage                            | **Vercel Blob (Hobby)**                                   | 1 GB stored, 2,000 uploads ("advanced operations"), 10,000 reads, 10 GB transfer per month                                                  | No                                |
| AI moderation (optional, off by default) | **Groq Free**                                             | `openai/gpt-oss-safeguard-20b`: 30 requests/min, 1,000/day, 8K tokens/min, 200K tokens/day                                                  | No                                |
| Error tracking (optional)                | **Sentry Developer**                                      | 5,000 errors per month, 1 user, 30-day history                                                                                              | No                                |
| CI, CodeQL                               | **GitHub Actions** (repository is public)                 | Free on standard runners for public repositories                                                                                            | No                                |

## 2. Hosting the real-time server: the hardest choice

A chat server must keep thousands of connections open for hours. Ordinary "serverless"
functions (Vercel, Netlify) stop after each request, so they cannot do this. We need either a
long-running server or a platform built for long-lived connections.

| Option                                   | Free allowance                                                                                                              | Sleeps?                                              | Card?                                 | Verdict                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Render Free**                          | 512 MB, 0.1 CPU, 750 h/month                                                                                                | After 15 min without inbound traffic; ~1 min to wake | Sometimes, for verification ($1 hold) | **Recommended.** Runs our Docker image unchanged. The sleep can be avoided with a 5-minute pinger.            |
| Koyeb Free                               | 512 MB, 0.1 vCPU, 2 GB disk; one per organisation; Frankfurt or Washington                                                  | After 1 h without traffic                            | **Yes** ($29 temporary hold)          | Good backup if the owner accepts a card.                                                                      |
| Railway Free                             | $1 of usage credit per month; 1 vCPU / 0.5 GB cap                                                                           | No (billed per second of use)                        | No                                    | $1 is roughly what a tiny idle Node process costs per month; any traffic spike would exhaust it. Too fragile. |
| Northflank Sandbox                       | 2 always-on services, 1 database                                                                                            | No                                                   | **Yes** (required for all plans)      | Good, but card required.                                                                                      |
| Fly.io                                   | Trial only                                                                                                                  | n/a                                                  | **Yes**                               | Not a free tier.                                                                                              |
| **Cloudflare Workers + Durable Objects** | 100,000 requests/day; 13,000 GB-s/day; incoming WebSocket messages billed 20:1; SQLite storage 5 GB, 100,000 row writes/day | Objects hibernate when idle and wake in milliseconds | No                                    | **Strong alternative** (see below). Not chosen as the default.                                                |

### Render maths

- A 31-day month has 744 hours. Render gives 750 free instance-hours per workspace. So **one**
  service can stay awake all month, but only if nothing else in the workspace uses free hours.
- To stay awake it needs inbound traffic at least every 15 minutes. UptimeRobot's free plan checks
  every 5 minutes. The ping hits `/healthz`, which **never touches the database** (see 3.2).
- Render "might restart a Free web service at any time". Every restart drops all connections.
  Clients reconnect automatically and resynchronise (this is required anyway, see
  `docs/architecture/realtime-protocol.md`).
- 0.1 CPU is one tenth of one processor core. Real throughput will be measured in Stage G and
  reported honestly.

### Why not Cloudflare Durable Objects by default?

Durable Objects (DOs) are tiny always-addressable servers that can hold WebSockets and
"hibernate" when idle, so there is no one-minute cold start. They are a genuinely good fit, and
the brief invites alternatives, so here are the numbers:

- One continuously busy DO is billed at 128 MB for every awake second:
  86,400 s × 0.125 GB = **10,800 GB-s per day, which is 83% of the 13,000 GB-s daily free allowance.**
  A second busy object (for example the random-match queue) would exceed it.
- Free-plan limits are **hard daily cut-offs**: when exceeded, requests fail until the next day.
  On Render, the same overload just makes the server slower.
- DOs cannot run Socket.IO. We would write our own protocol (acknowledgements, heartbeats,
  reconnection), and our Docker image would not be what runs in production. The brief requires
  Dockerfiles that are built and tested in CI; with DOs, the realtime Dockerfile would be
  decorative.
- It ties the real-time layer to one vendor.

**Decision (proposed):** Node.js + Socket.IO in Docker on Render Free, kept awake by a pinger. The
same image runs on Koyeb, Northflank, Railway, Fly.io or any server, so moving later is a
configuration change, not a rewrite. Cloudflare DOs are recorded as the best alternative if Render's
free tier changes.

## 3. Database: PostgreSQL

| Option               | Storage                                                | Compute                                                    | Sleeps?                                                          | Card?     | Verdict                                                                           |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| **Neon Free**        | 0.5 GB per project (hard cap: writes blocked above it) | 100 CU-hours per project per month, autoscaling up to 2 CU | After 5 min idle (cannot be disabled); wakes in a few hundred ms | No        | **Recommended.** Permanent free plan, branching for previews, connection pooling. |
| Render Free Postgres | 1 GB                                                   | n/a                                                        | n/a                                                              | Sometimes | **Expires 30 days after creation.** Unusable for a live demo.                     |
| Koyeb Free Postgres  | 1 GB                                                   | 5 active hours per month                                   | Yes                                                              | Yes       | Far too little compute.                                                           |
| Supabase Free        | 500 MB                                                 | shared                                                     | **Pauses after 1 week of inactivity; must be restored manually** | No        | A portfolio demo that goes offline after a quiet week is not acceptable.          |

### 3.1 Neon compute maths

- A "CU" (compute unit) is roughly 1 vCPU with 4 GB RAM. The smallest size is 0.25 CU.
- **Always-on at 0.25 CU = 0.25 × 744 h = 186 CU-hours per month = 186% of the free 100.**
  The free compute would run out after 100 ÷ 0.25 = 400 hours, about **16.7 days**.
- Neon's documentation says a compute **will not suspend while connections are open**. So any
  design that holds a database connection open permanently burns the budget.

### 3.2 Design rules that follow from this

1. **No Postgres LISTEN/NOTIFY** for real-time fan-out (the brief's suggested "Postgres-based
   alternative" to Redis). It needs a permanently open connection: 186% of the budget.
2. Database connection pools close idle connections after at most 60 seconds.
3. The keep-awake ping (`/healthz`) must not touch the database. Only `/readyz` checks the
   database, and nothing polls it frequently.
4. Budget for awake time: 400 hours per month at 0.25 CU, about 12.9 hours per day. A demo with
   bursts of activity fits comfortably.

### 3.3 Storage maths

A message row with its indexes and full-text search data is estimated at about 1 KB (to be
measured in Stage D). 0.5 GB therefore holds roughly 400,000 to 500,000 messages, plenty for a
demo. The demo seed data stays small, and storage use is shown on the admin dashboard.

### 3.4 Local development without Docker

- **Tests:** PGlite (`@electric-sql/pglite` 0.5.x): real Postgres compiled to WebAssembly,
  running inside the test process. No install needed.
- **Running the apps locally:** portable PostgreSQL binaries unpacked under
  `.cache/tools/` on D: (no administrator rights, no Windows service), started and stopped by a
  `pnpm db:start` / `pnpm db:stop` script. Fallback: a free Neon development branch.
- **CI:** a real PostgreSQL service container in GitHub Actions.

## 4. Cache, pub/sub and presence: do we need Redis?

### 4.1 What Redis would be for

- **Fan-out between several server instances** (Socket.IO's Redis adapter).
- **Shared rate-limit counters and presence** across instances.

### 4.2 We run one instance on the free tier

Render Free does not scale beyond one instance. With one instance, the in-memory Socket.IO adapter,
in-memory rate limiters and in-memory presence are correct and fastest.

### 4.3 Postgres as the pub/sub alternative

Rejected by the numbers in 3.1: LISTEN/NOTIFY keeps Neon awake 24/7 (186% of the compute budget).

### 4.4 Upstash Redis maths

- Free: **500,000 commands per month**, 256 MB, 10 GB bandwidth, up to 10 databases.
- 500,000 ÷ 31 days = **about 16,100 commands per day**, or 0.19 per second on average.
- Presence alone, refreshed every 30 seconds per online user, costs 2,880 commands per user per day.
  **Six people online all day would use the entire budget.** Each broadcast message is at least one
  more command, and each rate-limit check one or two more.

### 4.5 Decision (proposed)

No Redis on the free deployment. The realtime server is written so that horizontal scaling is a
configuration change: setting `REDIS_URL` switches on the Socket.IO Redis adapter. CI proves it
works by running **two** realtime instances with a Redis service container and checking that a
message sent through one instance reaches a client on the other. HTTP rate limits on Vercel (many
short-lived instances) are stored in Postgres, which those requests use anyway.

## 5. Email (verification and password reset)

| Option     | Free allowance                  | Catch                                                                                                                                                                       |
| ---------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resend** | 3,000/month, 100/day, 3 domains | **A verified domain is required** to send to anyone other than the account owner.                                                                                           |
| Brevo      | 300/day                         | Without an authenticated domain (DKIM and DMARC), mail sent "from" a Gmail address will likely land in spam, per Brevo's own guidance on the 2024 Gmail/Yahoo sender rules. |
| Gmail SMTP | about 500/day                   | Needs a dedicated Gmail account with an app password (a secret the owner creates). Uses the owner's Google account for a public app.                                        |

**There is no reliable free email without a domain.** Options for the owner (decision needed):

1. **Free subdomain from is-a.dev** (registered by a GitHub pull request; supports the MX and TXT
   records Resend needs). Then use Resend. _Recommended if the owner has no domain._
2. A domain the owner already owns, or buys (about the price of a meal per year: not free).
3. Fallback: a dedicated Gmail account with an app password, sent with Nodemailer from the web app.

Whatever is chosen, development uses a local "mail catcher" that writes emails to
`.cache/mail/` so no real email is ever sent from a laptop. The portfolio demo also offers GitHub
sign-in and pre-verified demo accounts, so visitors can try it without waiting for an email.

## 6. File (image) storage

| Option                  | Free allowance                                                                                                                                                          | Card?                                          | Verdict                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| **Vercel Blob (Hobby)** | 1 GB stored, 2,000 advanced operations (uploads), 10,000 simple operations, 10 GB transfer per month; usage above the limit **blocks Blob for 30 days** (never charges) | No                                             | **Recommended.** Same account as the web app.                       |
| Cloudflare R2           | 10 GB, 1M writes, 10M reads per month, free egress                                                                                                                      | **Yes** (payment method required to enable R2) | Best numbers, but needs a card. Supported as an alternative driver. |
| Supabase Storage        | 1 GB                                                                                                                                                                    | No                                             | Pauses with the project after a quiet week.                         |

Maths: each image is stored as a full-size WebP plus a thumbnail = 2 uploads, so **about 1,000
images per month**. At about 300 KB per stored image, 1 GB holds about 3,300 images. The app shows
a clear "image sharing is paused" message if the quota is reached.

Storage sits behind a small `StorageDriver` interface with three drivers: Vercel Blob
(production), S3-compatible (R2, MinIO and others), and local disk (development and tests).

## 7. Web app hosting: Vercel Hobby

From Vercel's Hobby page (last updated 2026-09-14): 1,000,000 function invocations, 4 active
CPU-hours, 360 GB-hours of provisioned memory, 100 GB fast data transfer, 1,000,000 CDN requests,
5,000 image transformations per month; maximum function duration 300 s; runtime logs kept 1 hour.
Exceeding a limit pauses that feature for 30 days. **"The Hobby plan restricts users to
non-commercial, personal use only."** A portfolio project fits; a commercial launch would need Pro.

Maths: 4 CPU-hours = 14,400 CPU-seconds. At about 50 ms of CPU per API call, that is roughly
288,000 calls per month. Image re-encoding at about 300 ms each would use 300 s per 1,000 images.

Vercel cannot proxy WebSockets, so browsers connect directly to the realtime server's address.

## 8. AI moderation (optional, behind a feature flag, off by default)

| Provider   | Free limits                                                                                                                        | Data policy (from the provider's own pages)                                                                                                                                                                                                                                                         | Verdict                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Groq**   | `openai/gpt-oss-safeguard-20b` (an open-weight safety model): 30 RPM, 1,000 RPD, 8K TPM, 200K TPD                                  | "By default, Groq does not retain customer data for inference requests"; temporary logs up to 30 days only for troubleshooting or abuse investigation; Zero Data Retention can be enabled by all customers. Training is not addressed on that page: to be confirmed in Stage E before recommending. | **Recommended** default provider.                               |
| OpenRouter | Free models (`:free`): 20 RPM, **50 requests/day** without purchased credits (1,000/day only after buying at least $10 of credits) | Varies by underlying provider; some free endpoints may log prompts                                                                                                                                                                                                                                  | Too few free requests; supported as a configurable alternative. |

Maths: a policy prompt plus one short message is about 300 to 1,000 tokens. 200,000 tokens per day
is therefore **about 200 to 660 checks per day**, and 8,000 tokens per minute about 8 to 26 per
minute. So AI moderation cannot check every message. Design: the word-list filter checks every
message; AI is used only to **escalate** borderline random-mode messages and to pre-sort reported
content. Results are cached by a hash of the text. If Groq is slow, rate-limited or down, the
system falls back to the word list automatically. Only the message text is sent: never user names,
emails or IDs.

## 9. Observability and CI

- **Sentry Developer (optional):** 5,000 errors, 5M spans, 50 replays, 1 user, 30-day lookback.
- **GitHub Actions:** "free for public repositories that use standard GitHub-hosted runners". The
  repository `jawadm3/SocketSpace` is public (checked through the GitHub API on 2026-10-01). CodeQL
  is free for public repositories.
- **UptimeRobot Free:** 50 monitors at a 5-minute interval (also gives a public status page).

## 10. Risks from free tiers (carried into the risk register in `docs/development/plan.md`)

| Risk                                                 | Impact                                        | Mitigation                                                                            |
| ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Render free tier changes or the pinger is disallowed | First visitor waits about a minute            | Clear "waking up the chat server" screen; same Docker image can move to another host. |
| Render restarts at any time                          | Everyone disconnects briefly                  | Automatic reconnect and resync, tested in CI.                                         |
| Neon compute budget exhausted                        | Database unavailable until next month         | Rules in 3.2; compute use shown on the admin dashboard; alert at 70%.                 |
| Vercel Blob quota exhausted                          | Uploads paused for 30 days                    | Graceful "uploads paused" state; quota shown to admins.                               |
| Email daily cap (100/day)                            | Sign-ups beyond 100/day wait for verification | GitHub sign-in; queued retries; clear message.                                        |
| Hobby plan is non-commercial                         | Cannot be used commercially as is             | Documented in README; upgrade path described.                                         |

## Sources (fetched 2026-10-01)

- Render: [Deploy for Free](https://render.com/docs/free), [community note on 512 MB / 0.1 CPU](https://community.render.com/t/the-free-instance-type-e-g-512mb-ram-0-1-cpu/39044), [real free tiers article](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- Koyeb: [Instances](https://www.koyeb.com/docs/reference/instances), [Pricing FAQ](https://www.koyeb.com/docs/faqs/pricing), [Pricing](https://www.koyeb.com/pricing)
- Railway: [Pricing](https://railway.com/pricing)
- Northflank: [Pricing](https://northflank.com/pricing), [Billing docs](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)
- Fly.io: [Pricing](https://docs.fly.io/about/pricing/)
- Cloudflare: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 payment-method discussion](https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179)
- Neon: [Pricing](https://neon.com/pricing), [Scale to zero](https://neon.com/docs/introduction/scale-to-zero), [Cost optimization](https://neon.com/docs/introduction/cost-optimization)
- Upstash: [Redis pricing](https://upstash.com/pricing/redis)
- Vercel: [Hobby plan](https://vercel.com/docs/plans/hobby), [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- Resend: [Pricing](https://resend.com/pricing), [403 on resend.dev domain](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [Verified domains](https://resend.com/docs/dashboard/domains/introduction)
- Brevo: [Free plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [Free SMTP server](https://www.brevo.com/free-smtp-server/)
- is-a.dev: [Register README](https://raw.githubusercontent.com/is-a-dev/register/main/README.md), [Domain structure](https://docs.is-a.dev/domain-structure/)
- Groq: [Rate limits](https://console.groq.com/docs/rate-limits), [Models](https://console.groq.com/docs/models), [Your data](https://console.groq.com/docs/your-data)
- OpenRouter: [Limits](https://openrouter.ai/docs/api/reference/limits)
- Sentry: [Pricing](https://sentry.io/pricing/)
- GitHub: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- UptimeRobot: [Pricing](https://uptimerobot.com/pricing/)
- Socket.IO: [Connection state recovery](https://socket.io/docs/v4/connection-state-recovery)
- Better Auth: [Rate limit](https://www.better-auth.com/docs/concepts/rate-limit)
- Next.js: [Next.js 16 release notes](https://nextjs.org/blog/next-16)
