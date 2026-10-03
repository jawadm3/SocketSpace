# Step E: Random mode and safety

- **Started:** 2026-10-03 (session 6, `continuation` branch).
- **Status:** In progress. E1 (safety core) is done. E2 to E5 are still to do.
- Everything here was built on the `continuation` branch and waits for the owner's review (pull
  request jawadm3/SocketSpace#1). Decisions D-045 to D-047 are marked for that review.

## Goal

From `docs/development/plan.md`: the "talk to someone new" mode, and everything that keeps both
modes safe. A word filter, reports and blocks everywhere, sanctions, the moderation dashboard, the
optional AI moderation module, and the data-rights pages and jobs.
Stage exit (`qa/acceptance_criteria.md`): journeys J7, J8 and J10 pass (J7 including guests); word
filter with tests; AI module with mock provider and fallback; legal pages; retention job.

| Milestone               | Status      | Commits              |
| ----------------------- | ----------- | -------------------- |
| E1 Safety core          | Done        | `8efd3b6`, `837923d` |
| E2 Random mode          | Not started |                      |
| E3 Moderation dashboard | Not started |                      |
| E4 AI moderation        | Not started |                      |
| E5 Data rights          | Not started |                      |

## E1: Safety core (done)

### What was built, and how it works

**The word-list filter** (SAFE-02; `packages/shared/src/moderation/`). Three small files:

- `normalize.ts` undoes disguises. It splits a text into tokens (runs of letters and digits) and
  turns each one into plain lower-case letters: capitals and full-width letters, accents,
  invisible characters hidden inside a word, look-alike letters from Cyrillic and Greek, and
  leet-speak ("sh1t", "a$$"). _Like reading a number plate aloud: "5H1T" and "shit" sound the
  same._ Leet-speak is only read in tokens that contain a real letter, so "room 455" stays a
  number.
- `wordlist.ts` is the list: about 110 plain words and phrases, each with a severity (low, medium,
  high) and a category. The file says at the top that it contains offensive words, because
  recognising them is its job.
- `filter.ts` does the matching. A listed word must be a **whole token**, which is what avoids
  the "Scunthorpe problem": "Scunthorpe", "class", "cocktail" and "therapist" are simply
  different tokens. Repeated letters still match ("shiiit"), but a doubled letter in a listed
  word must stay doubled, so "as" is not "ass". Letters spaced out with separators ("s h i t",
  "s.h.i.t") are read as one word. Phrases ("kill yourself") are matched as consecutive tokens.

What happens next depends on the severity (security.md 4.2):

| Severity | In rooms and DMs                                  | In random mode (E2)        |
| -------- | ------------------------------------------------- | -------------------------- |
| Low      | Shown as written                                  | Masked                     |
| Medium   | Shown masked ("••••") and flagged for a moderator | Masked and flagged         |
| High     | Not sent at all; the attempt is flagged           | Not sent; the session ends |

A masked message is **stored as written** and masked on the way out, for everyone including its
author, so the moderator who reviews the flag sees the real text. A blocked message is never
stored and takes no message number; the author reads "This message was not sent: it contains
words that are not allowed here." Edits are checked exactly like new messages. The word list never
reaches a browser: only the two servers import it (checked after a build).

**Reports** (SAFE-01, PROF-08, ADMIN-01; `packages/db/src/queries/reports.ts`, the dialog in
`apps/web/src/components/report-dialog.tsx`). "Report" is on every message from someone else, next
to every person in the member list, in the DM header and in the room header. The dialog asks for a
reason from a fixed list and, optionally, a few words. For a person it also asks what the report
is about: how they behave, their profile picture, or their name and bio.

The server then takes its own **evidence snapshot** inside the same database transaction: the
message as stored, its earlier versions, its pictures and the five messages before and after; or
the profile exactly as that reporter could see it; or the room's name, topic and owners. _Like an
insurer photographing the damage themselves instead of taking the claimant's description._ Nothing
the reporter types can pretend to be what someone else wrote, and a later edit or deletion does
not change the evidence. A reported picture (for example a profile photo that is then replaced) is
kept until the report is closed.

You can only report what you can see; missing and private things give the same answer. Ten
attempts an hour. Reporting the same thing twice is one report.

**Sanctions** (ADMIN-03, the model RAND-05 will use; `packages/db/src/queries/sanctions.ts`).
Five kinds: warning, mute, suspension, ban, random-mode timeout. `applySanction` runs one
transaction: check that the actor is a site administrator (never acting on themselves or another
administrator), write the audit log with the required reason, write the sanction row that the fast
checks read, leave the person a notification, and for a suspension or ban end every session.
`liftSanction` ends them early, with its own reason and audit entry.

**Live enforcement.** Three layers, so none depends on the others:

1. The database refuses posts, edits and reactions from a muted, suspended or banned person
   inside the write itself (since Stage C).
2. The realtime server, told by the web app's signed internal event, sends the person
   `moderation:notice` with the reason and the end time, and on suspension or ban closes every
   connection (`session:ended`) and refuses new ones.
