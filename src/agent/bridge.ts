/**
 * EXPERIMENTAL — `pimas/agent`, issue #13 (the agent-simulatable frontend).
 * A thin adapter over the public core turning a running UI's reactive graph into
 * an agent-facing surface across three layers:
 *
 *   L1 subscribe — expose(name, () => value) + subscribe(listener): the agent is
 *      PUSHED a delta the instant a value changes (createEffect IS a subscription).
 *   L2 explain   — call(name, ...) records a causal record (which fields the
 *      action wrote + which exposed values changed); read it via explain().
 *   L3 simulate  — speculate(name, ...) predicts the exposed state AFTER an
 *      action, computed against a shadow of the graph, WITHOUT committing.
 *
 * Headless (no DOM). Fine-grained: exposing `() => s.rows[3].status` subscribes
 * to exactly that store field. Field-level provenance (L2 `writes`) needs a
 * `writeTap` — wire `pimas/store`'s `onStoreWrite` in (see the option below).
 */
import { createEffect, createRoot, untrack, speculate as coreSpeculate } from "../reactive/index.js";
import type { Accessor } from "../reactive/index.js";

/** A pushed event: a state delta (L1) or a causal record (L2). */
export type AgentEvent =
  | { kind: "state"; name: string; value: unknown; initial: boolean }
  | { kind: "cause"; action: string; args: unknown[]; writes: string[]; changed: string[] };

/** L2: why the last action changed what it changed. */
export interface CauseRecord {
  action: string;
  args: unknown[];
  /** Field paths written during the action (present when a `writeTap` is wired). */
  writes: string[];
  /** Exposed names whose value changed as a result. */
  changed: string[];
}

/** The surface handed to `setup` — registers state/actions inside the root owner. */
export interface AgentRegistrar {
  /** Expose a readable, subscribable value under a stable name. */
  expose(name: string, read: Accessor<unknown>): void;
  /** Register an agent-callable action. */
  action(name: string, fn: (...args: unknown[]) => unknown): void;
}

export interface AgentOptions {
  /**
   * Optional source of field-level write labels for L2. Given a `record`
   * callback, subscribe to writes and forward each write's label; return an
   * unsubscribe. Wire `pimas/store`:
   *   writeTap: (record) => onStoreWrite((e) => record(e.path.join(".")))
   */
  writeTap?: (record: (label: string) => void) => () => void;
}

export interface AgentBridge {
  /** One-shot: current value of every exposed name + the action names. */
  snapshot(): { state: Record<string, unknown>; actions: string[] };
  /** Agent side: replay the current snapshot, then receive a delta on each change. */
  subscribe(listener: (e: AgentEvent) => void): () => void;
  /** Agent side: invoke a registered action by name. Unknown name throws. */
  call(name: string, ...args: unknown[]): unknown;
  /** L2: the causal record of the most recent action (or null before any call). */
  explain(): CauseRecord | null;
  /** L3: predict the exposed state after `actionName(...args)` WITHOUT committing. */
  speculate(actionName: string, ...args: unknown[]): Record<string, unknown>;
  /** Tear down every exposed subscription (disposes the root owner). */
  dispose(): void;
}

/**
 * Build a bridge. `setup` runs inside a fresh reactive root so every `expose`
 * effect is owned and disposable; register state/actions there.
 */
export function createAgentBridge(setup: (r: AgentRegistrar) => void, opts: AgentOptions = {}): AgentBridge {
  const listeners = new Set<(e: AgentEvent) => void>();
  const latest = new Map<string, unknown>();
  const reads = new Map<string, Accessor<unknown>>();
  const actions = new Map<string, (...args: unknown[]) => unknown>();
  let lastCause: CauseRecord | null = null;
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
      reads.set(name, read);
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

  const requireAction = (name: string): ((...args: unknown[]) => unknown) => {
    const fn = actions.get(name);
    if (!fn) throw new Error(`agent bridge: no action "${name}"`);
    return fn;
  };

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
      const fn = requireAction(name);
      // L2: capture the field writes (if a tap is wired) and the exposed values
      // that change, so the agent can be told WHY the state moved.
      const writes: string[] = [];
      const stopTap = opts.writeTap?.((label) => writes.push(label));
      const before = new Map(latest); // exposing effects update `latest` during fn()
      let result: unknown;
      try {
        result = untrack(() => fn(...args));
      } finally {
        stopTap?.();
      }
      const changed = [...latest.keys()].filter((k) => !Object.is(before.get(k), latest.get(k)));
      lastCause = { action: name, args, writes, changed };
      emit({ kind: "cause", action: name, args, writes, changed });
      return result;
    },
    explain: () => lastCause,
    speculate(actionName, ...args) {
      const fn = requireAction(actionName);
      // Apply the action + read every exposed value against a SHADOW of the graph
      // (L3). Nothing commits: the real store/signals are untouched on return.
      return coreSpeculate(
        () => void fn(...args),
        () => {
          const out: Record<string, unknown> = {};
          for (const [name, read] of reads) out[name] = read();
          return out;
        },
      );
    },
    dispose,
  };
}
