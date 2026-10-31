## introspectGraph is deep-imported from the kernel and reads is the privacy boundary

The topology walk needs private Reactive node internals, so import it from reactive/reactive.js, not the public export; pass only the exposed reads map or the walk leaks unexposed state.
