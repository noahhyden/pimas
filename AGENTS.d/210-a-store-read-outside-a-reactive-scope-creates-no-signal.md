## A store read outside a reactive scope creates no signal

track() subscribes only when getListener() is set, so assertions and one-shot reads never allocate per-cell nodes; do not make it unconditional or large stores allocate a signal per cell.
