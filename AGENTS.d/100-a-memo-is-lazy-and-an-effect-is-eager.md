## A memo is lazy and an effect is eager

A write only marks (PUSH: direct dependents DIRTY, the rest CHECK); memos compute on read and only effects are queued, so never compute inside writeNode or the diamond and equality cut-off break.
