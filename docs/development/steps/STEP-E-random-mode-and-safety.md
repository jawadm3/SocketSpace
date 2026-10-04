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

## E2: Random mode (done)

Built in session 7 on the `continuation` branch (2026-10-04). Decisions: D-048 to D-050.

### What was built, and how it works

**In one sentence:** two adults who do not know each other can talk in text, without their words
ever being saved, with the tools to leave, report and block, and with the server stopping the
things that make such chats unsafe.

1. **The gate (RAND-02).** Before anything else a person reads six rules and ticks two boxes: "I
   am 18 or older" and "I accept the rules". The page says honestly that this is the person's own
   declaration, not an age check. The rules have a version; the account stores which version was
   accepted, and a new version asks again. The realtime server looks at that record every time
   someone tries to start a chat, so the page cannot be skipped.
2. **The queue and the matcher (RAND-03).** People who press "Start chatting" wait in a queue in
   the realtime server's memory. Twice a second, and whenever someone joins, the matcher pairs
   people: those who share an interest first (most shared interests, then longest wait), and
   people without a shared interest once both have waited 10 seconds or named no interests. It
   never pairs two people when one blocked the other, the same two again within 10 minutes, or an
   account with itself. The matcher is a small file with no clock, socket or database of its own
   (`apps/realtime/src/random/matcher.ts`), so each rule has an exact test.
