## Explanation in code is capped at ONE line

`check-comments.mjs` fails any block comment or standalone `//` run over one line in `.ts`/`.tsx`/`.mjs`, and any `#` run in `.yml`. It keeps no baseline, so the count is zero and a new violation is red on the PR adding it. Pragmas are exempt.
