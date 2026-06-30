# pimas

The one-install facade for [Pimas](../../README.md). Re-exports the common
surface so getting started is a single dependency:

```ts
import { createSignal, createEffect } from "pimas";
```

Power users import the scoped packages directly for tighter control —
[`@pimas/reactive`](../reactive) alone is the zero-baggage headless core.
This facade is pure re-export and `"sideEffects": false`, so a bundler drops
whatever you don't use.

> Phase 2 adds the DOM renderer (`@pimas/dom`) to the re-export surface here.
