# Rules

One rule per file, named `NNN-the-rule-as-a-sentence.md`. The filename is the index.

A rule body is ONE line of at most 255 characters: the trap and its consequence, never
the rationale essay. `npm run lint:rules` enforces it; `000-header.md` is exempt because
it is navigation, not a rule.

Number ranges keep parallel work from colliding: `0xx` meta, `1xx` reactive core,
`2xx` store, `3xx` agent surface, `9xx` CI and release.
