# PROGRESS

_Last updated: 2026-10-01 (Stage B approved; Stage C is next)._

## Current stage

**Stage B is approved.** The owner approved the stack on 2026-10-01 and answered the open
decisions. The next stage is **Stage C: foundations**. Per the brief, work now continues without
asking for routine decisions.

## Owner decisions (2026-10-01)

| Topic                 | Decision                                                                                                             | Record                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Stack                 | Approved as proposed (no Redis on free tier, Vercel Blob, Canvas-first hero, Drizzle, etc.)                          | D-009 to D-020               |
| Look                  | All three directions become user-selectable themes (light and dark); **Airmail is the default**                      | D-021                        |
| Sign-in               | Google, Facebook, GitHub first; Discord, Microsoft, LinkedIn, passkeys under "More ways to sign in"; no Apple (paid) | D-022                        |
| Profile pictures      | Required at onboarding: presets, avatar builder, or photo upload; no default avatar                                  | D-023                        |
| Names                 | Unique nickname in chats and @mentions; optional real name, private by default, display choice                       | D-024                        |
| Email                 | Resend with a free is-a.dev subdomain (set up in Stage H)                                                            | D-014                        |
| Random mode           | Guests allowed, with stricter limits                                                                                 | D-025                        |
| Priorities, retention | Not answered separately; proceeding with the proposed values (changeable any time)                                   | brief-critique 5, data-model |

All additions are logged in `docs/BRIEF_CHANGES.md`.

## Done

### Stage A: environment, repository transition, skeleton (2026-10-01)

- Toolchain inspected; `origin` set to `https://github.com/jawadm3/SocketSpace.git`.
- Annotated tag `v1.0.0` on `f7a75a3`, pushed; **GitHub Release published**:
  https://github.com/jawadm3/SocketSpace/releases/tag/v1.0.0 (`gh` was logged out at the start of
  the session and logged in later).
- v1 moved into `v1/` with `git mv`; `v1/README_V1.md`; brief in `docs/BRIEF.md`.
- Monorepo skeleton (pnpm 12, Turborepo 2, TypeScript 6.0 strict, ESLint 10, Prettier, Vitest 5).
- `CLAUDE.md`, storage doc, decisions, glossary, STEP-A log.

### Stage B: analysis and design (2026-10-01)

- v1 analysis with runtime evidence; brief critique; free-tier research with numbers.
- Architecture (stack, system overview, data model, real-time protocol, security and safety).
- Product design; three visual directions (now the three themes) with live mockups.
- Requirements matrix (177 requirements) and acceptance criteria (13 journeys, gates, exit
  criteria); stage plan with risk register; STEP-B log.
- Owner review incorporated (D-021 to D-025) across all documents.

## Verified (with evidence)

| What                                                                        | Evidence                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Pipeline works                                                              | `pnpm check`: 3/3 Turborepo tasks successful; 1 Vitest test passed. |
| v1 excluded from workspace, Turborepo, TypeScript, Vitest, ESLint, Prettier | "Tests run" table in STEP-A.                                        |
| v1 history preserved                                                        | `git log --follow -- v1/server.js` reaches `0ef4f61`.               |
| pnpm store on D: inside the project                                         | store at `D:\mini project\socketspace\.pnpm-store\v11`.             |
| v1 behaviour problems                                                       | Raw outputs in `docs/analysis/evidence/`.                           |
| Stages A and B pushed                                                       | `main` on GitHub; tag `v1.0.0`; release page live.                  |

## In progress

- Nothing. Ready to start Stage C.

## Known problems and things waiting for the owner

1. **pnpm state file on C:** (1 KB). Optional owner fix (machine setting):
   `pnpm config set --global state-dir "D:/mini project/.pnpm-state"`.
2. **gitleaks not installed.** First task of Stage C (portable binary in `.cache/tools`).
3. **Optional for Stage C:** test OAuth apps (for example GitHub, Google) with a `localhost`
   callback, if the owner wants social sign-in tested locally before deployment.

## Exact next step

Start Stage C, milestone C1: gitleaks (portable binary in `.cache/tools`, pre-commit hook, CI job),
`.env.example`, environment validation helper, `CHANGELOG.md`, Playwright browsers path on D:.
Then C2 (Drizzle schema including the D-021 to D-025 user fields, migrations, PGlite tests).

## Effort guide (from Anthropic's Claude Code docs, checked 2026-10-01)

Sources: [Model configuration](https://code.claude.com/docs/en/model-config) and
[Dynamic workflows](https://code.claude.com/docs/en/workflows).

| Setting         | What it is                                                                                                                                                                                                                  | Use it here for                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low             | Quick exchanges you review each time (brainstorming, a rename)                                                                                                                                                              | Quick questions between stages, tiny fixes                                                                                                          |
| Medium          | The default on Opus 5.5 (your slider's "Recommended"); day-to-day work with a clear scope                                                                                                                                   | Stage H (deployment), Stage I (docs), routine follow-ups                                                                                            |
| High            | Work where verification matters or edge cases are likely (bug fixing in existing code)                                                                                                                                      | Stage D (community features), Stage F (themes, home page, accessibility)                                                                            |
| Extra (`xhigh`) | Deeper reasoning at higher token spend                                                                                                                                                                                      | Stage C (auth, database, real-time server, CI), Stage E (random mode, safety, moderation)                                                           |
| Max             | Deepest reasoning, current session only; for hard problems worked through without you, such as finding security vulnerabilities; can overthink                                                                              | Only when Extra gets stuck on a hard bug, or the Stage G security hunt if Ultracode is off                                                          |
| Ultracode       | Not a level: a setting that makes Claude plan a dynamic workflow (many sub-agents, cross-checked) for each substantive task. Uses noticeably more tokens and reaches usage limits sooner; launching with it also sets Extra | Stage G (codebase-wide audits: security, accessibility, test gaps). For a single big fan-out task, start just that prompt with `ultracode:` instead |

| Session  | Stage                               | Effort                                                             |
| -------- | ----------------------------------- | ------------------------------------------------------------------ |
| 1 (done) | A + B: analysis and design          | Ultracode was selected; no workflows were launched in this session |
| 2        | C: foundations                      | Extra                                                              |
| 3        | D: community mode                   | High (Extra if reconnect/resync bugs get subtle)                   |
| 4        | E: random mode and safety           | Extra                                                              |
| 5        | F: themes, home page, accessibility | High                                                               |
| 6        | G: testing, load tests, reviews     | Ultracode (or Max for the security review)                         |
| 7        | H: deployment                       | Medium (High if live debugging)                                    |
| 8        | I: docs, walkthrough, release       | Medium; `ultracode:` prompt for the file-by-file code walkthrough  |
