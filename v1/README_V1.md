# SocketSpace v1 (archived original)

This folder holds **SocketSpace v1**, the original university mini project, exactly as it was
before the v2 rebuild. It is kept for history and comparison. It is **not maintained**.

## The canonical snapshot

The git tag **`v1.0.0`** marks the last commit of v1 before anything was moved. If you want
v1 exactly as it was, with its files at the top level of the repository, check out the tag:

```bash
git checkout v1.0.0
```

The files in this `v1/` folder are the same files, moved with `git mv` so their history is kept.
(`LICENSE` stayed at the repository root because it covers the whole repository.)

## What v1 was

- A single Next.js 15 page (`src/app/chat/page.tsx`) with a text box and a message list.
- A separate Node.js server (`server.js`) using Express and Socket.IO on port 8001.
- Styling with Tailwind CSS 3 and daisyUI 4. Dark mode only.
- It was described as "anonymous 1-to-1 chat".

## How v2 is different

| | v1 (this folder) | v2 (repository root) |
| --- | --- | --- |
| Who receives a message | Everyone connected (one global room) | Only the members of a room, a direct message, or a matched pair |
| Accounts | None | Sign-up, sign-in, email verification, profiles |
| History | None (lost on refresh) | Stored in a database, with paging and search |
| Safety | None | Rate limits, reports, blocks, word filter, moderation dashboard |
| Configuration | `localhost` hardcoded | Environment variables |
| Tests and CI | None | Unit, integration, real-time, end-to-end tests and GitHub Actions |
| Deployment | Never deployed | Deployed on free hosting tiers |

## Known problems in v1 (checked, with evidence)

These were confirmed on 2026-10-01 during the v2 analysis. The full write-up is in
`docs/analysis/v1-analysis.md` at the repository root.

- **Not actually 1-to-1.** `server.js` calls `socket.broadcast.emit`, so a message from one
  person goes to *everyone else* who is connected. A test with three clients showed client A's
  message arriving at both B and C.
- **No input checks.** The server forwards whatever object it receives. A 100,000-character
  message and an extra unexpected field were both passed on to other users unchanged.
- **The CORS setting does not protect anything.** A WebSocket connection that claimed to come
  from a different website was accepted.
- **The production build fails.** `next build` stops with two lint errors (`<a>` used instead
  of Next.js `Link` in `layout.tsx`).
- `localhost` addresses are hardcoded in the client and the server.
- The socket client is created in two places; `src/lib/socket.ts` is never used.
- The server logs the full text of every message.
- The README mentions an `npm run server` script that does not exist, and names both
  Next.js 14 and 15.
- There are two PostCSS config files; the `.mjs` one points at a Tailwind 4 plugin that is
  not installed.
- No tests, no CI, never deployed.

## Running v1 (historical)

v1 is excluded from all v2 tools (workspace, lint, type checks, tests, builds, Docker and
deployments). If you really want to run it, do it inside this folder only:

```bash
cd v1
npm install
node server.js
```

Then, in a second terminal, still inside `v1`:

```bash
npm run dev
```

Open `http://localhost:3000`. Remember the problems listed above.
