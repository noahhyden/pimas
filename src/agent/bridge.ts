/**
 * SPIKE — issue #13, layer L1 (agent-simulatable frontend). NOT a shipped
 * subpath: absent from package.json exports and the size budget on purpose.
 *
 * Thesis being validated: an AI agent can SUBSCRIBE to a UI's live reactive
 * state and be PUSHED a delta the instant it changes — no DOM polling, no
 * re-scraping — with ZERO reactive-core changes, because `createEffect` already
 * IS a subscription. The bridge is a thin adapter over the public core:
 *
 *   - expose(name, () => value)  → the read surface (readable/subscribable state)
 *   - action(name, fn)           → the write surface (agent-callable actions)
 *   - subscribe(listener)        → agent side: current snapshot, then live deltas
 *   - call(name, ...args)        → agent side: invoke an action
 *
 * Headless (no DOM). Fine-grained: exposing `() => s.rows[3].status` subscribes
 * only to that store field, so the agent is pushed a delta for exactly that cell.
 */
import { createEffect, createRoot, untrack } from "../reactive/index.js";
import type { Accessor } from "../reactive/index.js";

/** A pushed change to a piece of exposed state. */
export interface AgentEvent {
  kind: "state";
  name: string;
  value: unknown;
  /** true only for the value's first observation (the initial snapshot). */
  initial: boolean;
}

/** The surface handed to `setup` — registers state/actions inside the root owner. */
export interface AgentRegistrar {
  /** Expose a readable, subscribable value under a stable name. */
  expose(name: string, read: Accessor<unknown>): void;
  /** Register an agent-callable action. */
  action(name: string, fn: (...args: unknown[]) => unknown): void;
}

export interface AgentBridge {
  /** One-shot: current value of every exposed name + the action names. */
  snapshot(): { state: Record<string, unknown>; actions: string[] };
  /** Agent side: replay the current snapshot, then receive a delta on each change. */
  subscribe(listener: (e: AgentEvent) => void): () => void;
  /** Agent side: invoke a registered action by name. Unknown name throws. */
  call(name: string, ...args: unknown[]): unknown;
  /** Tear down every exposed subscription (disposes the root owner). */
  dispose(): void;
}

/**
 * Build a bridge. `setup` runs inside a fresh reactive root so every `expose`
 * effect is owned and disposable; register state/actions there.
 */
export function createAgentBridge(setup: (r: AgentRegistrar) => void): AgentBridge {
  const listeners = new Set<(e: AgentEvent) => void>();
  const latest = new Map<string, unknown>();
  const actions = new Map<string, (...args: unknown[]) => unknown>();
  let dispose!: () => void;

  const emit = (e: AgentEvent): void => {
    // untrack so a listener that happens to read a signal never subscribes the
    // exposing effect to it — the agent observes, it must not entangle the graph.
    untrack(() => {
      for (const l of listeners) l(e);
    });
  };

  const registrar: AgentRegistrar = {
    expose(name, read) {
      // The effect runs once now (seeds `latest`) and re-runs on every change to
      // whatever `read` touched — that re-run IS the push. No core change.
      createEffect(() => {
        const value = read();
        const initial = !latest.has(name);
        latest.set(name, value);
        emit({ kind: "state", name, value, initial });
      });
    },
    action(name, fn) {
      actions.set(name, fn);
    },
  };

  createRoot((d) => {
    dispose = d;
    setup(registrar);
  });

  return {
    snapshot: () => ({
      state: Object.fromEntries(latest),
      actions: [...actions.keys()],
    }),
    subscribe(listener) {
      // Replay the current state so a late subscriber isn't blind, then stream.
      for (const [name, value] of latest) listener({ kind: "state", name, value, initial: true });
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call(name, ...args) {
      const fn = actions.get(name);
      if (!fn) throw new Error(`agent bridge: no action "${name}"`);
      return untrack(() => fn(...args));
    },
    dispose,
  };
}
