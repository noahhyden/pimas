/**
 * SPIKE test — issue #13, L1. Proves an agent can subscribe to live reactive
 * state and be pushed deltas on change, and call actions, entirely through the
 * public core (no kernel change). Fine-grained: a change to one exposed field
 * pushes a delta for exactly that name.
 */
import { describe, it, expect, vi } from "vitest";
import { createSignal, createMemo } from "pimas";
import { createStore, onStoreWrite } from "pimas/store";
import { createAgentBridge, type AgentEvent } from "../src/agent/bridge";

describe("agent bridge — L1 subscribe (issue #13)", () => {
  it("pushes an initial snapshot then a delta when exposed state changes", () => {
    const [n, setN] = createSignal(1);
    const bridge = createAgentBridge((r) => {
      r.expose("count", () => n());
    });

    const events: AgentEvent[] = [];
    bridge.subscribe((e) => events.push(e));

    // Late subscriber gets the current value as an initial event.
    expect(events).toEqual([{ kind: "state", name: "count", value: 1, initial: true }]);

    setN(2); // a plain signal write — the agent is PUSHED the delta, no polling
    expect(events).toEqual([
      { kind: "state", name: "count", value: 1, initial: true },
      { kind: "state", name: "count", value: 2, initial: false },
    ]);

    bridge.dispose();
  });

  it("is fine-grained: changing one store field pushes only that name", () => {
    const [s, set] = createStore({ a: 1, b: 2 });
    const bridge = createAgentBridge((r) => {
      r.expose("a", () => s.a);
      r.expose("b", () => s.b);
    });

    const spy = vi.fn();
    bridge.subscribe(spy);
    spy.mockClear(); // drop the two initial-snapshot replays

    set("a", 10); // only `a`'s exposing effect re-runs
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ kind: "state", name: "a", value: 10, initial: false });

    bridge.dispose();
  });

  it("exposes derived (memo-like) state and pushes when its inputs change", () => {
    const [qty, setQty] = createSignal(2);
    const [price] = createSignal(5);
    const bridge = createAgentBridge((r) => {
      r.expose("total", () => qty() * price());
    });

    const events: AgentEvent[] = [];
    bridge.subscribe((e) => events.push(e));
    expect(events.at(-1)).toEqual({ kind: "state", name: "total", value: 10, initial: true });

    setQty(3);
    expect(events.at(-1)).toEqual({ kind: "state", name: "total", value: 15, initial: false });

    bridge.dispose();
  });

  it("lets the agent call an action, which drives the pushed state", () => {
    const [s, set] = createStore({ rows: [{ id: "r1", status: "open" }] });
    const bridge = createAgentBridge((r) => {
      r.expose("row0.status", () => s.rows[0]!.status);
      r.action("setStatus", (i, status) => set("rows", i as number, "status", status));
    });

    const events: AgentEvent[] = [];
    bridge.subscribe((e) => events.push(e));

    expect(bridge.snapshot()).toEqual({ state: { "row0.status": "open" }, actions: ["setStatus"] });

    bridge.call("setStatus", 0, "done"); // agent invokes → state change → push
    const stateEvents = events.filter((e) => e.kind === "state");
    expect(stateEvents.at(-1)).toEqual({ kind: "state", name: "row0.status", value: "done", initial: false });

    expect(() => bridge.call("nope")).toThrow(/no action/);

    bridge.dispose();
  });

  it("records a causal record (L2): action → field writes + changed exposed values", () => {
    const [s, set] = createStore({ rows: [{ id: "a", status: "open" }, { id: "b", status: "open" }] });
    const openCount = createMemo(() => s.rows.filter((r) => r.status === "open").length);
    const bridge = createAgentBridge(
      (r) => {
        r.expose("openCount", () => openCount());
        r.action("setStatus", (i, st) => set("rows", i as number, "status", st));
      },
      { writeTap: (record) => onStoreWrite((e) => record(e.path.join("."))) },
    );

    const causes: AgentEvent[] = [];
    bridge.subscribe((e) => e.kind === "cause" && causes.push(e));

    bridge.call("setStatus", 0, "done");

    expect(bridge.explain()).toEqual({
      action: "setStatus",
      args: [0, "done"],
      writes: ["rows.0.status"],
      changed: ["openCount"],
    });
    // the cause is also pushed to subscribers
    expect(causes.at(-1)).toMatchObject({ kind: "cause", action: "setStatus", writes: ["rows.0.status"] });
    expect(openCount()).toBe(1); // committed

    bridge.dispose();
  });

  it("bridge.speculate predicts exposed state after an action, without committing (L3)", () => {
    const [s, set] = createStore({ rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }] });
    const total = createMemo(() => s.rows.reduce((x, r) => x + r.n, 0));
    const bridge = createAgentBridge((r) => {
      r.expose("total", () => total());
      r.action("setN", (i, v) => set("rows", i as number, "n", v));
    });

    const predicted = bridge.speculate("setN", 0, 100);
    expect(predicted).toEqual({ total: 102 }); // 100 + 2

    expect(total()).toBe(3); // real store untouched
    expect(bridge.snapshot().state).toEqual({ total: 3 });

    bridge.dispose();
  });

  it("stops pushing after dispose", () => {
    const [n, setN] = createSignal(0);
    const bridge = createAgentBridge((r) => r.expose("n", () => n()));
    const spy = vi.fn();
    bridge.subscribe(spy);
    spy.mockClear();

    bridge.dispose();
    setN(1); // exposing effect is disposed with the root — no push
    expect(spy).not.toHaveBeenCalled();
  });
});
