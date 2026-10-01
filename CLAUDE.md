# CLAUDE.md: SocketSpace v2

## Read these first, every session

1. `docs/BRIEF.md`: the master brief. It is the source of truth. If anything conflicts with it, the brief wins unless the owner changes it (changes are logged in `docs/BRIEF_CHANGES.md`).
2. `PROGRESS.md`: current stage, what is done and verified, known problems, and the exact next step.
3. `qa/requirements_matrix.md`: every requirement, its status and its evidence (created in Stage B).

After context compaction or in a new session, re-read all three before doing anything else.

## What this project is

SocketSpace v1 was a university mini project: a Next.js page plus a Socket.IO server that sent every message to everyone. It is archived, unchanged, in `v1/` (tag `v1.0.0`).

SocketSpace v2 is a production-grade real-time chat platform built at the repository root:

- **Community mode** (the main product): accounts, profiles, public and private rooms, direct messages, rich messaging, presence, history, search, notifications.
- **Random-match mode**: an optional, 18+, text-only "talk to someone new" mode with strong safety controls.
- **Administration**: a moderation dashboard with an audit log.

It must run on free hosting tiers only.

## Folder map

```
.
├── apps/
│   ├── web/          Web app (Next.js). Placeholder until Stage C.
│   └── realtime/     Long-running real-time server. Placeholder until Stage C.
├── packages/
│   ├── config/       Shared tool config (tsconfig.base.json; later ESLint/Tailwind presets).
│   ├── shared/       Shared contracts: every real-time event and API payload, validated on both ends.
│   ├── db/           Database schema, migrations, typed queries. Placeholder until Stage C.
│   └── ui/           Design system tokens and components. Placeholder until Stage C/F.
├── docs/             All documentation (plain English). BRIEF.md lives here.
│   ├── analysis/     Stage B critical analysis of v1 and the brief.
│   ├── architecture/ System design, data model, event contracts, diagrams.
│   ├── design/       Product design, screens, visual directions.
│   ├── development/  decisions.md and per-stage step logs (steps/STEP-<letter>-<name>.md).
│   ├── technical/    Technical notes (storage.md: what lives on which drive).
│   └── glossary.md   Every technical term explained with an everyday example.
├── qa/               Requirements matrix, acceptance criteria, test evidence.
├── v1/               Archived v1. NEVER touched by v2 tooling. Do not edit.
├── CLAUDE.md         This file.
└── PROGRESS.md       Live status. Update after every meaningful chunk of work.
```

## Commands

Run from the repository root. Package manager is **pnpm** (not npm, not npx).

| Command                                      | What it does                                                |
| -------------------------------------------- | ----------------------------------------------------------- |
| `pnpm install`                               | Install all dependencies (store is `./.pnpm-store`, on D:). |
| `pnpm check`                                 | Lint, type-check and test every package (via Turborepo).    |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | One of the above on its own.                                |
| `pnpm build`                                 | Build every package.                                        |
| `pnpm format` / `pnpm format:check`          | Format with Prettier / check formatting.                    |

Set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1` in the shell to avoid tools writing telemetry config to C:.

## Conventions

- **TypeScript strict** everywhere (`packages/config/tsconfig.base.json`). Use **TypeScript 6.0.x**, not 7.x: `typescript-eslint` does not support TypeScript 7 yet (peer range `<6.1.0`).
- **Node.js 22 LTS** (local machine has 22.13.0). Docker images and CI use Node 22 too.
- **Conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`). End commit messages with the attribution line given in the session.
- **Formatting**: Prettier (single quotes, semicolons, trailing commas, 100 columns, LF line endings).
- **Supply-chain guard**: `minimumReleaseAge: 4320` in `pnpm-workspace.yaml` (only packages public for 3+ days). Use loose version ranges so pnpm can pick a mature version. Do not add exemptions without recording why in `docs/development/decisions.md`.
- **Documentation** is written for a non-specialist: plain English, short sentences, every term explained, new terms added to `docs/glossary.md`.
- **Version-specific tool docs**: tool behaviour may differ from memory. Before changing tool config, check the installed version's own docs or schema (for example `node_modules/turbo/docs/` and `node_modules/turbo/schema.json`). Turborepo's auto-generated `AGENTS.md` is switched off (`"agentGuidance": false` in `turbo.json`); this file is the single source of agent guidance.
- **Never invent** test results, measurements, users or history. Record real output as evidence.

## Architecture rules

These are the rules that hold regardless of the final stack (the stack itself is decided in Stage B):

- Every real-time event and API payload is defined once in `packages/shared` and validated on **both** ends.
- Every socket connection is authenticated, and every event is authorised (for example, room membership is checked on every message).
- No hardcoded URLs, origins or ports. Everything comes from environment variables, validated at startup.
- User content is never rendered as raw HTML. Link previews are fetched server-side with SSRF protection.
- Messages are sent with client-generated IDs so retries never create duplicates.
- Heavy animation only on marketing pages. In the app, motion is subtle (150 to 250 ms).

## Hard rules (security and authority)

- **Never read `.env` files** and never handle secret values. Only `.env.example` (names and descriptions, no values) is committed.
- **Never create accounts** on external services. Give the owner exact step-by-step instructions instead.
- **Free tiers only.** No spending.
- Work only inside `D:\mini project\socketspace\`. Keep tools and caches on D: (see `docs/technical/storage.md`).
- **v1/ is excluded** from all v2 tooling: workspace, lint, type checks, tests, builds, Docker, deployments. Never add it back.
- Git: commit and push to `main` after milestones; never force-push, never rewrite pushed history, never push secrets.
- One mandatory approval stop: after Stage B. After approval, continue without asking for routine decisions.
- Parallel agents only for bounded, independent work. Describe their reviews as "a separate agent with an independent context, same underlying model".
