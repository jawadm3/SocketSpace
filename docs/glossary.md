# Glossary

Every technical word used in SocketSpace's documentation, explained in plain English with an
everyday example. Terms are in alphabetical order. New terms are added as they appear.

---

**Account lockout**: After too many wrong passwords for one account, sign-in is paused for a while, and each further failure makes the pause longer. _Example:_ a phone that waits a minute after five wrong PIN codes. SocketSpace locks after 10 failures for 1, 2, 4 ... up to 60 minutes.

**Acknowledgement (ack)**: A short reply from the server saying "got it, saved". _Example:_ the
"delivered" receipt a courier gives you. A message shows one tick only after its ack arrives.

**Adapter (Socket.IO)**: The part of Socket.IO that decides how a message reaches every listener.
The default one works inside one server; the Redis adapter passes messages between several servers.
_Example:_ a single room's loudspeaker versus a public-address system linking several buildings.

**Annotated tag (git)**: A permanent, named bookmark on one exact version of the code, with a note
attached saying what it is. _Example:_ writing "Version 1, as handed in" on the back of a photo of
your finished project. SocketSpace v1 is tagged `v1.0.0`.

**Append-only**: Data that can be added to but never changed or deleted. _Example:_ a bound logbook
with numbered pages. The moderation audit log is append-only, enforced by the database.

**ASVS**: The OWASP Application Security Verification Standard, a checklist of security
requirements for web applications, in levels 1 to 3. _Example:_ a building-safety inspection
checklist. We aim at the intent of level 2.

**Audit log**: A record of who did what and when. _Example:_ the visitor book at a reception desk.
Every moderator action is written to one.

**Broadcast**: Sending one message to everyone who is listening. _Example:_ a shop's loudspeaker
announcement reaches every customer. v1 broadcast every chat message to everyone, which is why it
was not really "1-to-1".

**Bundle / bundler (esbuild)**: A tool that gathers a program and every library it uses into one file. _Example:_ packing everything for a trip into one suitcase instead of carrying forty bags. The realtime server is bundled into one file, so its Docker image needs no `node_modules`.

**Canvas 2D / WebGL**: Two browser technologies for drawing graphics with code. Canvas 2D draws
flat shapes and is small and simple; WebGL uses the graphics card for 3D and is more powerful but
heavier. _Example:_ a sketchpad versus a full animation studio.

**CC0 licence**: A "no rights reserved" licence: anyone may use the work for anything, without asking or giving credit. _Example:_ a recipe pinned up in a public kitchen for anyone to cook. Our avatar styles are all CC0.

**Checksum (SHA-256)**: A short fingerprint calculated from a file's exact bytes; change one byte and the fingerprint changes completely. _Example:_ the seal on a jar: if it does not match, someone opened it. The gitleaks download is refused if its fingerprint differs from the official one.

**CI (Continuous Integration)**: A robot that checks every change automatically (tests, lint,
builds) as soon as it is pushed. _Example:_ a spell-checker that reads every page as you finish it.
SocketSpace uses GitHub Actions.

**CodeQL / code scanning**: A free GitHub service that reads the code and looks for patterns known to cause security bugs. _Example:_ a proofreader who only hunts for dangerous mistakes. It runs on every push and weekly.

**Cold start**: The wait while a sleeping server wakes up. _Example:_ an old laptop booting before
you can use it. Render's free servers take about a minute.

**Commit (git)**: A saved snapshot of changes with a short message describing them. _Example:_ a
numbered save point in a video game.

**Container image**: A sealed package holding a program and everything it needs to run, which any container host can start the same way. _Example:_ a ready meal in a sealed tray: heat it anywhere and it tastes the same. SocketSpace builds one image for each app.

**CORS (Cross-Origin Resource Sharing)**: Browser rules about which websites may talk to a server.
_Example:_ a receptionist checking which company's badge you wear. CORS is enforced by browsers
only; it does not stop a script that ignores it, so it is not a security lock on its own.

**CSP (Content Security Policy)**: A list the website gives the browser of where scripts, images
and connections may come from. _Example:_ a guest list at a door: anyone not on it is turned away,
which blocks most injected scripts.

**CSRF (Cross-Site Request Forgery)**: A trick where another website makes your browser send a
request to our site while you are signed in. _Example:_ someone slipping a pre-filled form under
your hand to sign. Prevented with cookie settings and origin checks.

**CU-hour (Neon)**: Neon's unit of database computing time: one "compute unit" running for one
hour. _Example:_ kilowatt-hours on an electricity bill. The free plan includes 100 per month.

