## reconcile snapshots key to row before mutating

reconcileArray builds byKey from the raw rows BEFORE any setProperty, because writes shift slots; reading prev[i] afterwards matches the wrong row and loses object identity.