3. **The relay (RAND-01, RAND-06, RAND-07).** A message is checked and handed to the other person;
   it is not written to the database or the logs. The checks, in order: is this person in this
   chat, in this tab; the rate limit; **links and contact details** (refused, with the rule
   named); the **strict word filter** from E1 (mild and medium words are masked for both people;
   the worst are not sent, the chat ends, and the sender's random chat is paused for 1 hour).
4. **The evidence buffer (RAND-04, RAND-07).** The last 20 messages of a chat stay in memory
   while it goes on and for 5 minutes after it ends. If someone reports the chat in that time,
   the buffer is copied into the report: each message as written, who sent it, when, and whether
   it was delivered. Otherwise it is dropped. This is the only way random-chat text can reach the
   database.
5. **Leaving, reporting, blocking (RAND-04).** "Next" ends the chat and looks for another; "End"
   ends it; "Report" ends it and files the report; "Block" ends it and the two are never matched
   again (for a signed-in person an ordinary block, for a guest a list in memory). The other
   person always sees an ordinary ending: nobody is told they were reported or blocked. A lost
   connection gets 15 seconds to come back (`random:resume`, a new event) before the chat ends;
   10 minutes of silence end it too.
6. **Automatic pauses (RAND-05).** One hour after a blocked message; 24 hours when three different
   people reported someone within 24 hours; 2 minutes after three skips within 3 seconds each.
   The first two are sanctions like a moderator's (E1): written to the audit log by "the system",
   shown to the person with the reason and the end time, and visible under Account standing.
7. **Sharing (RAND-08).** "Share profiles" and "Add contact" do nothing until both people asked
   for the same thing. Then each sees the other's nickname and picture (never a real name), and
   for a contact each is stored in the other's contacts.
8. **Guests (RAND-10).** A visitor without an account can start from the home page: accepting the
   gate creates a guest account that can only use random chat, at half the message rate and
   without sharing. A paused guest is also kept out by a keyed hash of their network address, so
   making a new guest account does not help.
9. **The way into the community (RAND-09).** When a chat ends, public rooms about the shared
   interests are suggested (then the busiest rooms). Opening one and joining it raises two
   counters that hold a day, a name and a number, and nothing about who did it.
10. **The kill switch (RAND-11).** `RANDOM_MODE_ENABLED=false` in both apps hides the links,
    shows "Random chat is switched off" and makes the realtime server refuse every random event.

**The web pages:** `/app/random` for signed-in people (on the app's one live connection) and
`/random` for guests (their own connection). Four screens: the lobby (interests, start, the pause
notice), the search (time waited, "Widening the search to everyone" after 10 seconds, cancel),
the chat, and the end screen (why it ended, new chat, report, suggested rooms). The rules of the
screens are a pure function with tests (`apps/web/src/lib/random/state.ts`). Nothing of a chat
is kept in the browser.

### Decisions

D-048 (matching, the relay, endings, one tab, one instance), D-049 (what is refused and recorded,
automatic pauses, network address hash), D-050 (gate, guests, kill switch, counters). All marked
for the owner's review.

### Problems and fixes

- **A newcomer would have lost their chance of a shared-interest match.** The design said someone
  who has waited 10 seconds is paired with anyone, which includes a person who joined a second
  ago. The matcher now pairs two people without a shared interest only when both are open to
  anyone (D-048).
- **A filter flag would have stored random-chat text.** The data model gave flags an excerpt. For
  random mode the flag is stored without the text; the text is only ever in a report (D-049).
- **Two automatic pauses at the same moment** could both have been stored. The function locks the
  person's row first and adds nothing when a pause at least as long is in force.
  `applySanction` was split so the same code runs inside that transaction.
- **A chat ended by a report had no end time in its evidence**, because the end was written to the
  database in the background. A report now waits for that write.
- **Tests opened more connections than one address may** (20 at once, 30 a minute, working as
  designed): the random-mode test servers raise those caps; the caps keep their own tests.
- **One test was paired with a person left waiting by an earlier test.** Tests now leave the queue
  when they are done, and that test checks what it means (never paired with the person who left).
- **The pause notice said the same thing twice** (seen in a screenshot): "paused until ...
  Reason: ... paused for 24 hours". The automatic reasons now only say why.
- **The end screen forgot the contact just added and showed an empty message box** (seen in a
  screenshot). It now says "You and <name> are now contacts" and hides the box when there were no
  messages.
- **A long shell command with apostrophes failed again** (as the notes warned); patch scripts were
  written as files.

### Tests run, with actual results

| What                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                  | 13/13 tasks. shared 317, db 181, realtime 124 (+2 Redis tests that run in CI), web 268.                                                                                                                                                                                                                                                                                                                                                                              |
| The same on PostgreSQL 17.9                   | db 181, realtime 124 (+2 skipped), web 268, with `TEST_DATABASE_URL`.                                                                                                                                                                                                                                                                                                                                                                                                |
| Links and contact details (`contact.test.ts`) | 66 tests: 19 links with disguises, 20 emails, phone numbers and usernames, 26 ordinary sentences let through, speed on hostile input.                                                                                                                                                                                                                                                                                                                                |
| Matcher (`matcher.test.ts`)                   | 15 tests: shared interests first, most shared, longest wait, fallback only after 10 seconds, a newcomer keeps their own 10 seconds, blocks, the 10-minute rule, 500 people in a queue.                                                                                                                                                                                                                                                                               |
| Database (`random.test.ts`, db)               | 25 tests: gate, metadata without a text column, reports and their evidence, counting different reporters, automatic pauses, the network-address pause, contacts, suggestions, counters, deletion after 30 days.                                                                                                                                                                                                                                                      |
| Live (`random.test.ts`, realtime)             | 37 tests with real sockets on four test servers: gate, matching, relay, refusals, the filter, skip, end, cooldown, reports, three reports, sharing, guests, reconnect, moderators and blocks, metrics, evidence lifetime, silence, shutdown, kill switch.                                                                                                                                                                                                            |
| Do the tests have teeth?                      | With the link and contact check switched off, 5 tests fail; with the block check in the matcher switched off, 4 tests fail. Both restored.                                                                                                                                                                                                                                                                                                                           |
| Browser rules (`state.test.ts`, web)          | 18 tests: screens, messages while sending and after, events of another chat ignored, offers, endings, reconnect.                                                                                                                                                                                                                                                                                                                                                     |
| End-to-end (Playwright, Chromium)             | 21/21 in 2.7 min. Three new tests for journey J7: the gate, a shared-interest match while someone else waits, links refused, a masked word, a report whose evidence is the server's record and no chat text anywhere else in the database; the random match after 9 seconds or more, add contact only when both ask, a suggested room opened and joined with both counters going up, the pause notice with its end time; a guest from the home page with no sharing. |
| Kill switch in the web app                    | Production build started with `RANDOM_MODE_ENABLED=false`: `/random` shows "Random chat is switched off" and no gate; the home page has no guest link.                                                                                                                                                                                                                                                                                                               |
| Screenshots inspected (`E2E_SHOTS=1`)         | Gate, lobby, search, chat with refused links and a masked word, report form, end screen with suggestions, pause notice, guest gate and guest chat. Two faults found and fixed (above).                                                                                                                                                                                                                                                                               |

### What E2 leaves for later

- **The daily job that deletes chat metadata after 30 days** is E5; the function it will call
  (`deleteOldRandomSessions`) exists and is tested.
- **Reports of random chats are stored but nobody can read them in the app** until the moderation
  dashboard (E3), which must show the evidence of the new kind (`kind: 'random_session'`).
- **`random_guest_signed_up`** (a guest who creates an account) is not counted (D-050).
- **Random mode assumes one realtime instance** (D-048).
- **The three-reports rule in a real browser:** the rule itself is tested on live connections;
  the browser journey applies the same pause through the database function and checks what the
  person sees.
- **Legal pages** linked from the gate come with E5 (SAFE-03).

## What comes next

E3: the moderation dashboard (queues for reports and flags, including reports of random chats;
the actions that call `sanctionUser` and `liftUserSanction`; removing and restoring messages;
how the first administrator is made). Then E4 (AI moderation) and E5 (legal pages, account
deletion, export, the daily retention job).
