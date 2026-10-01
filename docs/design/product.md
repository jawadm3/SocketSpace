# Product design: screens and flows

_Stage B, 2026-10-01. Proposed for approval._

## Who it is for

| Person                           | What they want                                          | What SocketSpace offers                                                 |
| -------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Community member** (main user) | Hang out in topic rooms and talk privately with friends | Rooms, DMs, rich messages, presence, history, search                    |
| **Curious newcomer**             | Try chatting with someone new without commitment        | Random mode as a low-pressure entry point, with a path into rooms       |
| **Room owner / moderator**       | Keep their room friendly                                | Roles, invites, mutes, room bans, room word list                        |
| **Platform admin**               | Keep everyone safe                                      | Reports and flags queue, sanctions, audit log, aggregate stats          |
| **Portfolio visitor**            | See what the developer built, in 2 minutes              | Animated home page, one-click demo accounts, honest "how it works" page |

## Information architecture

```mermaid
flowchart TD
  HOME["/ Home (animated)"] --> SIGNIN["/sign-in, /sign-up"]
  HOME --> DEMO["Try the demo (pre-verified demo account)"]
  HOME --> HOW["/how-it-works (architecture, honest limits)"]
  HOME --> LEGAL["/terms, /privacy, /guidelines, /safety"]
  SIGNIN --> VERIFY["/verify-email, /reset-password"]
  SIGNIN --> APP
  DEMO --> APP
  subgraph APP["/app (signed in)"]
    INBOX["/app Home: recent conversations, mentions"]
    ROOM["/app/r/[slug] Room"]
    DM["/app/dm/[id] Direct message"]
    EXPLORE["/app/explore Public rooms"]
    RANDOM["/app/random Random mode (gate → lobby → chat → end)"]
    NOTIF["/app/notifications"]
    SEARCH["/app/search"]
    SETTINGS["/app/settings (profile, account, privacy, notifications, blocked, data)"]
    INVITE["/invite/[code]"]
  end
  APP --> ADMIN["/admin (admins only): reports, flags, users, rooms, audit log, stats"]
```

## The app shell (desktop, 1280 px and wider)

```
┌────┬──────────────────┬───────────────────────────────────────┬──────────────┐
│Rail│ Sidebar          │ Conversation                          │ Details      │
│    │                  │ ┌───────────────────────────────────┐ │ (toggle)     │
│ ⌂  │ Search… (Ctrl K) │ │ # design-talk · 24 online   ⋯     │ │ Members      │
│ #  │ ROOMS            │ ├───────────────────────────────────┤ │ Pinned       │
│ @  │  # general    3  │ │ ── New messages ──                │ │ Files        │
│ 🎲 │  # design-talk   │ │ Ava  10:41                        │ │              │
│ 🔔 │ DIRECT MESSAGES  │ │  Has anyone tried the new ...     │ │              │
│    │  ● Sam        1  │ │  ↳ reply · 😀 3 · 👍 1            │ │              │
│ ⚙  │  ○ Lee           │ │ Sam is typing…                    │ │              │
│ me │                  │ ├───────────────────────────────────┤ │              │
│    │ + New room       │ │ [+] Message #design-talk   😊 ⏎  │ │              │
└────┴──────────────────┴───────────────────────────────────────┴──────────────┘
```

- **Rail:** Home, Rooms, DMs, Random, Notifications, Settings, avatar menu (status, theme, sign out).
- **Sidebar:** quick switcher (Ctrl/Cmd + K), rooms and DMs with unread badges and presence dots.
- **Conversation:** header (name, topic, online count, actions), virtualised message list,
  composer (markdown-lite, emoji picker, image attach, reply chip, @mention autocomplete).
