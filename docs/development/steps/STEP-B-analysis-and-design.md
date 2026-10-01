# Step B: Analysis, product design, architecture and plan

- **Date:** 2026-10-01
- **Status:** Complete, **waiting for the owner's approval** (the brief's one mandatory stop).

## Goal

Before writing any product code: analyse v1 and the brief critically, research free tiers with real
numbers, design the product, architecture, data model, event contracts, security and safety,
present visual directions, and write the requirements matrix and acceptance criteria.

## What was produced, and where

| Deliverable                                                                                                           | File(s)                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| v1 analysis: brief's 8 findings verified, 24 new findings, all with evidence                                          | `docs/analysis/v1-analysis.md`, `docs/analysis/evidence/`  |
| Critique of the brief: what's right, free-tier reality, gaps, risks, MoSCoW priorities, owner decisions               | `docs/analysis/brief-critique.md`                          |
| Free-tier research with numbers, calculations and sources                                                             | `docs/research/free-tier-research.md`                      |
| Technology stack with alternatives and reasons                                                                        | `docs/architecture/stack.md`                               |
| System overview with diagram, responsibilities, configuration, scaling, failure behaviour                             | `docs/architecture/system-overview.md`                     |
| Data model: ER diagram, every table, ordering and idempotency, retention                                              | `docs/architecture/data-model.md`                          |
| Real-time protocol: every event, acks, delivery states, resync, random matching, moderation flow, rate limits         | `docs/architecture/realtime-protocol.md`                   |
| Security, trust and safety design (STRIDE, ASVS 5.0 chapters, controls, safety features, legal note)                  | `docs/architecture/security.md`                            |
| Product design: people, information architecture, app shell, screen inventory with states, flows, accessibility rules | `docs/design/product.md`                                   |
| Three visual directions: live HTML mockups with Canvas heroes, screenshots, measured contrast                         | `docs/design/visual-directions.md`, `docs/design/mockups/` |
| Requirements matrix (about 150 requirements)                                                                          | `qa/requirements_matrix.md`                                |
| Acceptance criteria: 10 journeys, quality gates, stage exit criteria                                                  | `qa/acceptance_criteria.md`                                |
| Stage plan C to I, owner touchpoints, risk register                                                                   | `docs/development/plan.md`                                 |
| Decisions D-008 (accepted) and D-009 to D-020 (proposed)                                                              | `docs/development/decisions.md`                            |
| Glossary extended with about 35 new terms                                                                             | `docs/glossary.md`                                         |

A comparison page for choosing the visual direction was also published as a private Claude
artifact for the owner: https://claude.ai/artifact/Pcmh1ZKP5tKxSvRaVsPdF1

## How the main conclusions were reached

1. **Run v1, don't just read it.** While v1's dependencies were still installed (Stage A), three
   Socket.IO clients were connected to v1's server. The output proved the broadcast bug and showed
   that oversized and malformed payloads pass through, that a foreign origin is accepted, and that
   `next build` fails. Raw output is saved in `docs/analysis/evidence/`.
2. **Do the free-tier maths.** Official pricing and documentation pages were fetched on
   2026-10-01. Two calculations changed the brief's defaults:
   - Neon: always-on at 0.25 CU = 186 CU-hours per month against 100 free, so no permanent database
     connections (and therefore no Postgres LISTEN/NOTIFY).
   - Upstash: 500,000 commands per month is about 16,100 per day; six users' presence heartbeats
     alone would use it. So no Redis on the free deployment.
     Others: R2 needs a card (so Vercel Blob), Resend needs a verified domain (owner decision), Koyeb,
     Northflank and Fly.io need cards (so Render), Cloudflare Durable Objects documented as the best
     alternative.
