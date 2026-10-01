# Acceptance criteria

_Created in Stage B (2026-10-01). Individual requirements and their "done when" checks are in
`qa/requirements_matrix.md`. This file adds **journey scenarios** (what a person must be able to do
end to end), **quality gates** with measurable thresholds, and **stage exit criteria**. Each journey
becomes at least one automated end-to-end test in Stage G, and is re-run against the live site in
Stage H._

Format: **Given** (starting situation), **When** (action), **Then** (observable result).

## 1. Journey scenarios

### J1. Sign up and verify (AUTH-01, AUTH-02, AUTH-07)

- Given a new visitor, when they sign up with a breached password (for example `password123`), then
  the form refuses it and explains why, without revealing anything else.
- Given a valid sign-up, when the account is created, then a verification email is captured (by the
  local mail catcher in tests), the app opens read-only with a "verify your email" banner, and
  attempts to post are refused with a clear message.
- When the verification link is opened, then posting works; opening the same link again shows
  "already verified".

### J2. Two people chat in a room (ROOM-01/02, MSG-01, RT-03/04/05)

- Given Ava and Sam are signed in on separate browsers and both members of `#design-talk`, when Ava
  types, then Sam sees "Ava is typing" within 1 second, and it disappears within 6 seconds of Ava
  stopping.
- When Ava sends a message, then it appears immediately for Ava (faded), turns solid with one tick
  when acknowledged, and appears for Sam; the unread count for Sam's other tab increases by one.
- When Sam opens the room, then the unread count resets on all of Sam's tabs.

### J3. Edit, delete, react, reply, mention (MSG-02 to MSG-07, NOTIF-01)

- When Ava edits her message, then both see "(edited)" and the new text; a moderator viewing a
  report about it can see the previous version.
- When Sam reacts with 👍 twice, then the reaction toggles on and off for both users.
- When Sam replies to Ava's message, then the reply shows a quote that jumps to the original.
- When Sam writes `@ava`, then Ava gets an in-app notification; a non-member with that username
  gets nothing.
- When Ava deletes her message, then both see "Message deleted" in its place and ordering is
  unchanged.
- Markdown-lite renders bold, italic, code and links; `<img src=x onerror=alert(1)>` is shown as
  plain text and nothing executes.

### J4. Reconnect without losing or duplicating messages (RECON-01 to RECON-04, REL-01)

- Given Ava's network is cut (Playwright offline mode), when she sends two messages, then they show
  "Sending" and an offline banner appears.
- When Sam sends a message during the outage, and Ava's network returns, then within 10 seconds Ava
  receives Sam's message, her own two messages are delivered exactly once each, and order matches
  the server's sequence on both screens.
- Given the realtime server is restarted (SIGTERM) during a conversation, then both clients
  reconnect automatically and no message is lost or duplicated.
- Given Ava reloads the page while a message is still unacknowledged, then it is sent after reload
  (outbox survives reload) and appears once.

### J5. Private rooms, invites and roles (ROOM-03 to ROOM-06)

- Given a private room, when a non-member tries to read or post (via the UI or a hand-crafted socket
  event), then both are refused and nothing leaks (no names, no counts).
- When the owner creates an invite limited to 1 use, then the first person joins and the second
  sees "This invite has been used up".
- When a moderator mutes Sam for 10 minutes, then Sam's sends are refused with the remaining time;
  when the moderator removes Sam, then Sam stops receiving messages immediately.

### J6. Direct messages and blocking (DM-01, DM-02, SAFE-01)

- When Ava starts a DM with Sam twice, then the same conversation opens both times.
- In the DM, ticks progress Sent → Delivered → Seen as Sam's device receives and reads, unless
  either has read receipts turned off.
- When Sam blocks Ava, then Ava cannot send to the DM, cannot start a new one, Sam does not get
  notified by her mentions, and they are never matched in random mode.

### J7. Random mode, safely (RAND-01 to RAND-09)

- Given a signed-in user who has not accepted the random-mode rules, when they open random mode,
  then they see the 18+ gate and cannot join until they confirm and accept.
- Given two users with the interest "chess", when both join, then they are matched with each other
  before anyone without a shared interest; a user with no match is paired randomly after 10 seconds.
- When one sends `check out bit.ly/x` or `example dot com`, then it is refused with "Links aren't
  allowed in random chats".
- When one reports the other, then the session ends, the report contains the last messages captured
  by the server, and the database contains **no** random-mode message text outside that report.
- When the same user is reported by 3 different people within 24 hours, then they are automatically
  timed out of random mode for 24 hours and see when it ends.
- When both press "Add contact", then each appears in the other's contacts; if only one presses it,
  nothing is shared.
- When a session ends, then the end screen suggests public rooms matching the shared interests, and
  the aggregate counters increase without storing who clicked.

