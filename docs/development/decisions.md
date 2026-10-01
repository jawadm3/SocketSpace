# Decision log

Every important decision, in plain English: what we chose, what else we considered, and why.
Newest decisions are added at the bottom. Stage B decisions (the stack) are recorded here once
the owner approves the plan.

Status values: **Accepted** (in force), **Proposed** (waiting for owner approval), **Superseded** (replaced by a later decision).

---

## D-001: Keep v1 in a `v1/` folder, moved with `git mv`

- **Stage:** A. **Status:** Accepted.
- **Decision:** Move every tracked v1 file into `v1/` with `git mv`, keep `LICENSE` at the root, and tag the last v1 commit as `v1.0.0`.
- **Why:** The owner wants v1 kept for comparison. `git mv` lets git recognise the move as a rename, so `git log --follow v1/server.js` still shows the file's full history. The tag is an exact snapshot that never changes.
- **Detail:** The move commit was kept "pure" (only renames plus new v1-only files). The new v2 root `.gitignore` was added in a later commit. If both had gone in one commit, git would have seen the root `.gitignore` as _edited_ instead of _moved_, and v1's `.gitignore` would have lost its history.

## D-002: Keep the pnpm package store inside the project folder

- **Stage:** A. **Status:** Accepted.
- **Decision:** `storeDir: ./.pnpm-store` and `cacheDir: ./.cache/pnpm` in `pnpm-workspace.yaml`.
- **Alternatives:** pnpm's default for a project on D: is `D:\.pnpm-store` (drive root). That is on D: but outside the project folder, which the brief does not authorise.
- **Why:** Keeps everything on D: and inside the authorised folder. The cost is that another clone gets its own store.

## D-003: Supply-chain guard of 3 days

- **Stage:** A. **Status:** Accepted.
- **Decision:** `minimumReleaseAge: 4320` (minutes) in `pnpm-workspace.yaml`. pnpm will only install package versions that have been public for at least 3 days. Version ranges in `package.json` are kept loose (for example `^5`) so pnpm can choose the newest _mature_ version.
- **Why:** Attacks that publish a poisoned version of a popular package are usually spotted and removed within hours. Waiting 3 days avoids almost all of them. During setup, pnpm automatically added exemptions when exact brand-new versions were requested (turbo 2.11.6 was published the same morning). We removed those exemptions and reinstalled (turbo 2.11.5, vitest 5.0.2) instead of weakening the guard.

## D-004: TypeScript 6.0, not 7.0

- **Stage:** A. **Status:** Accepted.
- **Decision:** Use TypeScript `~6.0.2` (installed 6.0.3).
- **Alternatives:** TypeScript 7.0.2 is the npm "latest" release (the new, much faster native compiler).
- **Why:** `typescript-eslint` 8.x, which gives us type-aware lint rules, declares support only for TypeScript `>=4.8.4 <6.1.0`. Using 7.0 would break linting. Revisit when `typescript-eslint` supports 7.x.

## D-005: Node.js 22 LTS as the baseline

- **Stage:** A. **Status:** Accepted (revisit at deployment).
- **Decision:** Require Node `>=22.13.0`; CI and Docker images will use Node 22.
- **Why:** The laptop already has Node 22.13.0, and upgrading Node is a system change that needs the owner. Every chosen tool supports it (ESLint 10 needs `^22.13.0`, Vitest 5 needs `^22.12.0`, Next.js 16 needs `>=20.9.0`). Node 22 is supported until April 2027. Using the same major version locally, in CI and in Docker avoids "works on my machine" problems.

## D-006: One root ESLint flat config, with v1 ignored

- **Stage:** A. **Status:** Accepted.
- **Decision:** A single `eslint.config.mjs` at the root with `globalIgnores(['v1/**', ...])`, strict type-aware rules from `typescript-eslint`, and per-package `eslint .` scripts run by Turborepo.
- **Why:** One place to maintain rules. Verified that `eslint .` from the root never opens a v1 file (checked with `--debug`).
- **Known edge case:** ESLint 10 uses the _nearest_ config file for each file. If someone runs ESLint directly on a file inside `v1/`, ESLint uses v1's own `v1/eslint.config.mjs` (which fails because v1's dependencies are not installed). That is correct behaviour: v1 is a separate project. v2 commands never do this.

## D-007: pnpm settings live in `pnpm-workspace.yaml`

- **Stage:** A. **Status:** Accepted.
- **Decision:** Put pnpm settings in `pnpm-workspace.yaml`, not `.npmrc`.
- **Why:** Tested on pnpm 12.8.1: the workspace file's `storeDir` takes precedence over `.npmrc`. One settings file is simpler. Note: pnpm 12 ignores `stateDir` in this file (it is a machine-wide setting), so it is listed as an exception in `docs/technical/storage.md`.
