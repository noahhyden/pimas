## A same-length reorder must ping $KEYS explicitly

A same-length reorder/swap bumps only per-index nodes, which iteration and .length readers do not track; reconcileArray bumps $KEYS itself, a produce splice does not, so use reconcile to reorder.
