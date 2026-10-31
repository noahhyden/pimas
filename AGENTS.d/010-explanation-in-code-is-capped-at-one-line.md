## Explanation in code is capped at ONE line

`check-one-line-comments.mjs` fails any block comment or standalone `//` run over one line in `.ts`/`.tsx`/`.mjs`, against a per-file baseline that may only shrink; `.yml` `#` runs have no baseline at all, and a run carrying a tooling pragma is exempt.