3. Signing in is refused while a suspension or ban is in force, with the reason: "This account is
   suspended until 2026-10-04 14:30 UTC. Reason: ...".

A timed suspension ends by the database clock. Because suspending deletes every session, signing
in is the only way back, and that is where an account whose suspension has run out is put back to
normal.

**What the person sees.** A notice at once if they are online. If not, a "message from the
moderators" notification that opens Settings > Account standing, which lists each decision in
force with its reason, start and end. While muted, the message box is replaced by the reason and
the end time in every room and DM, and comes back by itself when the mute ends or is lifted.

### Decisions

D-045 (the filter), D-046 (reports and evidence), D-047 (sanctions and enforcement), all marked
"(continuation, needs owner review)" in `docs/development/decisions.md`.

### Problems and fixes

- **A message of single spaced-out letters was slow to check.** The first version normalised
  every possible stretch of letters separately: 114 ms for a 4,000-character worst case, which at
  one message a second per person is a way to keep the server busy. The matcher now normalises
  each letter once and extends the word one letter at a time: 18 ms for the same input, 3 ms for
  ordinary text (development laptop).
- **Backslashes in a script written through the shell turned into real line breaks** (the known
  trap in `CLAUDE.md`), which broke `filter.ts` until the line was fixed with the editor.
  Patch scripts for this stage were then written as files instead.
- **The sign-in check must not wait for the sign-in library.** The first version of
  `resolveSignInStanding` locked the account's row inside its own transaction. It runs inside
  Better Auth's work on the same account, where waiting for a lock could hang, so it now reads
  without a lock and guards its one write in SQL.
- **"Try again" on a blocked message made no sense** (seen in a screenshot): sending the same
  words again gives the same answer and another flag. A blocked message now offers "Delete" only.
- **The report dialog was taller than a laptop screen** (seen in a screenshot): the buttons were
  below the fold. The choices are now in two columns and the dialog scrolls if it must.
- **Two places showed the mute text**, so the first end-to-end assertion matched both. The notice
  and the message-box explanation are both intended; the test now names the one it means.

### Tests run, with actual results

| What                                  | Result                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                          | 13/13 tasks. shared 251, db 156, realtime 72 (+2 Redis tests that run in CI), web 250.                                                                                                                 |
| The same on PostgreSQL 17.9           | db 156, realtime 72 (+2 skipped), web 250, with `TEST_DATABASE_URL`.                                                                                                                                   |
| Word filter (`filter.test.ts`)        | 83 tests: 33 disguises caught, 13 disguises of one high-severity slur, 31 innocent texts let through (Scunthorpe, Penistone, "class", "spices", "who're", "Niger", numbers), masking, both modes.      |
| Do the filter tests have teeth?       | With the plural rule switched off, 2 tests fail; with the "doubled letter stays doubled" rule switched off, 2 tests fail. Both restored.                                                               |
| Sanctions (`sanctions.test.ts`)       | 19 tests: who may, required reason and duration, each kind's effect, expiry by the database clock, lifting, ban outranks suspension, sign-in standing.                                                 |
| Reports and flags (`reports.test.ts`) | 18 tests: evidence contents, unchanged by later edits, stored text kept when readers saw a mask, visibility rules, duplicates, kept profile photo, flags for medium and high, the 20-an-hour flag cap. |
| Live (`moderation.test.ts`, realtime) | 11 tests with real sockets: blocked, masked (live and on resync), edits, metrics; warning, mute and lift, suspension, ban, random-mode timeout.                                                        |
| Web (`reports`, `moderation`, `auth`) | 19 new tests: validation, rate limit, wording; internal events sent; sign-in refused with the reason through the real sign-in library, allowed again after expiry, no reason for a wrong password.     |
| End-to-end (Playwright, Chromium)     | 18/18 in 2.4 min. Two new journeys: the filter masks and blocks and three kinds of report keep the server's evidence; a mute and a suspension reach the person live, with the reason.                  |
| 10,000-message test in that run       | p95 34.8 ms, worst 57.2 ms, 3 of 548 frames over 50 ms (development laptop, headless Chromium).                                                                                                        |
| Word list in browser bundles          | 0 files under `.next/static` contain a list word; the server build and the realtime bundle do.                                                                                                         |
| Screenshots inspected (`E2E_SHOTS=1`) | Report dialog, blocked message, mute notice and explanation, account standing page, sign-in refusal.                                                                                                   |

### What E1 leaves for later

- Nothing in the app applies a sanction yet: the moderation dashboard (E3) will call
  `sanctionUser` and `liftUserSanction`. The end-to-end test plays the moderator through the same
  database functions and the same signed event.
- The reports and flags queues, showing kept pictures to moderators, and telling a reporter that
  their report was resolved are E3.
- Random-chat reports, blocks inside a random chat and automatic random-mode timeouts are E2.
- Names, bios and room names are not checked against the word list (D-045, waiting for the
  owner's word).

## What comes next

E2: random mode (gate, guests, queue and matcher, relay with the strict filter, evidence buffer,
offers, cooldowns and timeouts, room suggestions, metrics, kill switch). Then E3, E4 and E5.