**DiceBear**: A free, open-source (MIT) library that draws avatars from a few settings. _Example:_ a character creator in a video game. SocketSpace runs it inside the app, so no outside service is involved.

**DNS records**: Settings attached to a domain that tell the internet where its website and email live and who may send email for it. _Example:_ the directory board in an office lobby.

**Docker / Dockerfile**: Docker packages a program with everything it needs into a "container"
that runs the same anywhere; a Dockerfile is the recipe. _Example:_ a shipping container that fits
on any ship, train or lorry.

**Domain**: A web address such as `socketspace.is-a.dev`. _Example:_ a street address for a website. Email services need one to prove that mail really comes from us.

**Email delivery service (Resend)**: A service that sends emails on an app's behalf, such as "confirm your email" and "reset your password". _Example:_ a post office the app hands its letters to. SocketSpace uses Resend's free plan.

**End-to-end test (Playwright)**: A test that drives a real browser like a person would: typing, clicking and reading the page. _Example:_ a mystery shopper who walks through the whole shop instead of checking one shelf. Journey J1 (sign up, verify, reset the password) runs this way.

**Environment variable**: A named setting given to a program when it starts, kept outside the code (addresses, secrets, switches). _Example:_ the settings on a washing machine: the same machine, different settings per wash. Every variable is listed in `.env.example`, without values.

**EXIF**: Hidden information stored inside photos, such as the camera model and sometimes the GPS
location where it was taken. _Example:_ a postmark on a letter revealing where it was posted. We
remove it from every uploaded image.

**Formatter (Prettier)**: A tool that rewrites code layout into one consistent style. _Example:_ a
tidy-up that lines all the books on a shelf the same way.

**Free tier**: The no-cost plan of a paid service, with limits. _Example:_ a gym's free trial pass
that only works off-peak.

**Full-text search**: Searching inside text by words rather than exact strings, using a special
index. _Example:_ the index at the back of a book, which lists pages for each word.

**GDPR**: The General Data Protection Regulation (EU) and its UK version: laws giving people rights
over their personal data (see it, correct it, delete it, take it elsewhere).

**Git hook (pre-commit)**: A small script git runs automatically at a certain moment, for example just before saving a commit. _Example:_ a spell-check that runs when you press "send". SocketSpace's pre-commit hook refuses a commit that contains something that looks like a secret.

**Graceful shutdown**: Stopping a server politely: refuse new work, finish what is in progress, tell connected people to reconnect, then exit. _Example:_ a shop that locks the door at closing time but serves the customers already inside.

**Have I Been Pwned (k-anonymity)**: A public list of passwords that have leaked in data breaches. SocketSpace sends only the first 5 characters of a password's SHA-1 fingerprint and checks the matching list itself, so the password never leaves the server. _Example:_ asking a librarian for "all books whose titles start with QX" instead of naming the one book you want.

**Health check / readiness check**: Addresses a server answers so other systems can tell whether it is alive (`/healthz`) and ready to work (`/readyz`: database reachable, keys available). _Example:_ a receptionist answering "yes, we are open" versus "yes, and the doctor is in".

**HMAC**: A way to "sign" a message with a shared secret so the receiver can prove who sent it and
that it was not changed. _Example:_ a wax seal only the sender's ring can make.

**Horizontal scaling**: Handling more users by adding more servers rather than a bigger one.
_Example:_ opening more checkout tills instead of hiring one faster cashier.

**Idempotent**: Doing something twice has the same effect as doing it once. _Example:_ pressing a
lift button again does not call a second lift. Re-sending a message with the same client ID never
creates a duplicate.

**Integration test**: A test that runs several real parts together, for example the sign-in code with a real database. _Example:_ test-driving a whole car rather than checking each part on a bench.

**is-a.dev**: A free service that gives developers a subdomain such as `name.is-a.dev`, requested through a GitHub pull request.

**JWKS**: A published list of the public keys used to check JWT signatures. _Example:_ a public
register of official stamps so anyone can check a pass is genuine.

