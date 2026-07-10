/**
 * EXPERIMENTAL — `pimas/agent`, issue #13 (the agent-simulatable frontend).
 * A thin adapter over the public core turning a running UI's reactive graph into
 * an agent-facing surface across a structural read plus three layers:
 *
 *   L0 graph     — graph(): a read-only snapshot of the dependency TOPOLOGY (the
 *      nodes the exposed state derives from + the derives-from edges), scoped to
 *      the same exposed surface descriptor() draws. Structure, not values (#37).
 *   L1 subscribe — expose(name, () => value) + subscribe(listener): the agent is
 *      PUSHED a delta the instant a value changes (createEffect IS a subscription).
 *   L2 explain   — call(name, ...) records a causal record (which fields the
 *      action wrote + which exposed values changed); read it via explain().
 *   L3 simulate  — speculate(name, ...) predicts the exposed state AFTER an
 *      action, computed against a shadow of the graph, WITHOUT committing.
 *      speculatePlan(steps) composes several writes in one shadow (a multi-factor
 *      scenario); speculateSweep(name, argsList) runs an independent what-if per
 *      arg-set (a sensitivity sweep) — the planning half of L3. commitPlan(steps)
 *      applies an approved plan FOR REAL as one coalesced action (preview↔commit).
 *
 * Headless (no DOM). Fine-grained: exposing `() => s.rows[3].status` subscribes
 * to exactly that store field. Field-level provenance (L2 `writes`) needs a
 * `writeTap` — wire `pimas/store`'s `onStoreWrite` in (see the option below).
 */
import { createEffect, createRoot, untrack, batch, speculate as coreSpeculate } from "../reactive/index.js";
import type { Accessor } from "../reactive/index.js";
// The topology walk needs the kernel's private `Reactive` node internals, so it
// lives in the core module and is deep-imported here rather than surfaced on the
// public `pimas` core export — `bridge.graph()` is the scoped entry point (#37).
import { introspectGraph } from "../reactive/reactive.js";
import type { GraphNode, GraphEdge, DependencyGraph } from "../reactive/reactive.js";

export type { GraphNode, GraphEdge, DependencyGraph };

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
  /** Positional parameter names, in order — lets a named-arg caller map to the
   *  action's positional signature (e.g. `["id", "status"]`). */
  params?: string[];
  description?: string;
  /** Hint that the action doesn't mutate persistent state (WebMCP readOnlyHint). */
  readOnly?: boolean;
}

/** A machine-readable description of the surface — the artifact an agent reads. */
export interface AgentDescriptor {
  state: Record<string, { value: unknown; schema?: object; description?: string }>;
  actions: Record<string, { input?: object; params?: string[]; description?: string; readOnly?: boolean }>;
}

/** The surface handed to `setup` — registers state/actions inside the root owner. */
export interface AgentRegistrar {
  /** Expose a readable, subscribable value under a stable name. */
  expose(name: string, read: Accessor<unknown>, meta?: StateMeta): void;
  /** Register an agent-callable action. */
  action(name: string, fn: (...args: unknown[]) => unknown, meta?: ActionMeta): void;
}

export interface AgentOptions {
  /**
   * Optional source of field-level write labels for L2. Given a `record`
   * callback, subscribe to writes and forward each write's label; return an
   * unsubscribe. Wire `pimas/store`:
   *   writeTap: (record) => onStoreWrite((e) => record(e.path.join(".")))
   */
  writeTap?: (record: (label: string) => void) => () => void;
  /** How many recent causal records `history()` retains (L2 change log). Default 50. */
  historyLimit?: number;
}