- **Details panel:** members with roles and presence, room info, shared images.
- **Tablet (768 to 1279 px):** rail + one column; the details panel opens as a sheet.
- **Mobile (below 768 px):** bottom tab bar (Chats, Explore, Random, Activity, Me); conversation
  list and conversation are separate screens; the composer stays above the keyboard
  (`100dvh` and `visualViewport`, fixing v1's fixed-height layout).

## Screen inventory

Every screen has designed **empty**, **loading** (skeletons, not spinners) and **error** states.

| Screen               | Purpose and key elements                                                                                                                                                                                            | Empty / loading / error                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Home (marketing)     | Animated hero, value statement, "Try the demo", "Sign up", feature sections with scroll animations, safety section, honest free-tier note, footer                                                                   | Reduced-motion and no-WebGL/Canvas fallback: a static illustration              |
| How it works         | Architecture diagram, v1 vs v2, limits                                                                                                                                                                              | n/a                                                                             |
| Sign up / sign in    | Email + password, GitHub button, password-strength hint, links to terms                                                                                                                                             | Field-level errors; rate-limit message with wait time                           |
| Verify email / reset | Clear steps, resend with cooldown                                                                                                                                                                                   | Expired link screen with a "send a new one" button                              |
| App home             | Recent conversations, unread mentions, suggested public rooms                                                                                                                                                       | New user: three suggested rooms and "Try random mode"                           |
| Room                 | Header, messages, composer, members panel                                                                                                                                                                           | "Be the first to say hello"; history skeletons; "Couldn't load messages. Retry" |
| DM                   | Same as room plus delivery/seen ticks and the person's presence                                                                                                                                                     | "Say hi to Sam"; blocked: "You can't message this person"                       |
| Explore              | Searchable directory of public rooms (name, topic, member count, activity)                                                                                                                                          | "No rooms match. Create one?"                                                   |
| Create room          | Name, slug preview, topic, public/private                                                                                                                                                                           | Inline validation                                                               |
| Room settings        | Members with roles, invites (create, copy, revoke, expiry, uses), room word list, delete                                                                                                                            | Owner-only actions hidden and refused server-side                               |
| Invite               | Room preview and "Join"                                                                                                                                                                                             | Expired, revoked or used-up invite states                                       |
| Random: gate         | Plain-language rules, 18+ confirmation, terms checkbox                                                                                                                                                              | Shown again when the rules version changes                                      |
| Random: lobby        | Interest tags input, "Start", tips                                                                                                                                                                                  | Sanction state: "Random mode is paused for you until 14:20 because..."          |
| Random: searching    | Calm animation, time waited, "Cancel"                                                                                                                                                                               | After 10 s: "Widening the search to everyone"                                   |
| Random: chat         | Stranger label, shared interests, messages, Skip/Next, End, Report, Block, "Share profile" and "Add contact" (both must accept)                                                                                     | Partner disconnected: "Stranger left"                                           |
| Random: ended        | Summary, "Next", "Add contact" (if mutual), **suggested rooms for your shared interests**                                                                                                                           | n/a                                                                             |
| Notifications        | Mentions, replies, DMs, invites, contact requests, moderation notices                                                                                                                                               | "You're all caught up"                                                          |
| Search               | Query, filters (conversation, person, date), results with highlighted terms, jump to message                                                                                                                        | "No results for..." with tips                                                   |
| Settings             | Profile (name, avatar, bio), account (email, password, sessions), privacy (DM policy, presence, read receipts), notifications (in-app, browser), blocked people, theme, **download my data**, **delete my account** | Confirmations for destructive actions                                           |
| Profile popover      | Avatar, name, @username, bio, presence, "Message", "Block", "Report"                                                                                                                                                | Blocked/deleted states                                                          |
| Admin: reports       | Queue with filters, report detail with evidence snapshot and context, actions with required reason                                                                                                                  | "No open reports"                                                               |
| Admin: flags         | Automatic flags by severity and source                                                                                                                                                                              | "Nothing flagged"                                                               |
| Admin: users         | Search, user detail (sanctions history, reports), actions                                                                                                                                                           |                                                                                 |
| Admin: audit log     | Filterable, read-only list of every moderator action                                                                                                                                                                |                                                                                 |
| Admin: stats         | Live connections, messages per minute, random funnel counts (aggregates only), free-tier usage                                                                                                                      |                                                                                 |
| 404 / 500 / offline  | Friendly, with a way home; offline banner in the app shell                                                                                                                                                          |                                                                                 |

## Key flows

### Sign up and verify

```mermaid
flowchart LR
  A[Home] --> B[Sign up: email + password]
  B --> C{Valid and not breached?}
  C -- no --> B
  C -- yes --> D[Account created, verification email sent]
  D --> E[App opens in read-only mode with a banner: verify to post]
  E --> F[Click link in email]
  F --> G[Verified: can post, DM, join rooms]
  B --> H[Or: Continue with GitHub] --> G
```

### Sending a message (optimistic)

1. Press Enter. The message appears instantly, slightly faded, with a clock icon.
2. The server confirms within milliseconds: it becomes solid with one tick.
3. If the connection is down, it stays in the outbox and a banner says "Offline: messages will be
   sent when you reconnect". On reconnect it is sent automatically (no duplicates).
4. If refused (for example muted), it turns red with the reason and a "Delete" option.

### Random mode to community (the retention path)

The brief notes that random-chat products lose people once the novelty fades. Random mode is
therefore designed as a door into the community, measured with aggregate counts only:

1. **End screen suggests rooms** that match the interests both people shared ("You both like chess:
   join #chess (128 members)"). Counter: `random_room_cta_clicked`.
2. **Mutual "Add contact"** turns a good conversation into a DM thread. Counter:
   `random_mutual_contact_added`.
3. **Guests** (if approved) are invited to create an account to keep the contact. Counter:
   `random_guest_signed_up`.
4. Admin stats show the funnel: sessions started → matched → mutual contacts → room joins.

### Report and moderation

See the sequence diagram in `docs/architecture/realtime-protocol.md`. User-facing: one tap opens a
short form (reason + optional details); the reporter gets a confirmation and later a "resolved"
notification. The reported person sees a clear notice with the reason if action is taken.

## Interaction and accessibility rules

- **Keyboard first:** everything reachable by keyboard; visible focus rings; `Ctrl/Cmd + K`
  switcher; `Esc` closes overlays and returns focus to where it was; arrow keys move through the
  message list; `Up` in an empty composer edits your last message.
- **Screen readers:** the message list is a `log` region; new messages are announced politely
  (batched, at most one announcement per 2 seconds, never while the user is typing); every icon
  button has a label; unread counts are spoken ("3 unread").
- **No forced scrolling:** new messages auto-scroll only if you are already at the bottom;
  otherwise a "New messages ↓" pill appears (fixes v1's behaviour).
- **Motion:** 150 to 250 ms in the app; everything respects `prefers-reduced-motion`.
- **Contrast:** text at least 4.5:1 (normal) and 3:1 (large and UI parts) in both themes; checked
  automatically with axe in end-to-end tests.
- **Touch targets** at least 44 × 44 px on mobile.

## Decisions for the owner in this document

1. **Guests in random mode?** Recommended: **yes**, with an anonymous session and stricter limits.
   It lowers the barrier for newcomers, which is the point of random mode as an entry door. The
   alternative (sign-in required) is safer and simpler. Your choice.
2. **Threads:** recommended **inline replies** (quote + jump to original) for v2; full side-panel
   threads listed as a future improvement. The brief allows "replies or threads".
