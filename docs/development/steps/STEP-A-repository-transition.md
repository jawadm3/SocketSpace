# Step A: Environment check, repository transition and monorepo skeleton

- **Date:** 2026-10-01
- **Status:** Done locally. Pushing to GitHub is waiting for the owner (see "Problems and fixes").

## Goal

1. Check what tools the laptop has.
2. Preserve v1 in a `v1/` folder and tag it, so v2 can be built at the repository root.
3. Move the master brief into the repository.
4. Set up `CLAUDE.md`, `PROGRESS.md` and an empty but working monorepo skeleton.

## What was found on the laptop

| Tool              | Version          | Notes                                                     |
| ----------------- | ---------------- | --------------------------------------------------------- |
| Windows 11 Home   | 10.0.26200       | No WSL, no Docker Desktop (as the brief says).            |
| Node.js           | 22.13.0          | In `C:\Program Files\nodejs`. Meets every tool's minimum. |
| npm               | 11.0.0           | Not used for v2 (pnpm is used instead).                   |
| pnpm              | 12.8.1           | Installed globally. Chosen package manager.               |
| corepack          | 0.30.0           | Not needed (pnpm is already installed).                   |
| Git               | 2.43.0.windows.1 | Credential helper: Git Credential Manager.                |
| GitHub CLI (`gh`) | 2.102.0          | Installed but **not logged in**.                          |
| gitleaks          | not installed    | Needed for secret scanning; planned for Stage C.          |
| Python            | 3.13.2           | Not needed so far.                                        |

Latest versions on the npm registry on 2026-10-01 (used to plan the stack): Next.js 16.3.8,
React 19.3.0, Tailwind CSS 4.3.3, TypeScript 7.0.2 (we use 6.0.3, see decision D-004),
ESLint 10.11.0, Vitest 5.0.3, Playwright 1.63.0, Zod 4.6.5, Socket.IO 4.8.4, Drizzle ORM 0.45.3,
Prisma 8.0.0-rc.19 (release candidate on the `latest` tag; last stable 7.10.0), Better Auth 1.7.7.

## What was built, and how it works

### 1. The repository transition

Think of this like moving the contents of an old room into a labelled box in the corner before
redecorating. Nothing is thrown away, and a photo (the tag) records exactly how the room looked.

1. **Checked the starting point.** The working tree was clean and local `main` matched GitHub
   (both at `f7a75a3`).
2. **Remote URL.** The brief asks to point `origin` at `https://github.com/jawadm3/SocketSpace.git`
   (the repository was renamed from `SocketSpace-react`). This step was **blocked** by the
   assistant's safety system and has been left for the owner. See "Problems and fixes".
3. **Tag.** Created an _annotated tag_ `v1.0.0` on commit `f7a75a3`, with a message describing it
   as the original mini-project version. (An annotated tag is a permanent, named bookmark with a
   note attached.) It exists locally and will be pushed once the remote question is settled.
   A GitHub Release was **not** created: the `gh` tool is not logged in, and logging in would
   need new credentials. The owner's steps are in `PROGRESS.md`.
4. **Deleted regenerable folders**: `node_modules`, `.next`, plus the generated `next-env.d.ts`
   and `tsconfig.tsbuildinfo`.
5. **Moved v1** with `git mv`: all 25 tracked files except `LICENSE` went into `v1/`. Git
   recorded every one as a rename (`R`), so history follows them.
6. **Wrote `v1/README_V1.md`**: what v1 was, how v2 differs, the verified v1 problems, and that
   the `v1.0.0` tag is the canonical snapshot.
7. **Excluded v1 from v2 tools**: see "Tests run" below for proof.
8. **Committed** as `6de4fb2 chore: move v1 into v1/ folder`.

### 2. The brief

Moved `D:\mini project\SocketSpace_v2_BRIEF.md` to `docs/BRIEF.md`, unchanged (SHA-1
`35f17631406d5c25f236486e8ab6c5a4291c6615`). Started `docs/BRIEF_CHANGES.md` to log future changes.

### 3. The monorepo skeleton

A _monorepo_ is one repository that holds several related projects (here: the web app, the
real-time server and shared libraries), like one toolbox with labelled trays.

- `pnpm-workspace.yaml` lists the trays: `apps/*` and `packages/*`. **v1 is not listed.** It also
  keeps pnpm's store inside the project (decision D-002) and sets a 3-day supply-chain guard (D-003).
- `turbo.json` tells Turborepo how to run tasks (`build`, `lint`, `typecheck`, `test`, `dev`) in
  every package, in the right order, skipping work that has not changed.