export interface AgentBridge {
  /** One-shot: current value of every exposed name + the action names. */
  snapshot(): { state: Record<string, unknown>; actions: string[] };
  /** Agent side: replay the current snapshot, then receive a delta on each change. */
  subscribe(listener: (e: AgentEvent) => void): () => void;
  /** A machine-readable description of exposed state + actions (the wire contract). */
  descriptor(): AgentDescriptor;
  /** L0 structural read (#37): a point-in-time snapshot of the reactive dependency
   *  TOPOLOGY — the nodes (signals/memos) the exposed state derives from and the
   *  derives-from edges between them. Unlike `explain()`/`history()` (retrospective,
   *  action-scoped causality), this is the standing structure, present before any
   *  action. Privacy-scoped to exactly what `descriptor()` exposes; structure only
   *  (no values or recompute counts — those stay cheap-by-default opt-ins). */
  graph(): DependencyGraph;
  /** Agent side: invoke a registered action by name. Unknown name throws. An
   *  async action returns a promise that resolves AFTER its awaited writes land
   *  and L2 provenance is captured; a sync action returns its value directly. */
  call(name: string, ...args: unknown[]): unknown;
  /** L2: the causal record of the most recent action (or null before any call). */
  explain(): CauseRecord | null;
  /** L2 change log: recent causal records, oldest→newest (bounded by
   *  `historyLimit`). `limit` returns only the last N. Empty before any call. */
  history(limit?: number): CauseRecord[];
  /** L3: predict the exposed state after `actionName(...args)` WITHOUT committing. */
  speculate(actionName: string, ...args: unknown[]): Record<string, unknown>;
  /** L3 multi-factor scenario: predict the exposed state after applying ALL `steps`
   *  in order against ONE shadow graph. Not reducible to separate `speculate` calls
   *  — those each reset the shadow, this composes the writes. Nothing commits. */
  speculatePlan(steps: Array<[string, ...unknown[]]>): Record<string, unknown>;
  /** L3 sensitivity sweep: run one INDEPENDENT speculation of `actionName` per
   *  arg-set, returning the predicted exposed state at each point. Nothing commits. */
  speculateSweep(actionName: string, argsList: unknown[][]): Record<string, unknown>[];
  /** L3 commit: apply an approved plan (previewed by `speculatePlan`) for REAL —
   *  all steps in ONE batch, yielding ONE coalesced L2 record (`action:"plan"`),
   *  not N fragmented per-step records. Returns the committed exposed state. The
   *  preview↔commit mirror of `speculatePlan`. */
  commitPlan(steps: Array<[string, ...unknown[]]>): Record<string, unknown>;
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
  const stateMeta = new Map<string, StateMeta>();
  const actions = new Map<string, (...args: unknown[]) => unknown>();
  const actionMeta = new Map<string, ActionMeta>();
  let lastCause: CauseRecord | null = null;
  const causeLog: CauseRecord[] = [];
  const historyLimit = opts.historyLimit ?? 50;
  let dispose!: () => void;

