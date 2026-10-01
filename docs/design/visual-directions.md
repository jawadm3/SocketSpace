# Visual directions

_Stage B, 2026-10-01._

> **Owner decision (2026-10-01, D-021):** all three directions become **themes that users can
> pick**, each with a light and a dark mode. **Airmail is the default** for first-time visitors
> and for the home page. Stage F turns each direction into a complete token set in `packages/ui`
> and fixes the contrast issues measured below. The recommendation further down was written
> before this decision and is kept for the record.

Each direction is a working HTML mockup with a **live Canvas 2D hero animation**, a feature strip,
the app screen at desktop width, and its palette and type. All three show the same conversation so
they are easy to compare. Open the `.html` files in a browser to see the animation and try moving
the mouse over the hero; the `.png` files are screenshots rendered with headless Microsoft Edge at
1440 px wide.

| Direction  | Mockup                             | Screenshot                        |
| ---------- | ---------------------------------- | --------------------------------- |
| A. Signal  | `mockups/direction-a-signal.html`  | `mockups/direction-a-signal.png`  |
| B. Airmail | `mockups/direction-b-airmail.html` | `mockups/direction-b-airmail.png` |
| C. Aurora  | `mockups/direction-c-aurora.html`  | `mockups/direction-c-aurora.png`  |

All three heroes are hand-written Canvas 2D (each script is roughly 4 to 6 KB before minifying, no
libraries). They already follow the brief's performance rules in miniature: device pixel ratio
capped at 2, paused when the tab is hidden or the hero scrolls off-screen, and a single static frame
when the visitor prefers reduced motion. In Stage F the chosen hero is rebuilt as a lazy-loaded
React component and measured (LCP, TBT, Lighthouse).

---

## A. Signal

- **Mood:** calm, precise, nocturnal. A network you can see working. Close in spirit to developer
  tools and modern productivity apps: dense when you need it, quiet when you don't.
- **Theme:** dark first; the light theme mirrors it (white surfaces, ink text, the same accents).
- **Palette:** ink `#07090f`, surface `#0e1220`, border `#1c2236`, text `#e6e9f2`, muted
  `#8a93a8`, **signal teal** `#2dd4bf`, **violet** `#8b5cf6`, alert pink `#f472b6`.
- **Type:** Geist (headings and UI, tight tracking) with Geist Mono for labels, timestamps and
  metadata.
- **Hero concept:** a constellation of nodes (people) joined by faint lines; messages travel along
  the lines as glowing pulses, hop from node to node, and make the receiving node flash. Nodes drift
  slowly and lean towards the cursor, which also lights up nearby connections.
- **In the app:** compact Slack/Linear-like layout, coloured square avatars, a teal "active" edge on
  the selected room, monospace metadata.
- **Strengths:** the hero literally shows what the product does (real-time delivery between
  people); dense layout suits long chat sessions; dark-first fits evening use.
- **Risks:** dark, technical looks are common among developer products, so the details (the pulse
  motion, the mono metadata) must carry its identity; may feel cool rather than friendly to
  non-technical visitors.
- **Contrast (measured):** body text 16.4:1, muted text 6.06:1, teal on ink 10.7:1. The "faint"
  grey (3.07:1) is only acceptable for decorative text; in Stage F it is lightened for anything
  people must read (timestamps).

## B. Airmail

- **Mood:** friendly, human, a little playful. Messages as letters and postcards: navy ink, airmail
  red and blue stripes, a stamp.
- **Theme:** light first; the dark theme becomes "night post" (deep navy with the same red and
  blue).
- **Palette:** paper `#f3f4ef`, paper 2 `#e8ebe3`, navy ink `#172033`, muted `#5d6578`,
  **airmail red** `#e2483d`, **airmail blue** `#2b59c3`, stamp yellow `#ffd84d`, and the airmail
  stripe pattern used as a frame on the hero and the app window.
- **Type:** Bricolage Grotesque (a friendly grotesque with character, heavy weights for headlines,
  a wavy underline for emphasis) with Figtree for reading.
- **Hero concept:** speech bubbles drift upward inside an airmail-striped "envelope", each joined
  to the next by a dotted thread like a conversation being written; a stamp reads "Say hello". The
  cursor gently nudges bubbles aside.
- **In the app:** airy layout, rounded speech bubbles (yours in red on the right), sidebar with
  previews of the last message, room cards with large initials.
- **Strengths:** warm and approachable, which suits the "meet someone new" side of the product;
  the airmail motif is specific to messaging and memorable; light-first reads well in daytime and on
  phones.
- **Risks:** the stripe motif must be used sparingly (frames and accents only) or it becomes busy;
  less "high-tech" feel for portfolio reviewers who expect dark UIs.
- **Contrast (measured):** ink on paper 14.7:1, muted 5.28:1, blue on paper 5.72:1. **White on
  airmail red is 4.02:1 (fails AA for normal text)** and red text on paper is 3.63:1: in Stage F,
  text-bearing red buttons and red text use a deeper red `#c53a30` (5.22:1); the brighter red stays
  for stripes and large shapes.

## C. Aurora

- **Mood:** vivid, energetic, social: a night out. Glass panels floating over a slowly moving
  aurora.
- **Theme:** dark first; the light theme becomes "lilac mist" (pale lilac surfaces, the same
  gradient accents).
- **Palette:** night `#0b0614`, deep plum `#1a0f33`, glass (white at 6 to 10% opacity), muted
  `#b8b0d4`, **violet** `#7c3aed`, **pink** `#ec4899`, **amber** `#f59e0b`, **cyan** `#22d3ee`.
- **Type:** Unbounded (wide, rounded display face) with Manrope for reading.
- **Hero concept:** avatars orbit a glowing core on three tilted rings, at different speeds;
  messages fly between them as comets with colourful tails. Moving the mouse tilts the whole system
  slightly (parallax). Behind it, blurred aurora blobs drift.
- **In the app:** rounded glass panels, gradient "active" states, gradient bubbles for your own
  messages, emoji room icons.
- **Strengths:** the most striking first impression; feels young and social; strong for a
  portfolio screenshot.
- **Risks:** the heaviest to render well (blurs and glass are expensive on low-end phones, so
  Stage F would need a simplified mobile version); gradient-and-glass looks date quickly; harder to
  keep readable in long sessions.
- **Contrast (measured):** text on night 18.2:1, muted on plum 8.79:1, white on violet 5.70:1.
  **White on pink is 3.53:1 (fails AA for normal text)**: text on gradient buttons must sit on the
  violet end, or the pink is darkened.

---

## Recommendation

**A (Signal)** is the safest strong choice: its hero explains the product in one glance (messages
travelling between people in real time), and its dense, calm app layout is the easiest to make
fast and accessible. **B (Airmail)** is the most distinctive and the friendliest, and fits the
"meet someone new" story best. C is the boldest but costs the most to keep fast and readable.

A mix is possible, for example A's hero and layout with B's warmth in the light theme. Tell me
which you prefer (A, B, C or a mix) when you approve the plan.