- `packages/config/tsconfig.base.json` holds strict TypeScript settings that every package extends.
- `eslint.config.mjs` (lint rules), `.prettierrc.json` (formatting), `.editorconfig`,
  `.gitattributes` (LF line endings), `.node-version` (Node 22), `vitest.config.ts` (runs every
  package's tests from the root).
- Placeholder packages with a `package.json` and `README.md`: `apps/web`, `apps/realtime`,
  `packages/db`, `packages/ui`. They are deliberately empty: the stack is decided in Stage B.
- `packages/shared` contains one tiny module and one test. Its only job right now is to prove that
  the workspace, TypeScript, ESLint, Vitest and Turborepo all work together.
- Root ignore files that keep v1 out: `.dockerignore`, `.vercelignore`, `.prettierignore`.

## Decisions and why

Recorded in full in `docs/development/decisions.md`:

- D-001 keep v1 in `v1/` via `git mv`, with a pure-rename commit.
- D-002 pnpm store inside the project folder.
- D-003 3-day supply-chain guard (`minimumReleaseAge`).
- D-004 TypeScript 6.0, because `typescript-eslint` does not support 7.0 yet.
- D-005 Node.js 22 LTS as the baseline everywhere.
- D-006 one root ESLint config with v1 ignored.
- D-007 pnpm settings in `pnpm-workspace.yaml`.

## Problems and fixes

| Problem                                                     | What happened                                                                                                          | Fix or status                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Changing the git remote URL was blocked                     | The assistant's automatic safety check refused `git remote set-url origin https://github.com/jawadm3/SocketSpace.git`. | Not worked around. Left for the owner. No pushes have been made, so nothing has gone to GitHub yet. |
| GitHub Release for v1.0.0                                   | `gh` is not logged in; logging in needs credentials.                                                                   | Owner steps are in `PROGRESS.md`.                                                                   |
| Root `.gitignore` would have lost v1 history                | Creating a new root `.gitignore` in the move commit made git treat the old one as edited, not moved.                   | Removed the new file from the move commit; added it in the next commit (D-001).                     |
| pnpm auto-exempted brand-new packages from its safety guard | Asking for exact newest versions (published hours earlier) made pnpm add exemptions.                                   | Removed the exemptions, set the guard explicitly to 3 days, used loose version ranges, reinstalled. |
| `stateDir` ignored                                          | pnpm 12 only accepts this setting machine-wide.                                                                        | Removed from the project file; documented as a 1 KB C: exception in `docs/technical/storage.md`.    |
| TypeScript 7 incompatible with lint tooling                 | `typescript-eslint` peer range is `<6.1.0`.                                                                            | Pinned TypeScript 6.0.x (D-004).                                                                    |

## Tests run, with actual results

All commands run from the repository root on 2026-10-01.

| Check                        | Command                                                | Result                                                                                                                   |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Whole pipeline               | `pnpm check` (Turborepo: lint + typecheck + test)      | 3 of 3 tasks successful; Vitest: 1 test file, 1 test passed.                                                             |
| Workspace excludes v1        | `pnpm ls -r --depth -1`                                | 7 entries: root, `apps/realtime`, `apps/web`, `packages/config`, `packages/db`, `packages/shared`, `packages/ui`. No v1. |
| Turborepo excludes v1        | `turbo run ...` scope line                             | "Packages in scope: @socketspace/config, db, realtime, shared, ui, web". No v1.                                          |
| Type checking excludes v1    | `tsc -p tsconfig.json --listFilesOnly \| grep -c /v1/` | `0`                                                                                                                      |
| Tests exclude v1             | `vitest list` (root, all projects)                     | Only `[@socketspace/shared] src/index.test.ts`.                                                                          |
| Linting excludes v1          | `eslint .` and `eslint . --debug \| grep v1/`          | Exit 0; no v1 paths opened.                                                                                              |
| Formatting excludes v1       | `prettier --file-info v1/src/app/page.tsx`             | `{ "ignored": true }`                                                                                                    |
| Formatting of v2 files       | `prettier --check .`                                   | "All matched files use Prettier code style!"                                                                             |
| Docker and Vercel exclude v1 | `.dockerignore`, `.vercelignore`                       | Both list `v1/`. Docker images are built in CI from Stage C, where this is tested.                                       |
| History follows moved files  | `git log --follow --oneline -- v1/server.js`           | Shows the move commit and the original commit `0ef4f61 connectivity done`.                                               |
| Package store location       | `pnpm install` output                                  | "Content-addressable store is at: D:\mini project\socketspace\./.pnpm-store\v11"                                         |

### Evidence gathered for Stage B (before `node_modules` was deleted)

While v1's dependencies were still installed, v1 was run and checked. The full write-up is in
`docs/analysis/v1-analysis.md` (Stage B). In short:

- Three clients connected to v1's server; client A sent a message; **both B and C received it**
  (broadcast to everyone, not 1-to-1). A 100,000-character message with an extra field was also
  passed on unchanged.
- A WebSocket connection claiming to come from `https://evil.example` was **accepted**.
- `tsc --noEmit` passed; `next lint` reported 2 errors; **`next build` failed** (exit code 1)
  because of those lint errors.

## What comes next

Stage B: critical analysis of v1 and the brief, product design, architecture, data model, event
contracts, security and safety design, free-tier research with numbers, requirements matrix and
acceptance criteria, and 2 to 3 visual directions. Then stop for the owner's approval.
