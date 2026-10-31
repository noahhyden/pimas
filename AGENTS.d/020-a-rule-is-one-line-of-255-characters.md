## A rule is one line of 255 characters

`check-agents-rule-length.mjs` caps every `AGENTS.d` body at one line of 255 chars, because markdown is never scanned by the one-line-comment guard and is the hole rule prose grows through; it keeps no baseline, so a new rule is born compliant.
