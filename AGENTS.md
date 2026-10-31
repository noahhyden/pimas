# pimas — agent rules

`pimas-ui` is a headless reactive what-if model runtime: signals, memos, a fine-grained
store, `speculate` over a shadow graph, and an agent bridge. Zero runtime dependencies.
There is no renderer — `0.2.0` deleted it.

## Explanation in code is capped at ONE line

A module, class or function gets a **one-line** doc comment or none, and a run of
standalone comments is **one line**. Everything longer — the rationale, the measurements,
the history, the "why not X" — belongs in an `AGENTS.d/` rule, which is where an agent
will actually find it.

`npm run lint:comments` enforces this against a per-file baseline that may only shrink.
`npm run lint:rules` enforces that a rule itself stays one line of 255 characters.
Both run in CI.

## Rules

Rules live in [`AGENTS.d/`](AGENTS.d/), one per file, named `NNN-the-rule-as-a-sentence.md`.
The filename **is** the index: read the ones that cover what you are touching. A rule body
is one line — the trap and its consequence, never an essay.
