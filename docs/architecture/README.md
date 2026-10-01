# Architecture documents

Start here. All documents are in plain English; technical terms are explained in
`docs/glossary.md`.

| Document                                     | What it answers                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [system-overview.md](system-overview.md)     | What runs where, who does what, configuration, scaling, what users see when things fail   |
| [stack.md](stack.md)                         | Which technologies, what else was considered, and why                                     |
| [data-model.md](data-model.md)               | Every table, how messages get their order number, retention periods                       |
| [realtime-protocol.md](realtime-protocol.md) | Every live event, acknowledgements, resync, random matching, moderation flow, rate limits |
| [security.md](security.md)                   | Threat model, security controls, safety features, legal note                              |

Related: `docs/research/free-tier-research.md` (numbers behind the hosting choices),
`docs/design/product.md` (screens and flows), `docs/design/visual-directions.md` (look and feel),
`docs/analysis/` (v1 analysis and brief critique), `qa/` (requirements and acceptance criteria),
`docs/development/plan.md` (stage plan and risks).

Diagrams use Mermaid, which GitHub renders directly in the browser.
