## Store signals outlive their reader's owner

createSignal never registers on the owner tree (only memos/effects do), so signalFor's signals are held by `nodes` for the store's life; disposing a reader leaves them in place, by design.
