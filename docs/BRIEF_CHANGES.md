# Changes to the master brief

`docs/BRIEF.md` is the permanent source of truth. When the owner changes it, the change is
recorded here: the date, what changed, and why.

| Date       | Change                                                                                                                                                                       | Why                                                                                          | Approved by                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| 2026-10-01 | Brief moved into the repository, unchanged, from `D:\mini project\SocketSpace_v2_BRIEF.md` to `docs/BRIEF.md` (SHA-1 `35f17631406d5c25f236486e8ab6c5a4291c6615`, 270 lines). | Owner asked for the brief to live in the repository after the Stage A repository transition. | Owner (chat instruction, 2026-10-01) |

Note: the SHA-1 above is of the original file, which had Windows (CRLF) line endings. Git stores
it with LF line endings because of `.gitattributes`; the words are identical.

## Stage B approval (2026-10-01)

The owner approved the Stage B plan and made the additions below. These add to the brief; where
they differ from it, they take precedence. Details are in `docs/development/decisions.md`.

| Date       | Change                                                                                                                                                                                                                                        | Brief section | Decision       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------- |
| 2026-10-01 | Stack approved, including the changes from the brief's defaults: no Redis on the free deployment (Redis adapter behind `REDIS_URL`), Vercel Blob instead of Cloudflare R2, Canvas 2D first for the home hero, Drizzle, Node load harness      | 4, 6.2, 7     | D-009 to D-020 |
| 2026-10-01 | Visual direction: all three directions (Signal, Airmail, Aurora) become user-selectable themes with light and dark modes; **Airmail is the default**. Replaces "let the owner choose one"                                                     | 6.1           | D-021          |
| 2026-10-01 | Social sign-in: add Facebook and other well-known providers; show the best options first (Google, Facebook, GitHub) and the rest under "More ways to sign in" (Discord, Microsoft, LinkedIn, passkeys). Apple excluded because it is not free | 3.1           | D-022          |
| 2026-10-01 | Profile pictures: every user must pick one during onboarding (preset gallery, custom avatar builder, or uploaded photo); no default placeholder                                                                                               | 3.1           | D-023          |
| 2026-10-01 | Names: chats show a unique nickname; a real name is optional, private by default, and each user chooses whether chats show nickname, real name or both                                                                                        | 3.1           | D-024          |
| 2026-10-01 | Email: Resend with a free is-a.dev subdomain                                                                                                                                                                                                  | 4             | D-014          |
| 2026-10-01 | Random mode is open to guests (anonymous sessions with stricter limits)                                                                                                                                                                       | 3.2           | D-025          |
