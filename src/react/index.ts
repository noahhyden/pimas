/** Bind a pimas model into React (18+, peer dependency); a component re-renders only when the fields it reads change. */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { subscribe } from "../reactive/index.js";
import type { Accessor } from "../reactive/index.js";
import type { AgentBridge } from "../agent/bridge.js";

/** Subscribe a React component to a pimas accessor; the latest `read` is always used, so an inline closure is fine. */
export function usePimas<T>(read: Accessor<T>): T {
  const readRef = useRef(read);
  readRef.current = read;

  const subscribeTo = useCallback((onChange: () => void) => {
    let first = true;
    return subscribe(
      () => readRef.current(),
      () => {
        // useSyncExternalStore forbids onChange inside subscribe; getSnapshot supplies the first value.
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

/** Subscribe to every value a bridge has `expose`d; prefer `usePimas` on one accessor for fine-grained renders. */
export function useSnapshot(bridge: AgentBridge): Record<string, unknown> {
  const cache = useRef(bridge.snapshot().state);
  const subscribeTo = useCallback((onChange: () => void) => {
    // bridge.subscribe replays synchronously; skip it so onChange isn't called inside subscribe.
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