### J8. Moderation (ADMIN-01 to ADMIN-06)

- Given a non-admin, when they open `/admin` or call an admin action directly, then they are refused
  (HTTP 403 or redirect) and nothing is changed.
- Given an admin reviewing a report, when they suspend the reported user for 1 day with a reason,
  then the user's sockets are disconnected within 2 seconds, they see a notice with the reason and
  end time, the reporter is told the report was resolved, and the audit log shows the action.
- An attempt to `UPDATE` or `DELETE` a row in the audit log table fails at the database level.

### J9. Images and link previews (MSG-08, MSG-09, SEC-07, SEC-12)

- When a user uploads a JPEG with GPS EXIF data, then the stored image is WebP and has no metadata.
- When a user uploads a PHP file renamed to `.png`, a 30-megapixel image, or a 6 MB file, then each
  is refused with a clear reason.
- When a message contains `http://169.254.169.254/latest/meta-data/`, `http://localhost:3000`, or a
  public URL that redirects to a private address, then no preview is fetched from that address.

### J10. Account deletion and export (SAFE-04, SAFE-05)

- When a user requests a data export, then they receive a JSON file with their profile,
  memberships, messages, reactions, contacts, blocks and reports they filed; a second request the
  same day is refused with the time of the next allowed export.
- When a user deletes their account (re-entering their password), then they are signed out
  everywhere, cannot sign in again, their profile disappears, and their messages show "Deleted user"
  (or are cleared, if they chose that).

## 2. Quality gates (measurable)

| Area              | Gate                                                                                                               | How measured                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| CI                | All jobs green on `main` at every stage end                                                                        | GitHub Actions status                  |
| Unit/integration  | 0 failing tests; no skipped tests without a linked reason                                                          | Vitest report                          |
| Coverage          | About 80% lines for `packages/shared`, `packages/db`, realtime handlers                                            | Vitest V8 coverage per package         |
| E2E               | Journeys J1 to J10 automated and green in CI                                                                       | Playwright report                      |
| Security          | 0 high/critical `pnpm audit` findings; CodeQL no open high alerts; gitleaks clean on full history                  | CI jobs                                |
| Security review   | Every finding fixed, or documented with a reason and owner                                                         | Review report (Stage G)                |
| Accessibility     | 0 serious/critical axe violations on key screens; full keyboard pass recorded                                      | axe in Playwright, manual notes        |
| Contrast          | Text ≥ 4.5:1, large text and UI parts ≥ 3:1, both themes                                                           | Token check script                     |
| Home performance  | LCP under about 2.5 s on the development laptop (desktop and mobile emulation); TBT and Lighthouse scores recorded | Lighthouse runs with recorded settings |
| Real-time latency | Median and 95th-percentile send-to-receive latency recorded locally and on the free deployment                     | Load harness                           |
| Load              | Highest stable concurrent connections and messages/s on the laptop recorded with hardware details                  | Load harness results doc               |
| Privacy           | No message text, tokens or passwords in logs during the E2E run                                                    | Log scan in CI                         |
| Docs              | Every stage has a step log; README sections complete; no unverified numbers                                        | Review                                 |

## 3. Stage exit criteria

| Stage | Exit criteria                                                                                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Done (see STEP-A).                                                                                                                                                                                                                                                                                                      |
| B     | Owner approves the plan; decisions recorded (stack, visual direction, email domain, guests, priorities).                                                                                                                                                                                                                |
| C     | Database schema and migrations; auth journeys J1 work locally; shared Zod contracts; realtime server accepts only valid tokens and origins (v1's foreign-origin test now fails to connect); two-instance Redis test passes in CI; CI pipeline (lint, types, tests, build, Docker build, gitleaks, audit, CodeQL) green. |
| D     | Journeys J2 to J6 and J9 pass locally as automated tests; virtualised list; search; notifications; uploads.                                                                                                                                                                                                             |
| E     | Journeys J7, J8, J10 pass; word filter with tests; AI module with mock provider and fallback; legal pages; retention job.                                                                                                                                                                                               |
| F     | Chosen design system in both themes; animated home page meeting HOME-03/04; screenshots at 3 widths × 2 themes inspected and fixed; Lighthouse numbers recorded.                                                                                                                                                        |
| G     | All journeys automated in CI; coverage gates met; load test results recorded; independent security, accessibility and design reviews done with dispositions.                                                                                                                                                            |
| H     | Owner checklist completed; app live; live smoke tests (J1, J2, J7, J8) recorded; free-tier limits measured and documented.                                                                                                                                                                                              |
| I     | Code walkthrough, README with real screenshots, CHANGELOG, `v2.0.0` tag and GitHub Release; full-history secret scan clean; Definition of Done (brief section 11) checked item by item.                                                                                                                                 |
