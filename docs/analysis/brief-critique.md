# Critical analysis of the brief

_Stage B, 2026-10-01. The brief asks for its own suggestions to be challenged. This document lists
where it is right, where reality on free tiers differs, what it leaves undecided, and what we
propose. Nothing here changes the brief by itself; changes the owner accepts are logged in
`docs/BRIEF_CHANGES.md`._

## 1. What the brief gets right

- **Rebuild, don't patch.** v1's design cannot be extended (see `v1-analysis.md`).
- **A dedicated long-running real-time server.** Confirmed by research: serverless functions cannot
  hold WebSockets.
- **Shared, validated contracts on both ends.** This is the single most effective defence against
  the class of bugs v1 had (anything relayed to anyone).
- **Random mode as an entry point to the community**, measured with aggregate counts only. This is
  the right product answer to the retention problem of random-chat products.
- **Honesty rules** (real numbers only, documented limits). These shape the whole plan.

## 2. Where free-tier reality differs from the defaults (with numbers)

Full numbers and sources: `docs/research/free-tier-research.md`.

| Brief default                                                             | Reality                                                                                                                                               | Proposal                                                                                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis for cache/pub-sub/presence, or a Postgres LISTEN/NOTIFY alternative | Upstash Free = about 16,100 commands/day (six online users' presence alone uses it). LISTEN/NOTIFY keeps Neon awake: 186% of the free compute budget. | In-memory on the single free instance; Redis adapter switched on by `REDIS_URL` and tested in CI with two instances.                                        |
| Cloudflare R2 for files                                                   | Needs a payment card to enable                                                                                                                        | Vercel Blob (free on Hobby, no card) behind a driver interface; R2 stays one config change away.                                                            |
| Resend for email                                                          | Only emails the account owner until a domain is verified                                                                                              | Owner decision: free is-a.dev subdomain (recommended) or own domain; SMTP fallback.                                                                         |
| Render for the realtime server                                            | Sleeps after 15 min without inbound traffic, ~1 min to wake, may restart any time; 750 h/month = exactly one always-on service                        | Keep, with a 5-minute uptime ping to `/healthz` (no database access) and a clear "waking up" screen. Cloudflare Durable Objects documented as the fallback. |
| Neon for Postgres                                                         | 100 CU-hours/month: always-on would run out after ~16.7 days                                                                                          | Design rules: no permanent connections, idle pools close in 60 s, keep-alive never touches the database.                                                    |
| WebGL hero with Three.js / React Three Fiber                              | The described effect is 2D; R3F adds roughly 150 to 250 KB of compressed JS                                                                           | Canvas 2D first (prototypes already built); R3F only if a measured prototype proves it is needed.                                                           |
| k6 for load testing                                                       | k6 does not speak Socket.IO's framing without hand-written encoding                                                                                   | A Node harness with the real `socket.io-client`; Artillery as an alternative.                                                                               |
| Prisma or Drizzle                                                         | Prisma's npm `latest` tag is currently a release candidate (8.0.0-rc.19)                                                                              | Drizzle 0.45 (stable, thin, works with PGlite in tests and with Better Auth).                                                                               |
| TypeScript (latest)                                                       | TypeScript 7.0 is out, but `typescript-eslint` supports only `<6.1.0`                                                                                 | TypeScript 6.0.x until lint tooling catches up.                                                                                                             |

## 3. Gaps and ambiguities in the brief (and our proposed answers)

1. **Guests in random mode.** The brief implies signed-out use ("users who are signed in can
   choose..."). Allowing guests lowers friction (good for the entry-point goal) but weakens bans.
   _Proposal:_ allow guests with an anonymous session, half the message rate, no contact exchange,
   bans by guest account plus hashed IP. **Owner decision.**
2. **"Replies or threads".** _Proposal:_ inline replies (quote + jump to original) now; side-panel
   threads as a future improvement.
3. **"Read receipts or unread counts" and "delivery state".** _Proposal:_ DMs show sent /
   delivered / seen (reciprocal opt-out); rooms show unread counts and a "new messages" divider.
   Defined precisely in `realtime-protocol.md`.
4. **Link previews and privacy.** Fetching preview images is a second SSRF surface and a tracking
   vector. _Proposal:_ text-only previews (title, description, site name) in v2.
5. **Account deletion vs. safety evidence.** GDPR erasure conflicts with keeping evidence for
   reports. _Proposal:_ delete the account and personal data; keep report evidence until the
   report's retention ends (180 days after resolution), stated in the Privacy Policy as legitimate
   interest. Messages remain as "Deleted user" unless the person also chooses to delete their
   messages.
6. **Email-verified posting.** _Proposal:_ unverified accounts can read but not post in community
   mode; GitHub sign-in counts as verified.
7. **Retention periods** were not specified beyond "documented". _Proposal:_ the table in
   `data-model.md` (random metadata 30 days, reports 180 days after resolution, audit log 1 year,
   and so on).
8. **Who moderates rooms vs. the platform.** _Proposal:_ room owners/moderators can mute and
   room-ban within their room; platform admins handle reports, global sanctions and the audit log.
9. **Visual regression tests on a Windows laptop vs. Linux CI.** Fonts render differently on each
   operating system, so screenshots never match across them. _Proposal:_ visual regression runs
   only in CI (Linux), with baselines generated by a CI job and committed.
10. **Coverage target** (about 80% for `shared`, `db` and realtime handlers): agreed, measured with
    Vitest's V8 coverage and reported per package.

## 4. Risks the brief does not mention

| Risk                                    | Why it matters                                                                                                                                                                                                       | Mitigation                                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UK Online Safety Act 2023**           | User-to-user services have duties (illegal-content and children's-access risk assessments). Ofcom's codes treat stranger matching as a risk factor. A self-declared 18+ box is not "highly effective age assurance". | Position honestly as a portfolio demo; legal pages say "template, not legal advice"; random mode can be switched off (`RANDOM_MODE_ENABLED`); README explains what real operation would require. |
| **Vercel Hobby is non-commercial only** | A commercial launch would breach the plan's terms                                                                                                                                                                    | Stated in the README and deployment guide.                                                                                                                                                       |
| **Free tiers change without notice**    | Several limits changed in 2024 to 2026 (Upstash, Koyeb, Neon)                                                                                                                                                        | Re-check every number in Stage H; portable Docker image; drivers for storage and email.                                                                                                          |
| **Scope versus one developer**          | Section 3 is a large product (comparable to an early Discord/Slack clone plus moderation tooling)                                                                                                                    | Priorities below; stages ordered so a working product exists after Stage D.                                                                                                                      |
| **Laptop RAM (about 7.35 GB usable)**   | Next.js dev server + realtime server + Postgres + Playwright browsers can exceed it                                                                                                                                  | Run end-to-end tests against production builds, one browser engine locally (Chromium), full matrix in CI; avoid parallel heavy jobs.                                                             |
| **Supply-chain guard vs. urgent fixes** | The 3-day release-age rule could delay an urgent security patch                                                                                                                                                      | Exemption process: allowed only for a security fix, recorded in `decisions.md` with the advisory link.                                                                                           |

## 5. Proposed priorities (MoSCoW)

So that a strong, honest product ships even if time runs short. All "Must" and "Should" items are
planned; "Could" items are done if time allows and are otherwise listed as future improvements.

| Priority       | Items                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Must**       | Accounts with email verification and reset; profiles; public/private rooms with roles and invites; DMs; send/edit/delete; replies; reactions; mentions; markdown-lite; presence; typing; unread counts; persisted history with pagination; reconnection with resync and no duplicates; random mode with gate, interests, skip/end/report/block, filters and limits; report/block everywhere; moderation dashboard with audit log; security baseline (section 5.1); legal pages; account deletion and export; CI; deployment; documentation |
| **Should**     | Image sharing with re-encoding; text link previews; message search; in-app notifications; delivery/seen ticks in DMs; GitHub sign-in; AI moderation module (off by default); load test; visual regression                                                                                                                                                                                                                                                                                                                                  |
| **Could**      | Google sign-in; browser notifications; room-level word lists; Sentry; admin stats charts                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Won't (v2)** | Voice and video; side-panel threads; end-to-end encryption; native mobile apps; preview images                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Owner additions (2026-10-01), added to the priorities:** _Must:_ three selectable themes
(Airmail default), unique nicknames with optional private real names, a required profile picture
(presets and a customiser), Google, Facebook and GitHub sign-in. _Should:_ avatar photo upload,
Discord, Microsoft and LinkedIn sign-in, passkeys. Google sign-in moves from "Could" to "Must".

## 6. Owner decisions (answered 2026-10-01)

1. **Stack:** approved, including the changes from the brief's defaults (D-009 to D-020).
2. **Visual direction:** all three become user-selectable themes; Airmail is the default (D-021).
3. **Email:** free is-a.dev subdomain with Resend (D-014).
4. **Guests in random mode:** allowed with stricter limits (D-025).
5. **Priorities and retention periods:** not answered separately; work proceeds with the values in
   section 5 and `data-model.md`, and the owner can change them at any time.
6. **Added by the owner:** social sign-in options (D-022), required profile pictures (D-023),
   nicknames (D-024).