3. **Check versions and compatibility from the source.** npm registry dist-tags, engines and peer
   ranges (for example TypeScript 7 vs `typescript-eslint`'s `<6.1.0`), Next.js 16 release notes,
   and the official OWASP ASVS 5.0 chapter list.
4. **Design visual directions as working code.** Each direction is a real HTML page with a working
   Canvas 2D hero, rendered to PNG with headless Microsoft Edge (already on the laptop).

## Decisions and why

Recorded in `docs/development/decisions.md` (D-009 to D-020, all "Proposed" until approval). The
headline changes from the brief's defaults: no Redis on the free tier (D-010), Vercel Blob instead
of R2 (D-013), Canvas 2D first for the hero (D-015), Drizzle over Prisma (D-011), a Node load
harness instead of k6 (D-019).

## Problems and fixes

| Problem                                            | What happened                                                                                                                                         | Fix                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Remote URL change blocked, then allowed            | The assistant's safety check blocked `git remote set-url`; the owner replied "Try again".                                                             | Retried successfully; pushed `main` and `v1.0.0` (fast-forward, quick secret check first).                                          |
| Headless Edge produced no screenshot from Git Bash | Windows paths with spaces were mangled when passed from the POSIX shell.                                                                              | Ran Edge from PowerShell with `Start-Process`; worked first time.                                                                   |
| Mockup composer pushed out of the app window       | Flex/grid children default to `min-height: auto`, so the message list grew instead of shrinking.                                                      | Added `min-height: 0` to the message list and the conversation column; re-rendered.                                                 |
| Unmeasured numbers in mockup copy                  | Mockup A's hero said "<100 ms delivery" and "0 messages lost". Nothing has been measured yet.                                                         | Replaced with non-numeric wording, in line with "never invent measurements".                                                        |
| Two directions looked generic                      | A design self-review found B (cream, serif, terracotta) and C (purple-pink gradient with a common geometric font) close to very common current looks. | B rebuilt as "Airmail" (navy ink, airmail red/blue stripes, Bricolage Grotesque, Figtree); C's type changed to Unbounded + Manrope. |
| Orbiting avatars crossed C's headline              | Readability suffered.                                                                                                                                 | Added a soft dark glow behind the headline area.                                                                                    |
| Koyeb's pricing page omits the free instance       | Its docs still describe one (512 MB, 0.1 vCPU, sleeps after 1 h) and the pricing FAQ says a card is required.                                         | Reported both, with the card requirement, in the research doc.                                                                      |
| Memory vs source for ASVS chapter numbers          | Three section headings in `security.md` cited the wrong ASVS 5.0 chapter.                                                                             | Checked the official chapter list on GitHub and corrected them.                                                                     |
| Prettier wanted to reformat evidence and mockups   | Evidence scripts and rendered prototypes should stay exactly as captured.                                                                             | Added `docs/analysis/evidence/` and `docs/design/mockups/` to `.prettierignore`.                                                    |

## Tests and checks run, with actual results

| Check                                                              | Result                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1 three-client test (`evidence/v1-broadcast-output.txt`)          | A sent 2 messages; **B and C each received 2**; A received 0; the 100,000-character message and an extra `injected` field were relayed; `id` was `undefined` on receipt                                     |
| v1 foreign-origin test (`evidence/v1-origin-output.txt`)           | `CONNECTED` with `Origin: https://evil.example`                                                                                                                                                             |
| v1 `tsc --noEmit`                                                  | exit 0                                                                                                                                                                                                      |
| v1 `next lint`                                                     | 2 errors (`no-html-link-for-pages`, `layout.tsx` lines 18 and 21)                                                                                                                                           |
| v1 `next build`                                                    | **exit 1**: "Failed to compile" on the same 2 errors                                                                                                                                                        |
| Contrast of mockup colour pairs (WCAG formula, computed with Node) | A: text 16.40, muted 6.06, faint 3.07; B: ink 14.72, muted 5.28, white on red 4.02, white on deeper red 5.22, blue 5.72, red text 3.63; C: text 18.23, muted 8.79, white on violet 5.70, white on pink 3.53 |
| Mockup rendering (headless Edge, 1440 px)                          | 3 PNGs produced (A 568 KB, B 372 KB, C 1,166 KB); each inspected visually and fixed as listed above                                                                                                         |
| `pnpm check` after Stage B                                         | 3 of 3 Turborepo tasks successful; 1 test passed                                                                                                                                                            |
| `prettier --check .`                                               | "All matched files use Prettier code style!"                                                                                                                                                                |

## What comes next

Stop and wait for the owner's approval of the plan and their decisions on: the stack (including
the changes from the brief's defaults), the visual direction (A, B, C or a mix), the email domain,
guest access to random mode, and the priorities and retention periods. After approval: Stage C
(foundations), starting with gitleaks, the database schema and the shared contracts.
