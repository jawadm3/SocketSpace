# Where SocketSpace keeps files on this laptop

The development laptop has a small, busy C: drive and a larger D: drive. The brief asks us to keep
everything for this project on D: where the tools allow it, and to list anything that cannot be moved.

Think of it like keeping all the parts for one hobby project in one box on one shelf, instead of
leaving bits in every room of the house.

## What lives on D: (inside the project folder)

| What                     | Where                                      | Why it is here                                                                                                                                        |
| ------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source code, docs, tests | `D:\mini project\socketspace\`             | The project itself.                                                                                                                                   |
| pnpm package store       | `D:\mini project\socketspace\.pnpm-store\` | pnpm downloads each package version once into this "store" and links it into `node_modules`. Set by `storeDir` in `pnpm-workspace.yaml`. Git-ignored. |
| pnpm metadata cache      | `D:\mini project\socketspace\.cache\pnpm\` | pnpm's cache of registry information. Set by `cacheDir` in `pnpm-workspace.yaml`. Git-ignored.                                                        |
| Installed packages       | `node_modules\` folders                    | Links into the store. Regenerable with `pnpm install`. Git-ignored.                                                                                   |
| Turborepo cache          | `.turbo\` folders                          | Remembers task results so unchanged work is skipped. Git-ignored.                                                                                     |
| Vitest/Vite cache        | `node_modules\.vite\`                      | Test runner cache. Regenerable.                                                                                                                       |
| Playwright browsers      | `.cache\ms-playwright\`                    | The browser the end-to-end tests drive. `scripts/tools/playwright.mjs` sets `PLAYWRIGHT_BROWSERS_PATH` to this folder. Git-ignored.                   |
| Local PostgreSQL         | `.cache\postgres\17\`                      | Data folder and log of the development database (`pnpm db:start`, decision D-026). Delete it (with the server stopped) to start from empty.           |
| gitleaks                 | `.cache\tools\gitleaks-8.30.1\`            | The secret scanner, downloaded once and checked against a pinned SHA-256 (`scripts/tools/gitleaks.mjs`). Only the program is kept, not the download.  |
| Local mail folders       | `.cache\dev-mail\`, `.cache\e2e-mail\`     | Emails "sent" during development and end-to-end tests are saved here as files instead of being sent (the file mail catcher, `/dev/mail`).             |

### Measured sizes (2026-10-02, end of Stage C)

Measured with `du -sh` in Git Bash. Everything in `.cache` is regenerable.

| Folder                  | Size   | Notes                                                                            |
| ----------------------- | ------ | -------------------------------------------------------------------------------- |
| `.cache\ms-playwright\` | 707 MB | Chromium only (`pnpm --filter @socketspace/web e2e:install`).                    |
| `.cache\pnpm\`          | 367 MB | pnpm's registry metadata cache.                                                  |
| `.cache\postgres\`      | 123 MB | Grows as tests create and drop databases; was 75 MB at the end of session 2.     |
| `.cache\tools\`         | 22 MB  | gitleaks only. Was 30 MB while the downloaded archive was also kept (see D-035). |
| `.cache\e2e-mail\`      | 28 KB  | 6 test emails from the last end-to-end run.                                      |

Why the store is _inside_ the project folder: the brief only authorises creating files inside
`D:\mini project\socketspace\`. pnpm's default for a project on D: would be `D:\.pnpm-store`,
which is outside that folder. Keeping it inside the project costs nothing except that a second
clone of the repository would have its own store.

## Unavoidable exceptions (on C:)

Measured on 2026-10-01 during Stage A.

| What                         | Where                                           | Size                                                                        | Why it is on C:                                                                                                                                                 | Can it move?                                                                                                                               |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js 22.13.0              | `C:\Program Files\nodejs\`                      | (system install)                                                            | Installed before this project.                                                                                                                                  | Only by reinstalling Node, which is a system change for the owner.                                                                         |
| pnpm 12.8.1 (global command) | `C:\Users\jawad\AppData\Roaming\npm\`           | small                                                                       | Installed before this project with npm.                                                                                                                         | Same as above.                                                                                                                             |
| pnpm state file              | `C:\Users\jawad\AppData\Local\pnpm-state\`      | 1 KB                                                                        | pnpm stores "when did I last check for updates" here. pnpm 12 refuses to read this setting from the project file and says it must be set for the whole machine. | **Moved by the owner on 2026-10-02** to `D:/mini project/.pnpm-state` (a machine-wide setting). The old 51-byte copy on C: can be deleted. |
| npm cache                    | `C:\Users\jawad\AppData\Local\npm-cache\`       | 339 MB (already existed, last changed 2025-09-15 before this project began) | `npm view` registry lookups during Stage A read and may add small entries here.                                                                                 | We use `pnpm` for everything from now on. The existing cache is not ours to delete.                                                        |
| Next.js telemetry setting    | `C:\Users\jawad\AppData\Roaming\nextjs-nodejs\` | 1 KB (already existed, from v1 in 2025)                                     | Next.js records whether telemetry is on.                                                                                                                        | Avoid new writes with `NEXT_TELEMETRY_DISABLED=1`.                                                                                         |
| Git credentials              | Windows Credential Manager                      | n/a                                                                         | Git Credential Manager stores the GitHub login securely in Windows.                                                                                             | No, and we never touch it.                                                                                                                 |
| Temporary files              | `%TEMP%`                                        | varies                                                                      | Some tools write short-lived temp files to the system temp folder.                                                                                              | Not reliably. They are cleaned by Windows.                                                                                                 |

**Re-checked on 2026-10-02 (end of Stage C):** nothing new on C:. Playwright's default browser
folder (`%LOCALAPPDATA%\ms-playwright`) and Turborepo's default cache folders do not exist; the pnpm
state file is still 1 KB; the Next.js telemetry file has not changed since 2025. The only other
cache in the user folder (`%USERPROFILE%\.cache\torch`, 45 MB) dates from January 2025 and belongs
to another project.

## Good habits for every session

- Use `pnpm`, never `npm` or `npx`, so caches stay in the project.
- In the shell, set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1`.
- Generated folders (`node_modules`, `.next`, `.turbo`, `.cache`, `.pnpm-store`) can be deleted at any time and rebuilt with `pnpm install` and `pnpm build`.
