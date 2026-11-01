/** Agent surface over a live reactive graph: snapshot, subscribe, call, explain, speculate. */
import { createEffect, createRoot, untrack, batch, speculate as coreSpeculate } from "../reactive/index.js";
import type { Accessor } from "../reactive/index.js";
// Deep import, not the public export — see AGENTS.d/313-introspectgraph-is-deep-imported-from-the-kernel-and-reads-is-the-privacy-boundary.md
import { introspectGraph } from "../reactive/reactive.js";
import type { GraphNode, GraphEdge, DependencyGraph } from "../reactive/reactive.js";

export type { GraphNode, GraphEdge, DependencyGraph };

/** A pushed event: a state delta or a causal record. */
export type AgentEvent =
  | { kind: "state"; name: string; value: unknown; initial: boolean }
  | { kind: "cause"; action: string; args: unknown[]; writes: string[]; changed: string[] };

/** Why an action changed what it changed. */
export interface CauseRecord {
  action: string;
  args: unknown[];
  /** Field paths written during the action (present when a `writeTap` is wired). */
  writes: string[];
  /** Exposed names whose value changed as a result. */
  changed: string[];
}

/** Optional metadata for an exposed value (feeds the machine-readable descriptor). */
export interface StateMeta {
  /** JSON Schema for the value's type. */
  schema?: object;
  description?: string;
}

/** Optional metadata for an action (feeds the descriptor + WebMCP tool schema). */
export interface ActionMeta {
  /** JSON Schema for the arguments (object form). If omitted, `params` builds one. */
  input?: object;
  /** Positional parameter names in order, so a named-arg caller can map onto the action signature. */
  params?: string[];
  description?: string;
  /** Hint that the action doesn't mutate persistent state (WebMCP readOnlyHint). */
  readOnly?: boolean;
}

/** A machine-readable description of the surface — the artifact an agent reads. */
export interface AgentDescriptor {
  state: Record<string, StateMeta & { value: unknown }>;
  actions: Record<string, ActionMeta>;
}

/** The surface handed to `setup` — registers state/actions inside the root owner. */
export interface AgentRegistrar {
  /** Expose a readable, subscribable value under a stable name. */
  expose(name: string, read: Accessor<unknown>, meta?: StateMeta): void;
  /** Register an agent-callable action; `fn` may declare real parameter types. */
  action<A extends unknown[]>(name: string, fn: (...args: A) => unknown, meta?: ActionMeta): void;
}

export interface AgentOptions {
  /** Source of field-level write labels: forward each write's label to `record`, return an unsubscribe. */
  writeTap?: (record: (label: string) => void) => () => void;
  /** How many recent causal records `history()` retains. Default 50. */
  historyLimit?: number;
}

export interface AgentBridge {
  /** One-shot: current value of every exposed name + the action names. */
  snapshot(): { state: Record<string, unknown>; actions: string[] };
  /** Agent side: replay the current snapshot, then receive a delta on each change. */
  subscribe(listener: (e: AgentEvent) => void): () => void;
  /** A machine-readable description of exposed state + actions (the wire contract). */
  descriptor(): AgentDescriptor;
  /** Standing dependency topology (nodes and derives-from edges) of exposed state only; structure, no values. */
  graph(): DependencyGraph;
  /** Invoke an action by name (unknown name throws); an async action resolves after its writes land and provenance is captured. */
  call(name: string, ...args: unknown[]): unknown;
  /** Causal record of the most recent action, or null before any call. */
  explain(): CauseRecord | null;
  /** Recent causal records, oldest to newest, bounded by `historyLimit`; `limit` keeps the last N. */
  history(limit?: number): CauseRecord[];
  /** Predict the exposed state after `actionName(...args)` without committing. */
  speculate(actionName: string, ...args: unknown[]): Record<string, unknown>;
  /** Predict the exposed state after applying all `steps` in order against one shadow graph; nothing commits. */
  speculatePlan(steps: Array<[string, ...unknown[]]>): Record<string, unknown>;
  /** Apply a plan for real in one batch with one coalesced `action:"plan"` record; returns the committed state. */
  commitPlan(steps: Array<[string, ...unknown[]]>): Record<string, unknown>;
  /** Tear down every exposed subscription (disposes the root owner). */
  dispose(): void;
}