**JWT / signed token**: A small piece of text containing facts (such as "this is user 42, valid for
5 minutes") plus a signature proving who issued it. _Example:_ a dated, stamped visitor pass.

**LCP / TBT / Lighthouse**: Page-speed measures. LCP (Largest Contentful Paint) is how long until
the main content appears; TBT (Total Blocking Time) is how long the page is too busy to respond;
Lighthouse is Google's free tool that measures them. _Example:_ how long until the curtain rises,
and how long the usher ignores you.

**Linter (ESLint)**: A tool that reads code and points out likely mistakes without running it.
_Example:_ a proofreader who flags "their/there" mix-ups.

**Lockfile (`pnpm-lock.yaml`)**: A file recording the exact version of every installed package, so
everyone gets identical copies. _Example:_ a recipe that says "Brand X flour, 500 g" instead of
"some flour".

**Login CSRF**: A trick where another website signs a visitor into an account the attacker controls, so the visitor's later activity lands in the attacker's account. SocketSpace refuses state-changing sign-in requests from other sites. _Example:_ someone slipping their own key card into your pocket so your purchases go on their account.

**Magic bytes**: The first few bytes of a file, which reveal its real type regardless of its name.
_Example:_ checking what is actually inside a box rather than trusting the label.

**Migration (database)**: A small, versioned script that changes the database structure (for
example, adds a table). _Example:_ numbered renovation plans applied to a house in order.

**Monorepo**: One repository holding several related projects. _Example:_ one toolbox with labelled
trays instead of three separate toolboxes.

**MoSCoW**: A way to prioritise: Must have, Should have, Could have, Won't have (this time).

**Nonce**: A random value used once. The page's security policy only lets scripts run that carry this request's nonce, so an injected script, which cannot guess it, does not run. _Example:_ a password that changes every time the door opens.

**OAuth / social sign-in**: Signing in with an account you already have elsewhere (Google, Facebook, GitHub...). The other site confirms who you are; we never see your password there. _Example:_ showing a passport issued by another country instead of filling in a new identity form.

**Onboarding**: The short set-up steps right after sign-up (nickname, profile picture, theme). _Example:_ filling in your name badge at the door of an event.

**Online Safety Act 2023 (UK)**: A UK law placing safety duties on services where users can talk to
each other, including assessing risks to children and illegal content.

**Optimistic UI**: Showing the result of an action immediately, before the server confirms it, and
correcting it if it fails. _Example:_ writing an appointment in pencil, then inking it once
confirmed.

**ORM (Drizzle)**: A library that lets code talk to the database with typed functions instead of
raw text queries. _Example:_ a phrasebook that checks your grammar before you speak.

**Outbox**: A list in the browser of messages not yet confirmed by the server, kept so they can be
re-sent after a dropped connection. _Example:_ the outbox tray on an office desk.

**Package / dependency**: Ready-made code written by others that a project uses. _Example:_ buying
ready-made bricks instead of firing your own clay.

**Package manager (pnpm)**: The tool that downloads and installs packages. _Example:_ a delivery
service that fetches the bricks you list.

**Passkey**: A way to sign in with your fingerprint, face or device PIN instead of a password. The secret never leaves your device, so it cannot be phished. _Example:_ a house key that only works in your hand.

**PGlite**: A real PostgreSQL database compiled to run inside a program, with nothing to install.
_Example:_ a pocket-sized practice version of the real thing. Used for tests.

**pnpm store**: pnpm's single warehouse of downloaded packages, linked into each project.
_Example:_ a library lending the same book to many readers. Ours is `.pnpm-store` inside the
project.

**Presence**: Showing whether someone is online, away or offline. _Example:_ the "open/closed" sign
on a shop door.

**Prometheus metrics**: A simple text format for counters and gauges (for example "connections: 12") that monitoring tools can read. _Example:_ the dials on a car dashboard. Served at `/metrics`, protected by a token.

**Pub/sub (publish/subscribe)**: A messaging pattern where senders publish to a topic and everyone
subscribed to it receives the message. _Example:_ a newsletter mailing list.

**Push (git)**: Uploading local commits to the shared copy on GitHub. _Example:_ posting your
finished pages to the shared folder.

**Rate limit / token bucket**: A cap on how often someone can do something. A token bucket gives
each person a small bucket of tokens that refills slowly; each action spends one. _Example:_ a
coffee loyalty card that allows a few free refills per hour.

**Remote (git)**: The address of the shared copy of the repository. _Example:_ the postal address
you send your work to.

**Replay attack**: Recording a valid message and sending it again later to repeat its effect. Internal events carry a time stamp and a one-time ID, so a replay is refused. _Example:_ photocopying a used concert ticket; the scanner knows it was already used.

**Repository (repo)**: The folder holding a project's files plus their full history. _Example:_ a
filing cabinet that also keeps every earlier draft.

**Row lock / transaction**: A transaction is a group of database changes that happen all together or not at all. A row lock makes others wait while one transaction changes a row. _Example:_ a single pen for the visitor book: one person writes at a time, so line numbers never clash. Messages get their numbers this way.

**Scale to zero**: A service that switches itself off when unused and back on when needed.
_Example:_ motion-sensor lights in a corridor. Neon's database does this after 5 idle minutes.

**Secret scanning (gitleaks)**: A tool that searches code and its history for things that look like passwords, keys or tokens. _Example:_ an airport scanner for your luggage before it is loaded.

**Sequence number**: A number given to each event in a conversation, counting up by one. _Example:_
numbered tickets at a deli counter: if you hold 41 and see 43 called, you know you missed 42.

**Service container (CI)**: A helper program (for example PostgreSQL or Redis) that CI starts next to a test job, used only for that run and then thrown away. _Example:_ a hired practice partner who leaves when the session ends.

**Session (sign-in)**: The record that says "this browser is signed in as this person", kept in the database and pointed to by a cookie. Ending the session signs that browser out. _Example:_ a cloakroom ticket: hand it in and you get your coat; tear it up and the coat stays.

**SHA pinning (GitHub Actions)**: Referring to a reusable CI step by the exact fingerprint of its code instead of a name like "v7", so nobody can change it underneath us. _Example:_ ordering a specific edition of a book by its ISBN rather than "the latest one".

**Smoke test**: A quick check that something starts and answers at all, before deeper tests. _Example:_ switching on a newly repaired appliance to see that nothing smokes.

**Socket.IO**: A library that keeps a live, two-way connection between a browser and a server, with
automatic reconnection. _Example:_ an open phone line instead of sending letters.

**SSRF (Server-Side Request Forgery)**: Tricking a server into fetching an address it should not,
such as its own internal systems. _Example:_ asking a receptionist to "just pop into the manager's
office and read me what's on the desk". Link previews are guarded against it.

**Standalone build (Next.js)**: A build of the web app that includes only the files it needs to run, so it can be copied into a small container. _Example:_ a flat-pack wardrobe with exactly the screws it needs, nothing extra.

**Strict mode (TypeScript)**: TypeScript's strictest checking settings. _Example:_ a spell-checker
set to "flag everything".

**STRIDE**: A checklist for thinking about threats: Spoofing, Tampering, Repudiation, Information
disclosure, Denial of service, Elevation of privilege.

**Supply-chain attack**: Sneaking harmful code into a package many projects install. _Example:_
tampering with flour at the mill so every bakery's bread is affected. We wait 3 days before
installing any newly published package version.

**Theme / design tokens**: A theme is a complete look (colours, fonts, corner rounding, shadows); design tokens are the named values that make it up. Switching theme swaps the token values. _Example:_ repainting a room by changing only the paint labels, not the furniture.

**Tombstone**: A placeholder kept where something was deleted, so the surrounding order still makes
sense. _Example:_ "This message was deleted" in a chat.

**Trojan Source (bidi characters)**: Invisible characters that change the display direction of text, making code or messages look different from what the computer reads. SocketSpace strips them from messages and refuses them in source code. _Example:_ mirror writing that only looks normal in a mirror.

**Turborepo**: A tool that runs tasks across every project in a monorepo in the right order and
skips unchanged work. _Example:_ a kitchen manager who does not remake a sauce that is already done.

**TypeScript**: JavaScript with types (labels saying what kind of value each thing is), checked
before the code runs. _Example:_ labelled kitchen containers, so sugar never goes in the salt jar.

**Unit test (Vitest)**: A small automatic check that one piece of code does what it should.
_Example:_ testing a single light switch before wiring the whole house.

**UUID v7**: A 128-bit unique ID that starts with the time it was made, so newer IDs sort after older ones. _Example:_ a ticket number that starts with today's date and time.

**Virtualised list**: A long list where only the rows on screen are actually drawn. _Example:_ a
train window: you only see the stretch of track outside, not the whole route at once. Keeps rooms
with thousands of messages fast.

**WCAG**: The Web Content Accessibility Guidelines; level AA is the common target (readable
contrast, keyboard use, screen-reader labels and more).

**WebSocket**: A web connection that stays open so both sides can send messages at any time.
_Example:_ a walkie-talkie channel that stays on.

**Workspace (pnpm)**: The projects that make up a monorepo, listed in `pnpm-workspace.yaml`.
_Example:_ the list of trays in the toolbox. v1 is deliberately not on it.

**X-Forwarded-For**: A request header listing the IP addresses a request passed through. Only the entries added by our own trusted proxy can be believed, because a visitor can write anything into it. _Example:_ a parcel's chain of postmarks: you trust the stamps added by the post office, not the ones the sender drew on.
