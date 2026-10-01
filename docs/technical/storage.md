# Where SocketSpace keeps files on this laptop

The development laptop has a small, busy C: drive and a larger D: drive. The brief asks us to keep
everything for this project on D: where the tools allow it, and to list anything that cannot be moved.

Think of it like keeping all the parts for one hobby project in one box on one shelf, instead of
leaving bits in every room of the house.

## What lives on D: (inside the project folder)

| What                        | Where                                      | Why it is here                                                                                                                                        |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source code, docs, tests    | `D:\mini project\socketspace\`             | The project itself.                                                                                                                                   |
| pnpm package store          | `D:\mini project\socketspace\.pnpm-store\` | pnpm downloads each package version once into this "store" and links it into `node_modules`. Set by `storeDir` in `pnpm-workspace.yaml`. Git-ignored. |
| pnpm metadata cache         | `D:\mini project\socketspace\.cache\pnpm\` | pnpm's cache of registry information. Set by `cacheDir` in `pnpm-workspace.yaml`. Git-ignored.                                                        |
| Installed packages          | `node_modules\` folders                    | Links into the store. Regenerable with `pnpm install`. Git-ignored.                                                                                   |
| Turborepo cache             | `.turbo\` folders                          | Remembers task results so unchanged work is skipped. Git-ignored.                                                                                     |
| Vitest/Vite cache           | `node_modules\.vite\`                      | Test runner cache. Regenerable.                                                                                                                       |
| Future: Playwright browsers | `.cache\ms-playwright\` (planned)          | Will be set with `PLAYWRIGHT_BROWSERS_PATH` when end-to-end tests arrive.                                                                             |

Why the store is _inside_ the project folder: the brief only authorises creating files inside
`D:\mini project\socketspace\`. pnpm's default for a project on D: would be `D:\.pnpm-store`,
which is outside that folder. Keeping it inside the project costs nothing except that a second
clone of the repository would have its own store.

## Unavoidable exceptions (on C:)

Measured on 2026-10-01 during Stage A.

| What                         | Where                                           | Size                                                                        | Why it is on C:                                                                                                                                                 | Can it move?                                                                                                                                       |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 22.13.0              | `C:\Program Files\nodejs\`                      | (system install)                                                            | Installed before this project.                                                                                                                                  | Only by reinstalling Node, which is a system change for the owner.                                                                                 |
| pnpm 12.8.1 (global command) | `C:\Users\jawad\AppData\Roaming\npm\`           | small                                                                       | Installed before this project with npm.                                                                                                                         | Same as above.                                                                                                                                     |
| pnpm state file              | `C:\Users\jawad\AppData\Local\pnpm-state\`      | 1 KB                                                                        | pnpm stores "when did I last check for updates" here. pnpm 12 refuses to read this setting from the project file and says it must be set for the whole machine. | Yes, by the owner: `pnpm config set --global state-dir "D:/mini project/.pnpm-state"`. This changes machine settings, so it is the owner's choice. |
| npm cache                    | `C:\Users\jawad\AppData\Local\npm-cache\`       | 339 MB (already existed, last changed 2025-09-15 before this project began) | `npm view` registry lookups during Stage A read and may add small entries here.                                                                                 | We use `pnpm` for everything from now on. The existing cache is not ours to delete.                                                                |
| Next.js telemetry setting    | `C:\Users\jawad\AppData\Roaming\nextjs-nodejs\` | 1 KB (already existed, from v1 in 2025)                                     | Next.js records whether telemetry is on.                                                                                                                        | Avoid new writes with `NEXT_TELEMETRY_DISABLED=1`.                                                                                                 |
| Git credentials              | Windows Credential Manager                      | n/a                                                                         | Git Credential Manager stores the GitHub login securely in Windows.                                                                                             | No, and we never touch it.                                                                                                                         |
| Temporary files              | `%TEMP%`                                        | varies                                                                      | Some tools write short-lived temp files to the system temp folder.                                                                                              | Not reliably. They are cleaned by Windows.                                                                                                         |

## Good habits for every session

- Use `pnpm`, never `npm` or `npx`, so caches stay in the project.
- In the shell, set `TURBO_TELEMETRY_DISABLED=1` and `NEXT_TELEMETRY_DISABLED=1`.
- Generated folders (`node_modules`, `.next`, `.turbo`, `.cache`, `.pnpm-store`) can be deleted at any time and rebuilt with `pnpm install` and `pnpm build`.
