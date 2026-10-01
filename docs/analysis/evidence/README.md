# Evidence for the v1 analysis

Raw output captured on 2026-10-01, before `node_modules` was deleted in Stage A. At that time v1's
files were still at the repository root (commit `f7a75a3`, tag `v1.0.0`) with v1's own
dependencies installed (Next.js 15.4.4, Socket.IO 4.8.1).

| File                      | What it is                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v1-broadcast-check.js`   | Script: starts v1's `server.js`, connects three clients (A, B, C), and has A send two messages (one normal, one 100,000 characters long with an extra field). |
| `v1-broadcast-output.txt` | Its output: B and C both received both messages; nothing was rejected; the server logged message contents.                                                    |
| `v1-origin-check.js`      | Script: connects to v1's server over WebSocket while claiming to be the website `https://evil.example`.                                                       |
| `v1-origin-output.txt`    | Its output: `CONNECTED`. The CORS setting did not stop it.                                                                                                    |
| `v1-tsc-lint-output.txt`  | `tsc --noEmit` (passed) and `next lint` (2 errors).                                                                                                           |
| `v1-build-output.txt`     | `next build`: compiled, then **failed** on the 2 lint errors (exit code 1).                                                                                   |

To reproduce, check out the tag (`git checkout v1.0.0`), run `npm install`, then run the scripts
with Node.js (the scripts expect the repository at `D:/mini project/socketspace`; change the
`repo` constant if yours is elsewhere).
