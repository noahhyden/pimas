## The bridge emit must be untracked or an agent listener entangles the host graph

Wrap emit in untrack: a listener that reads a signal would otherwise subscribe the exposing effect to it, so the agent would alter the host's dependency graph.