  const emit = (e: AgentEvent): void => {
    // untrack so a listener that happens to read a signal never subscribes the
    // exposing effect to it — the agent observes, it must not entangle the graph.
    untrack(() => {
      for (const l of listeners) {
        // Isolate each listener: `emit` runs INSIDE the exposing effect (see
        // `expose`), so a throwing agent-side listener would otherwise propagate
        // into the host's reactive flush — breaking sibling listeners and the
        // exposing effect itself. Re-throw on a microtask so the error still
        // surfaces (global onerror / unhandledRejection) without entangling or
        // corrupting the synchronous host update.
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
      // The effect runs once now (seeds `latest`) and re-runs on every change to
      // whatever `read` touched — that re-run IS the push. No core change.
      createEffect(() => {
        const value = read();
        const initial = !latest.has(name);
        latest.set(name, value);
        emit({ kind: "state", name, value, initial });
      });
    },
    action(name, fn, meta) {
      actions.set(name, fn);
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

  /** Read every exposed value once — the L3 "predicted after-state" projection.
   *  Called inside a `speculate` read phase, so these reads hit the shadow graph. */
  const readAllExposed = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, read] of reads) out[name] = read();
    return out;
  };

  return {
    snapshot: () => ({
      state: Object.fromEntries(latest),
      actions: [...actions.keys()],
    }),
    descriptor: () => {
      const state: AgentDescriptor["state"] = {};
      for (const [name, value] of latest) {
        const meta = stateMeta.get(name);
        state[name] = { value, schema: meta?.schema, description: meta?.description };
      }
      const actionsOut: AgentDescriptor["actions"] = {};
      for (const name of actions.keys()) {
        const meta = actionMeta.get(name);
        actionsOut[name] = {
          input: meta?.input,
          params: meta?.params,
          description: meta?.description,
          readOnly: meta?.readOnly,
        };
      }
      return { state, actions: actionsOut };
    },
    // L0: introspect the topology reachable from the exposed reads. `reads` is the
    // exact privacy boundary — passing only it scopes the walk to exposed state,
    // exactly as `descriptor()` iterates only exposed names. Structure-only.
    graph: () => introspectGraph(reads),
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
      // Record provenance once the action's effects have all landed. For an
      // ASYNC action this must run AFTER the promise settles — otherwise the
      // awaited writes (which happen past the first await) are missed (#13).
      const settle = (): void => {
        stopTap?.();
        const changed = [...latest.keys()].filter((k) => !Object.is(before.get(k), latest.get(k)));
        lastCause = { action: name, args, writes, changed };
        // Bounded change log (oldest→newest): the recent sequence, not just last.
        causeLog.push(lastCause);
        if (causeLog.length > historyLimit) causeLog.shift();
        emit({ kind: "cause", action: name, args, writes, changed });
      };

      let result: unknown;
      try {
        result = untrack(() => fn(...args));
      } catch (e) {
        stopTap?.(); // no provenance on a synchronous throw (as before)
        throw e;
      }
      // Async action: defer provenance until its awaited writes have committed.
      // `call` returns a promise resolving to the action's value, post-capture.
      if (result != null && typeof (result as { then?: unknown }).then === "function") {
        return (result as Promise<unknown>).then(
          (v) => {
            settle();
            return v;
          },
          (e) => {
            stopTap?.(); // rejected → no provenance, just unsubscribe
            throw e;
          },
        );
      }
      settle();
      return result;
    },
    explain: () => lastCause,
    history: (limit) => (limit == null ? causeLog.slice() : causeLog.slice(-limit)),
    speculate(actionName, ...args) {
      const fn = requireAction(actionName);
      // Apply the action + read every exposed value against a SHADOW of the graph
      // (L3). Nothing commits: the real store/signals are untouched on return.
      return coreSpeculate(() => void fn(...args), readAllExposed);
    },
    speculatePlan(steps) {
      // One shadow graph, all steps applied in order — the writes COMPOSE (a
      // multi-factor scenario). Same-field writes are last-write-wins, mirroring
      // reality. Nothing commits.
      return coreSpeculate(() => {
        for (const [name, ...args] of steps) requireAction(name)(...args);
      }, readAllExposed);
    },
    speculateSweep(actionName, argsList) {
      // One INDEPENDENT top-level speculation per arg-set — a sensitivity sweep.
      // Each is a fresh shadow (so it never nests), and none commits.
      const fn = requireAction(actionName);
      return argsList.map((args) => coreSpeculate(() => void fn(...args), readAllExposed));
    },
    commitPlan(steps) {
      // The commit mirror of speculatePlan: apply all steps FOR REAL in one batch
      // (writes coalesce to a single flush) and record ONE coalesced L2 record —
      // provenance for "applied scenario X", not N fragmented per-step records.
      // Sync-pure, like speculatePlan. Reuses call()'s provenance machinery once.
      const writes: string[] = [];
      const stopTap = opts.writeTap?.((label) => writes.push(label));
      const before = new Map(latest); // exposing effects update `latest` on flush
      try {
        batch(() => {
          for (const [name, ...args] of steps) requireAction(name)(...args);
        });
      } catch (e) {
        stopTap?.(); // partial writes may have landed; no coalesced record on throw
        throw e;
      }
      stopTap?.();
      const changed = [...latest.keys()].filter((k) => !Object.is(before.get(k), latest.get(k)));
      lastCause = { action: "plan", args: steps, writes, changed };
      causeLog.push(lastCause);
      if (causeLog.length > historyLimit) causeLog.shift();
      emit({ kind: "cause", action: "plan", args: steps, writes, changed });
      return Object.fromEntries(latest);
    },
    dispose,
  };
}
