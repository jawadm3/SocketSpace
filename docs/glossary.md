# Glossary

Every technical word used in SocketSpace's documentation, explained in plain English with an
everyday example. Terms are in alphabetical order. New terms are added as they appear.

---

**Annotated tag (git)**: A permanent, named bookmark on one exact version of the code, with a note
attached saying what it is. _Example:_ like writing "Version 1, as handed in" on the back of a
photo of your finished project. SocketSpace v1 is tagged `v1.0.0`.

**Broadcast**: Sending one message to everyone who is listening. _Example:_ a shop's loudspeaker
announcement reaches every customer, not just the one who asked. v1 broadcast every chat message
to everyone, which is why it was not really "1-to-1".

**CI (Continuous Integration)**: A robot that checks every change automatically (runs tests, lint,
builds) as soon as it is pushed. _Example:_ a spell-checker that reads every page as you finish it,
not just the whole book at the end. SocketSpace uses GitHub Actions for this.

**Commit (git)**: A saved snapshot of changes with a short message describing them. _Example:_ a
numbered save point in a video game.

**CORS (Cross-Origin Resource Sharing)**: Browser rules about which websites are allowed to talk to
a server. _Example:_ a receptionist checking which company's badge you wear. Important: CORS is
enforced by browsers only. It does not stop a script or app that ignores it, so it is not a
security lock on its own.

**Formatter (Prettier)**: A tool that rewrites code layout (spaces, quotes, line breaks) into one
consistent style. _Example:_ a tidy-up that lines all the books on a shelf the same way.

**Linter (ESLint)**: A tool that reads code and points out likely mistakes and risky patterns
without running it. _Example:_ a proofreader who flags "their/there" mix-ups.

**Lockfile (`pnpm-lock.yaml`)**: A file recording the exact version of every package installed, so
everyone gets identical copies. _Example:_ a recipe that says "Brand X flour, 500 g" instead of
just "some flour".

**Monorepo**: One repository that holds several related projects. _Example:_ one toolbox with
labelled trays (web app, real-time server, shared code) instead of three separate toolboxes.

**Package / dependency**: Ready-made code written by others that a project uses. _Example:_ buying
ready-made bricks instead of firing your own clay.

**Package manager (pnpm)**: The tool that downloads and installs packages. _Example:_ a delivery
service that fetches the bricks you list.

**pnpm store**: pnpm's single warehouse of downloaded packages. Each project links to the warehouse
instead of keeping its own copy. _Example:_ a library lending the same book to many readers instead
of printing a copy for each. SocketSpace keeps its store in `.pnpm-store` inside the project.

**Push (git)**: Uploading local commits to the shared copy on GitHub. _Example:_ posting your
finished pages to the shared folder so others can see them.

**Remote (git)**: The address of the shared copy of the repository (here, on GitHub). _Example:_ the
postal address you send your work to.

**Repository (repo)**: The folder that holds a project's files plus their full history. _Example:_ a
filing cabinet that also keeps every earlier draft.

**Socket.IO**: A library that keeps a live, two-way connection between a browser and a server, with
automatic reconnection. _Example:_ an open phone line instead of sending letters back and forth.

**Strict mode (TypeScript)**: TypeScript's strictest checking settings. _Example:_ a spell-checker set
to "flag everything", including words it is only unsure about.

**Supply-chain attack**: When an attacker sneaks harmful code into a package that many projects
install. _Example:_ tampering with flour at the mill so every bakery's bread is affected.
SocketSpace waits 3 days before installing any newly published package version, because most
poisoned versions are found and removed within hours.

**Turborepo**: A tool that runs tasks (build, test, lint) across every project in a monorepo, in the
right order, and skips work that has not changed. _Example:_ a kitchen manager who knows which
dishes depend on which sauces and does not remake a sauce that is already done.

**TypeScript**: JavaScript with types: labels saying what kind of value each thing is (text, number,
list...), checked before the code runs. _Example:_ labelled containers in a kitchen, so you cannot
pour sugar into the salt jar by mistake.

**Unit test (Vitest)**: A small automatic check that one piece of code does what it should.
_Example:_ testing a single light switch before wiring the whole house.

**WebSocket**: A web technology for a connection that stays open so both sides can send messages at
any time. _Example:_ a walkie-talkie channel that stays on, instead of dialling for each sentence.

**Workspace (pnpm)**: pnpm's name for the projects that make up a monorepo, listed in
`pnpm-workspace.yaml`. _Example:_ the list of trays in the toolbox. v1 is deliberately not on it.
