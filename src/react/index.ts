/**
 * Bind a pimas model into React. Fine-grained: a component that reads
 * `() => cart.items[3].qty` re-renders only when that field changes.
 *
 * Requires React 18+ (`useSyncExternalStore`). Peer dependency — this module
 * is never pulled in unless you import `pimas-ui/react`.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { subscribe } from "../reactive/index.js";
import type { Accessor } from "../reactive/index.js";
import type { AgentBridge } from "../agent/bridge.js";

/**
 * Subscribe a React component to a pimas accessor (signal, memo, store field).
 * Pass a stable accessor (`model.total`) or a closure; the latest `read` is
 * always used, so inline `() => store.rows[i].qty` is fine.
 */
export function usePimas<T>(read: Accessor<T>): T {
  const readRef = useRef(read);
  readRef.current = read;

  const subscribeTo = useCallback((onChange: () => void) => {
    let first = true;
    return subscribe(
      () => readRef.current(),
      () => {
        // useSyncExternalStore forbids calling onChange synchronously inside
        // subscribe. Skip the initial run; getSnapshot supplies the first value.
        if (first) {
          first = false;
          return;
        }
        onChange();
      },
    );
  }, []);

  const getSnapshot = () => readRef.current();
  return useSyncExternalStore(subscribeTo, getSnapshot, getSnapshot);
}

/**
 * Subscribe to every value a bridge has `expose`d. Re-renders when any of them
 * change. Prefer `usePimas` on a single accessor when you can — that's the
 * fine-grained path.
 */
export function useSnapshot(bridge: AgentBridge): Record<string, unknown> {
  const cache = useRef(bridge.snapshot().state);
  const subscribeTo = useCallback((onChange: () => void) => {
    // bridge.subscribe replays the current snapshot synchronously — skip those
    // so we don't call onChange inside subscribe (useSyncExternalStore rule).
    let ready = false;
    const unsub = bridge.subscribe(() => {
      cache.current = bridge.snapshot().state;
      if (ready) onChange();
    });
    cache.current = bridge.snapshot().state;
    ready = true;
    return unsub;
  }, [bridge]);
  return useSyncExternalStore(subscribeTo, () => cache.current, () => cache.current);
}
