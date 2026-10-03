# Security, trust and safety design

_Stage B, 2026-10-01. Proposed for approval. Target: the intent of OWASP ASVS Level 2 for the
areas a chat platform touches. Each control maps to a requirement ID in
`qa/requirements_matrix.md` and is verified in Stage G by a separate agent with an independent
context (same underlying model)._

## 1. What we are protecting, and from whom

**Assets:** private conversations (DMs, private rooms), accounts and sessions, personal data
(emails, IP addresses), the safety of people using random mode, moderator powers, and the
free-tier quotas (an attacker who burns them takes the service offline).

**Likely attackers:** spammers and flooders; harassers (including people evading blocks and bans);
curious users trying to read rooms they are not in; bots creating accounts; people uploading
malicious files; someone trying to make our server fetch internal addresses (SSRF) through link
previews; supply-chain attacks through npm packages.

## 2. Threat model (STRIDE, short form)

| Threat                     | Example                                                                   | Main controls                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **S**poofing               | Connecting to the realtime server as someone else; forged internal events | Signed 5-minute tokens verified against JWKS; `Origin` allow-list; HMAC-signed internal events with timestamp and replay protection           |
| **T**ampering              | Changing another person's message; faking timestamps or IDs               | Server assigns IDs, sequence numbers and timestamps; author checks on edit/delete; schemas reject unknown fields                              |
| **R**epudiation            | A moderator denies banning someone                                        | Append-only `moderation_action` audit log (database trigger blocks edits and deletes)                                                         |
| **I**nformation disclosure | Reading a private room; message text in logs; EXIF location in photos     | Membership checked on every read and write; Socket.IO rooms only for members; log redaction; images re-encoded without metadata               |
| **D**enial of service      | Message floods; huge payloads; connection floods; quota burning           | Token-bucket rate limits per user and per IP; 16 KB packet cap; connection caps; Vercel and Render platform DDoS protection; quotas monitored |
| **E**levation of privilege | A member acting as room owner; a user reaching the admin dashboard        | Role checks in one shared authorisation module (`packages/shared/authz`), deny by default, tested for every role and action                   |

## 3. Controls by area

### 3.1 Authentication (ASVS V6 "Authentication" in ASVS 5.0)