/** Build a bridge; `setup` runs inside a fresh reactive root so every `expose` effect is disposable. */
export function createAgentBridge(setup: (r: AgentRegistrar) => void, opts: AgentOptions = {}): AgentBridge {
  const listeners = new Set<(e: AgentEvent) => void>();
  const latest = new Map<string, unknown>();
  const reads = new Map<string, Accessor<unknown>>();
  const stateMeta = new Map<string, StateMeta>();
  const actions = new Map<string, (...args: unknown[]) => unknown>();
  const actionMeta = new Map<string, ActionMeta>();
  const causeLog: CauseRecord[] = [];
  const historyLimit = opts.historyLimit ?? 50;
  let dispose!: () => void;

  const emit = (e: AgentEvent): void => {
    // see AGENTS.d/311-the-bridge-emit-must-be-untracked-or-an-agent-listener-entangles-the-host-graph.md
    untrack(() => {
      for (const l of listeners) {
        // see AGENTS.d/310-the-bridge-emit-runs-inside-the-exposing-effect-so-isolate-each-listener-and-rethrow-on-a-microtask.md
        try {
          l(e);
        } catch (err) {
          queueMicrotask(() => {
            throw err;
          });
        }
      }
    });
  };

  const registrar: AgentRegistrar = {
    expose(name, read, meta) {
      reads.set(name, read);
      if (meta) stateMeta.set(name, meta);
      // The effect's first run seeds `latest`; each re-run is the push.
      createEffect(() => {
        const value = read();
        const initial = !latest.has(name);
        latest.set(name, value);
        emit({ kind: "state", name, value, initial });
      });
    },
    action(name, fn, meta) {
      actions.set(name, fn as (...args: unknown[]) => unknown);
      if (meta) actionMeta.set(name, meta);
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

  /** Read every exposed value once; inside a `speculate` read phase these hit the shadow graph. */
  const readAllExposed = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, read] of reads) out[name] = read();
    return out;
  };

  /** Capture field writes and changed exposed values around an action. */
  const withProvenance = (action: string, args: unknown[]): { record(): void; abort(): void } => {
    const writes: string[] = [];
    const stopTap = opts.writeTap?.((label) => writes.push(label));
    const before = new Map(latest);
    return {
      abort: () => stopTap?.(),
      record() {
        stopTap?.();
        const changed = [...latest.keys()].filter((k) => !Object.is(before.get(k), latest.get(k)));
        const cause = { action, args, writes, changed };
        causeLog.push(cause);
        if (causeLog.length > historyLimit) causeLog.shift();
        emit({ kind: "cause", ...cause });
      },
    };
  };

  return {
    snapshot: () => ({
      state: Object.fromEntries(latest),
      actions: [...actions.keys()],
    }),
    descriptor: () => {
      const state: AgentDescriptor["state"] = {};
      for (const [name, value] of latest) state[name] = { value, ...stateMeta.get(name) };
      const actionsOut: AgentDescriptor["actions"] = {};
      for (const name of actions.keys()) actionsOut[name] = { ...actionMeta.get(name) };
      return { state, actions: actionsOut };
    },
    // `reads` is the privacy boundary — see AGENTS.d/313-introspectgraph-is-deep-imported-from-the-kernel-and-reads-is-the-privacy-boundary.md
    graph: () => introspectGraph(reads),
    subscribe(listener) {
      for (const [name, value] of latest) listener({ kind: "state", name, value, initial: true });
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call(name, ...args) {
      const fn = requireAction(name);
      const prov = withProvenance(name, args);
      let result: unknown;
      try {
        result = untrack(() => fn(...args));
      } catch (e) {
        prov.abort();
        throw e;
      }
      // see AGENTS.d/312-an-async-action-records-provenance-only-after-its-promise-settles-and-records-nothing-on-throw-or-reject.md
      if (result != null && typeof (result as { then?: unknown }).then === "function") {
        return (result as Promise<unknown>).then(
          (v) => {
            prov.record();
            return v;
          },
          (e) => {
            prov.abort();
            throw e;
          },
        );
      }
      prov.record();
      return result;
    },
    explain: () => causeLog.at(-1) ?? null,
    history: (limit) => (limit == null ? causeLog.slice() : causeLog.slice(-limit)),
    speculate(actionName, ...args) {
      const fn = requireAction(actionName);
      return coreSpeculate(() => void fn(...args), readAllExposed);
    },
    speculatePlan(steps) {
      // One shadow graph: writes compose, same-field writes are last-write-wins.
      return coreSpeculate(() => {
        for (const [name, ...args] of steps) requireAction(name)(...args);
      }, readAllExposed);
    },
    commitPlan(steps) {
      const prov = withProvenance("plan", steps);
      try {
        batch(() => {
          for (const [name, ...args] of steps) requireAction(name)(...args);
        });
      } catch (e) {
        prov.abort();
        throw e;
      }
      prov.record();
      return Object.fromEntries(latest);
    },
    dispose,
  };
}