- Better Auth with email and password; passwords **10 to 128 characters**, no composition rules,
  checked against known breached passwords (Have I Been Pwned "k-anonymity" range API: only the
  first 5 characters of the password's SHA-1 hash leave the server). Hashing: Better Auth's default
  scrypt.
- Email verification required before posting in community mode; password reset links single-use,
  expiring after 30 minutes; all sessions revoked after a password change.
- Social sign-in: Google, Facebook, GitHub, Discord, Microsoft, LinkedIn, plus passkeys (see 3.11 for linking rules).
- Sign-in rate limit: 3 attempts per 10 seconds per IP (Better Auth default) plus our own
  per-account lockout with growing delays after 10 failures.
- Generic error messages ("email or password is incorrect"), and the same response time and message
  for "reset link sent" whether or not the email exists (no account enumeration).

### 3.2 Sessions (ASVS V7 "Session management")

- Database sessions; cookie `HttpOnly`, `Secure`, `SameSite=Lax`, `__Secure-` prefix in production.
- 30-day absolute lifetime, 7-day idle timeout; rotation on sign-in and privilege change.
- Settings page lists active sessions (browser, rough location from IP, last active) with "sign
  out" and "sign out everywhere". Revocation also disconnects that session's sockets.

### 3.3 Access control (ASVS V8 "Authorization")

- One authorisation module answers "can user X do action Y on resource Z?" for both apps. Deny by
  default. A table-driven test checks every role (`guest`, `member`, `moderator`, `owner`, `admin`,
  `banned`) against every action.
- Membership is enforced inside the database write itself (see `data-model.md`, "How a message gets
  its number").
- Admin dashboard routes check `role = admin` on the server for every request and every server
  action, not just in the navigation.
- Blocks: a blocked person cannot DM, mention-notify or be matched with the blocker; their messages
  in shared rooms are collapsed behind "Blocked message" for the blocker.

### 3.4 Input validation and output encoding (ASVS V1 "Encoding and sanitization", V2 "Validation and business logic")

- Every HTTP body, query, route parameter and socket event is parsed with a Zod schema with
  explicit maximum lengths and counts; unknown fields are rejected (`strict`).
- Text is normalised (Unicode NFC) and stripped of control characters and "bidi override"
  characters that can disguise text.
- **No raw HTML, ever.** Markdown-lite (bold, italic, strikethrough, inline code, code blocks,
  links, @mentions, quotes) is parsed by our own small tokenizer into React elements. There is no
  `dangerouslySetInnerHTML` in the codebase (enforced by a lint rule).
- Links: only `http:` and `https:` URLs become links; they open with `rel="noopener noreferrer
nofollow ugc"`; the full URL is shown on hover.

### 3.5 Browser protections (ASVS V3 "Web frontend security", V12 "Secure communication")

Set in `apps/web/next.config.ts` and `proxy.ts`:

- **Content Security Policy** with a per-request nonce:
  `default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://{blob-host}; connect-src 'self' {realtime-origin} wss://{realtime-host};
font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none';
upgrade-insecure-requests`. (`style-src 'unsafe-inline'` is a known compromise for the styling
  libraries; tightened in Stage G if feasible.)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera,
  microphone, geolocation off), `Cross-Origin-Opener-Policy: same-origin`.
- CSRF: Better Auth checks the `Origin` of state-changing auth requests; Next.js server actions
  check `Origin` against the host; our route handlers that change state require `POST` plus the same
  origin check; cookies are `SameSite=Lax`.

### 3.6 Realtime server (ASVS V4 "API and web service", V9 "Self-contained tokens")

- CORS configured from `WEB_ORIGINS` **and** an explicit `allowRequest` origin check (CORS alone
  does not protect WebSockets, as v1 showed).
- Token in the handshake body; never in URLs or logs.
- Per-event schema validation, authorisation and rate limits (see `realtime-protocol.md`).
- Packet size cap 16 KB; idle sockets without a valid session are closed after 10 seconds.
- `/metrics` requires a bearer token; `/internal/events` requires a valid HMAC signature.

### 3.7 Files (ASVS V5 "File handling")

- Images only (JPEG, PNG, WebP, GIF first frame), at most 4 MB uploaded and 25 megapixels decoded.
- File type decided by **magic bytes**, not the file name or the browser's claim.
- Decoded and re-encoded to WebP with sharp (`limitInputPixels`, metadata dropped, orientation
  applied), which removes EXIF/GPS data and destroys most "polyglot" tricks.
- Stored under random keys in private storage. Browsers load every picture from our own
  `/api/media/<id>`, which checks on each request that this viewer may see it, and sends it with
  `Content-Type: image/webp`, `nosniff` and a policy that allows it nothing if opened as a page.
  No storage address ever reaches a browser (D-043; this replaced the earlier idea of serving
  from the storage provider's domain with signed addresses).
- Upload rate limit: 20 per hour per user, counting refused files. Uploads need a confirmed
  email address and must come from our own pages (Origin check).
- A deleted message's pictures can no longer be loaded; a daily clean-up deletes those files and
  uploads never used within 24 hours.

### 3.8 Link previews without SSRF

Server-side fetching is risky: a malicious link could make our server request
`http://169.254.169.254/` (cloud metadata) or other internal addresses. Rules:

1. Only `http`/`https`, ports 80 and 443, no credentials in the URL.
2. Resolve DNS ourselves; refuse private, loopback, link-local, multicast and reserved ranges
   (IPv4 and IPv6, including IPv4-mapped IPv6); connect to the **resolved IP** (prevents DNS
   rebinding).
3. Follow at most 3 redirects, re-checking every hop.
4. 3-second timeout, 512 KB maximum read, only `text/html`.
5. Extract only title, description and site name (text). No preview images in v2 (each one would
   be another fetch to secure and a tracking pixel for the link's owner).
6. Results cached for 7 days; never fetched in random mode (links are blocked there).
7. The browser never names an address to fetch: it names a message, and the server reads the
   links from that message's own text, only for a viewer who may read it (D-043).
8. One fetch per link however many people open the message at once (the first request claims
   the address, the others ask again a moment later), and at most 20 new fetches a minute per
   person, so a message cannot turn our server into a source of traffic against another site.

### 3.9 Secrets, supply chain and CI (ASVS V13 "Configuration", V15 "Secure coding and architecture")

- Secrets only in environment variables (Vercel and Render dashboards, local `.env.local`).
  `.env*` is git-ignored except `.env.example` (names and descriptions only). The assistant never
  reads `.env` files.
- **gitleaks** in a pre-commit hook (via a portable binary in `.cache/tools`) and in CI on every
  push, plus a full-history scan before release.
- `pnpm audit` in CI (fails on high and critical), Dependabot alerts, GitHub CodeQL, and the
  3-day `minimumReleaseAge` rule.
- GitHub Actions use pinned versions and least-privilege `permissions:`.

### 3.10 Logging and privacy (ASVS V16 "Security logging", V14 "Data protection")

- Structured JSON logs (pino) with automatic redaction of `password`, `token`, `authorization`,
  `cookie`, `email`, `body`, `text`.
- Message text is never logged, in either mode. Random-mode content exists only in memory.
- Security events are logged (sign-in failures, rate-limit disconnects, permission denials,
  moderation actions) with user ID and request ID, not personal details.
- IP addresses are stored only where needed (sessions; HMAC-hashed for bans) with the retention
  periods in `data-model.md`.
- The only message text kept in the browser is the person's own **unsent** messages (the outbox,
  in `localStorage`, under their user ID), until the server stores them or they press "Delete".
  Signing out and an ended session clear every outbox in that browser; saved entries are checked
  against the send contract before use (D-041).

### 3.11 Social sign-in and account linking (ASVS V10 "OAuth and OIDC")

- Providers (D-022): Google, Facebook, GitHub first; Discord, Microsoft, LinkedIn and passkeys under
  "More ways to sign in". OAuth uses the authorisation-code flow with PKCE and `state`, handled by
  Better Auth; callback URLs are exact matches registered with each provider.
- **Automatic linking by email only for trusted providers.** Better Auth's documentation lists
  Google, Apple, Discord, GitHub and LinkedIn as giving trustworthy email-verification signals and
  warns that Facebook and Microsoft Entra ID do not. A Facebook or Microsoft sign-in whose email
  matches an existing account therefore never logs into that account; the owner of the account can
  link the provider from Settings after signing in the original way.
- Providers whose credentials are not configured are hidden, never shown broken.
- Only the minimum scopes are requested (identity and email). Provider access tokens are not used
  after sign-in and are not shown to the browser.

### 3.12 Profile privacy (names and avatars)

- **Real names (D-024):** the server builds every user object for a specific viewer and leaves out
  the real name unless that viewer is allowed to see it (owner's choice: nobody, contacts,
  everyone). This applies to HTTP responses and socket payloads alike, and is covered by tests.
  Real names imported from Google or Facebook start as "nobody".
- **Avatars (D-023):** preset and custom avatars are generated locally from a settings object
  (DiceBear, CC0 styles), so viewing a profile makes no third-party request. Uploaded photos use
  the image rules in 3.7 and can be reported; a moderator can reset an offending avatar to a preset.
- In random mode, names and avatars stay hidden until both people agree to share.

## 4. Safety features

### 4.1 Report and block everywhere

Every message, user profile, room and random session has "Report" and "Block". Reports capture a
server-side snapshot as evidence. Reporters are told when their report is resolved.

As built in Stage E1 (D-046): a message, a person (behaviour, profile picture, or name and bio)
and a room can be reported from the message, the member list, the DM header and the room header.
The snapshot is taken inside the transaction that stores the report: the message as stored (not
the masked text), its earlier versions, its pictures and the five messages before and after; the
profile as that reporter could see it; or the room's name, topic and owners. A reported picture is
kept until the report is closed. You can report only what you can see, 10 times an hour, and the
same thing once while it is open. Random-session reports come with E2; telling the reporter about
the outcome comes with the dashboard (E3).

### 4.2 Word-list filter (baseline, always on)

- A curated list in `packages/shared/src/moderation/` (server-side only: it is never part of a
  browser bundle) with categories and **severity**:
  - _low_ (mild profanity): allowed in community rooms; masked in random mode;
  - _medium_ (harassment, sexual terms, and slurs that are also ordinary words or names
    somewhere): masked and flagged for review. The text is stored as written and masked on the
    way out, so the reviewer sees what was said;
  - _high_ (slurs, threats, sexual content involving minors, doxxing patterns): **blocked**, flagged,
    and in random mode the session ends with a 1-hour random-mode timeout.
- Matching on normalised text: lower-case, Unicode NFKC, homoglyph and "leet-speak" folding
  (`@ → a`, `0 → o`), collapsed repeats (`soooo → so`), and **word boundaries** to avoid the
  "Scunthorpe problem" (blocking innocent words that contain a bad word).
- The list and the normaliser are unit-tested with tricky cases, including false positives.
- Matching is on whole tokens; spaced-out letters ("s h i t") are read as one word; a few entries
  match anywhere in a token, with their innocent exceptions listed.
- At most 20 unreviewed flags an hour are kept per person.
- **Not built (D-045):** room-level word lists set by room owners, and "doxxing patterns" in
  community mode (contact details in random mode are blocked in E2). Names, bios and room names
  are not yet checked against the list.

### 4.3 Random mode protections

- **18+ gate** before first use: clear statement, checkbox "I am 18 or older", acceptance of the
  random-mode rules (versioned; a new version asks again). This is self-declaration; see the legal
  note in 4.6.
- Text only; links and contact details patterns (phone numbers, emails, social handles) are blocked
  to discourage moving strangers to unmoderated channels.
- Strict rate limits (see protocol doc); **cooldowns**: 3+ reports from different people in 24
  hours → automatic 24-hour random-mode timeout and a flag for review; any high-severity filter hit
  → 1-hour timeout; repeated skips faster than 3 seconds each → 2-minute cooldown (anti-harvesting).
- Partners are anonymous ("Stranger") unless **both** agree to share profiles or add each other.
- Guests (approved, D-025): stricter limits (half the message rate), cannot exchange contacts, banned by
  guest account and hashed IP.
- Ephemeral: no message text stored; minimal metadata kept 30 days; evidence only through reports.

### 4.4 Moderation (admin dashboard)

Queues for open reports and automatic flags; user search; actions **warn, mute (timed), suspend
(timed), ban, remove message, restore message, dismiss**; every action requires a reason, notifies
the affected user with the reason (a "statement of reasons", in the spirit of the EU Digital
Services Act) and is written to the append-only audit log, which admins can browse and filter.

The sanctions themselves are built (Stage E1, D-047): warning, mute, suspension, ban and
random-mode timeout, applied only by site administrators (never to themselves or another
administrator), each in one transaction with its audit entry. They are enforced in three
independent places: the database refuses a sanctioned person's writes; the realtime server tells
the person the reason and closes every connection on suspension or ban; and signing in is refused
with the reason while a suspension or ban is in force. The person finds every decision in force,
with its reason and end, under Settings > Account standing. The dashboard that applies them is E3.

### 4.5 Optional AI moderation

Behind `AI_MODERATION_ENABLED` (default `false`). An OpenAI-compatible client (`baseURL`, `model`,
`apiKey` from configuration), default provider Groq. Used only for escalation (borderline random
messages, reported content), never for every message (free-tier maths in the research doc). Sends
only the text being classified. Results cached by text hash; 2-second timeout; on any error or
rate limit, falls back to the word-list result. A mock provider is used in all tests.

### 4.6 Legal pages and an honest note on regulation

Terms of Use, Privacy Policy and Community Guidelines are written in plain language for the UK and
EU (UK GDPR and EU GDPR rights: access, correction, deletion, portability, objection; retention
periods from `data-model.md`; an abuse contact). Each page states clearly that it is a **template,
not legal advice**.

Honest note for the owner: the UK **Online Safety Act 2023** places duties on "user-to-user"
services, including risk assessments for illegal content and children's access, and Ofcom's codes
treat **features that let strangers find and message each other** as a risk factor. A self-declared
18+ checkbox is not "highly effective age assurance". SocketSpace v2 is a portfolio demonstration;
if it were ever operated as a real public service in the UK or EU, a proper legal review, risk
assessment and age-assurance solution would be needed first. The README and the random-mode gate
will say this plainly, and random mode can be switched off entirely with `RANDOM_MODE_ENABLED=false`.
