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

  it("speculatePlan composes multiple writes in one shadow (multi-factor scenario, L3)", () => {
    const [s, set] = createStore({ rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }] });
    const total = createMemo(() => s.rows.reduce((x, r) => x + r.n, 0));
    const bridge = createAgentBridge((r) => {
      r.expose("total", () => total());
      r.action("setN", (i, v) => set("rows", i as number, "n", v));
    });

    // Both writes apply against ONE shadow → combined after-state.
    const predicted = bridge.speculatePlan([
      ["setN", 0, 10],
      ["setN", 1, 20],
    ]);
    expect(predicted).toEqual({ total: 30 }); // 10 + 20, jointly

    expect(total()).toBe(3); // nothing committed
    bridge.dispose();
  });

  it("speculatePlan is NOT reducible to separate speculate calls (each resets the shadow)", () => {
    const [s, set] = createStore({ rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }] });
    const total = createMemo(() => s.rows.reduce((x, r) => x + r.n, 0));
    const bridge = createAgentBridge((r) => {
      r.expose("total", () => total());
      r.action("setN", (i, v) => set("rows", i as number, "n", v));
    });

    // Separate speculations each see only their own change against the real base.
    expect(bridge.speculate("setN", 0, 10)).toEqual({ total: 12 }); // 10 + 2
    expect(bridge.speculate("setN", 1, 20)).toEqual({ total: 21 }); // 1 + 20
    // The plan composes them — a result neither single call can produce.
    expect(bridge.speculatePlan([["setN", 0, 10], ["setN", 1, 20]])).toEqual({ total: 30 });

    expect(total()).toBe(3);
    bridge.dispose();
  });

  it("speculateSweep predicts state at each point of a sensitivity sweep (L3)", () => {
    const [power, setPower] = createSignal(250);
    const output = createMemo(() => power() * 4); // some derived model
    const bridge = createAgentBridge((r) => {
      r.expose("output", () => output());
      r.action("setPower", (v) => setPower(v as number));
    });

    const sweep = bridge.speculateSweep("setPower", [[250], [500], [1000]]);
    expect(sweep).toEqual([{ output: 1000 }, { output: 2000 }, { output: 4000 }]);

    expect(power()).toBe(250); // real signal untouched
    bridge.dispose();
  });

  it("plan/sweep are pure what-ifs — they record NO L2 causal history", () => {
    const [s, set] = createStore({ rows: [{ id: "a", n: 1 }] });
    const total = createMemo(() => s.rows.reduce((x, r) => x + r.n, 0));
    const bridge = createAgentBridge(
      (r) => {
        r.expose("total", () => total());
        r.action("setN", (i, v) => set("rows", i as number, "n", v));
      },
      { writeTap: (record) => onStoreWrite((e) => record(e.path.join("."))) },
    );

    bridge.speculatePlan([["setN", 0, 9]]);
    bridge.speculateSweep("setN", [[0, 5], [0, 7]]);
    expect(bridge.explain()).toBeNull(); // no action committed → no provenance
    expect(bridge.history()).toEqual([]);

    bridge.dispose();
  });

  it("commitPlan applies an approved scenario for real and returns committed state (L3)", () => {
    const [s, set] = createStore({ rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }] });
    const total = createMemo(() => s.rows.reduce((x, r) => x + r.n, 0));
    const bridge = createAgentBridge((r) => {
      r.expose("total", () => total());
      r.action("setN", (i, v) => set("rows", i as number, "n", v));
    });

    // Preview, then commit the SAME steps.
    const preview = bridge.speculatePlan([["setN", 0, 10], ["setN", 1, 20]]);
    expect(preview).toEqual({ total: 30 });
    expect(total()).toBe(3); // preview didn't commit

    const committed = bridge.commitPlan([["setN", 0, 10], ["setN", 1, 20]]);
    expect(committed).toEqual({ total: 30 });
    expect(total()).toBe(30); // NOW it's real
    expect(bridge.snapshot().state).toEqual({ total: 30 });

    bridge.dispose();
  });

  it("commitPlan records ONE coalesced L2 record, not N per-step (vs separate call()s)", () => {
    const record = (make: () => any) => {
      const [s, set] = createStore({ rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }] });
      const total = createMemo(() => s.rows.reduce((x, r) => x + r.n, 0));
      const bridge = createAgentBridge(
        (r) => {
          r.expose("total", () => total());
          r.action("setN", (i, v) => set("rows", i as number, "n", v));
        },
        { writeTap: (rec) => onStoreWrite((e) => rec(e.path.join("."))) },
      );
      make.call({ bridge });
      const h = bridge.history();
      bridge.dispose();
      return h;
    };

    // Two separate calls → two fragmented records.
    let b1!: ReturnType<typeof createAgentBridge>;
    const separate = record(function (this: { bridge: typeof b1 }) {
      this.bridge.call("setN", 0, 10);
      this.bridge.call("setN", 1, 20);
    });
    expect(separate.length).toBe(2);
    expect(separate.map((r) => r.action)).toEqual(["setN", "setN"]);

    // commitPlan → ONE record covering the whole scenario.
    const planned = record(function (this: { bridge: typeof b1 }) {
      this.bridge.commitPlan([["setN", 0, 10], ["setN", 1, 20]]);
    });
    expect(planned.length).toBe(1);
    expect(planned[0]!.action).toBe("plan");
    expect(planned[0]!.changed).toEqual(["total"]); // one coalesced "changed" set
    expect(planned[0]!.writes.sort()).toEqual(["rows.0.n", "rows.1.n"]); // both writes, one record
  });

  it("captures L2 provenance for an ASYNC action after its awaited writes land", async () => {
    const [s, set] = createStore({ rows: [{ id: "a", status: "open" }, { id: "b", status: "open" }] });
    const openCount = createMemo(() => s.rows.filter((r) => r.status === "open").length);
    const bridge = createAgentBridge(
      (r) => {
        r.expose("openCount", () => openCount());
        r.action("setStatusAsync", async (i, st) => {
          await Promise.resolve(); // the write lands PAST the first await
          set("rows", i as number, "status", st);
        });
      },
      { writeTap: (record) => onStoreWrite((e) => record(e.path.join("."))) },
    );

    const p = bridge.call("setStatusAsync", 0, "done") as Promise<unknown>;
    // Provenance must NOT be captured yet — the awaited write hasn't happened.
    expect(bridge.explain()).toBeNull();
    expect(openCount()).toBe(2);

    await p;

    // Now the awaited write has committed and provenance reflects it.
    expect(bridge.explain()).toEqual({
      action: "setStatusAsync",
      args: [0, "done"],
      writes: ["rows.0.status"],
      changed: ["openCount"],
    });
    expect(openCount()).toBe(1);

    bridge.dispose();
  });

  it("does not record provenance when an async action rejects", async () => {
    const [s, set] = createStore({ n: 0 });
    const bridge = createAgentBridge((r) => {
      r.expose("n", () => s.n);
      r.action("boom", async () => {
        await Promise.resolve();
        set("n", 1);
        throw new Error("nope");
      });
    });
    await expect(bridge.call("boom") as Promise<unknown>).rejects.toThrow("nope");
    expect(bridge.explain()).toBeNull(); // rejected → no cause recorded
    bridge.dispose();
  });

  it("retains a bounded L2 change log (history), oldest→newest", () => {
    const [s, set] = createStore({ rows: [{ id: "a", status: "open" }, { id: "b", status: "open" }] });
    const openCount = createMemo(() => s.rows.filter((r) => r.status === "open").length);
    const bridge = createAgentBridge(
      (r) => {
        r.expose("openCount", () => openCount());
        r.action("setStatus", (i, st) => set("rows", i as number, "status", st));
      },
      { writeTap: (record) => onStoreWrite((e) => record(e.path.join("."))), historyLimit: 2 },
    );

    expect(bridge.history()).toEqual([]); // nothing before any call

    bridge.call("setStatus", 0, "done");
    bridge.call("setStatus", 1, "done");
    // both retained, oldest→newest
    expect(bridge.history().map((c) => c.args)).toEqual([[0, "done"], [1, "done"]]);

    bridge.call("setStatus", 0, "open"); // exceeds historyLimit:2 → oldest dropped
    expect(bridge.history().map((c) => c.args)).toEqual([[1, "done"], [0, "open"]]);
    expect(bridge.history(1).map((c) => c.args)).toEqual([[0, "open"]]); // last N
    expect(bridge.explain()!.args).toEqual([0, "open"]); // last-cause unchanged

    bridge.dispose();
  });

  it("isolates a throwing listener: siblings still receive, host graph stays intact", () => {
    // emit() runs INSIDE the exposing effect, so an unguarded listener throw
    // would break sibling listeners AND the host's reactive flush. The throw is
    // re-raised on a microtask so it still surfaces without entangling the graph.
    const microtaskErrors: unknown[] = [];
    const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((cb) => {
      try {
        cb();
      } catch (err) {
        microtaskErrors.push(err);
      }
    });

    try {
      const [n, setN] = createSignal(0);
      const bridge = createAgentBridge((r) => r.expose("n", () => n()));

      const boom = new Error("listener blew up");
      // throw only on the delta (not the initial replay, which runs on the
      // agent's own subscribe() stack — the fix targets emit(), which fires
      // inside the host's exposing effect)
      const bad = vi.fn((e: AgentEvent) => {
        if (e.kind === "state" && !e.initial) throw boom;
      });
      const good = vi.fn();
      bridge.subscribe(bad); // registered first, so it fires first
      bridge.subscribe(good);
      bad.mockClear();
      good.mockClear();
      microtaskErrors.length = 0;

      // A bad listener throwing must not prevent `good` from being delivered,
      // and must not throw out of the host signal write.
      expect(() => setN(1)).not.toThrow();
      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledWith({ kind: "state", name: "n", value: 1, initial: false });
      // the error was surfaced (not swallowed), just deferred off the flush
      expect(microtaskErrors).toEqual([boom]);

      // the exposing effect is still live — a second write still pushes
      expect(() => setN(2)).not.toThrow();
      expect(good).toHaveBeenCalledWith({ kind: "state", name: "n", value: 2, initial: false });

      bridge.dispose();
    } finally {
      spy.mockRestore();
    }
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

describe("agent bridge — L0 graph / topology introspection (issue #37)", () => {
  it("reports the derives-from DAG (nodes + edges) of the exposed state", () => {
    // The kernel's own diamond: D = B + C, B = C = A + 1.
    const [a, setA] = createSignal(1);
    const b = createMemo(() => a() + 1);
    const c = createMemo(() => a() + 1);
    const d = createMemo(() => b() + c());
    const bridge = createAgentBridge((r) => r.expose("d", () => d()));

    const g = bridge.graph();

    // Four nodes: three memos (b, c, d) + one signal (a).
    expect(g.nodes.length).toBe(4);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const signals = g.nodes.filter((n) => n.kind === "signal");
    const memos = g.nodes.filter((n) => n.kind === "memo");
    expect(signals.length).toBe(1); // a
    expect(memos.length).toBe(3); // b, c, d

    // The exposed name backs its (single) seed node.
    const dNode = g.nodes.find((n) => n.name === "d")!;
    expect(dNode.kind).toBe("memo");
    expect(g.nodes.filter((n) => n.name !== undefined).length).toBe(1); // only "d" is named

    // Edges are directed source→dependent. The lone signal feeds two memos; two
    // memos feed the exposed memo. (Ids are opaque — assert the shape structurally.)
    const aNode = signals[0]!;
    const edgesFromA = g.edges.filter((e) => e.from === aNode.id);
    expect(edgesFromA.length).toBe(2); // a → b, a → c
    expect(edgesFromA.every((e) => byId.get(e.to)!.kind === "memo")).toBe(true);
    const edgesToD = g.edges.filter((e) => e.to === dNode.id);
    expect(edgesToD.length).toBe(2); // b → d, c → d
    expect(edgesToD.every((e) => byId.get(e.from)!.kind === "memo")).toBe(true);

    // Structural, NOT retrospective: the topology is present with no action ever
    // called (this is the whole point vs explain()/history()).
    expect(bridge.explain()).toBeNull();

    // It's a real read of the standing graph, unchanged by the value moving.
    setA(10);
    expect(bridge.graph().nodes.length).toBe(4);

    bridge.dispose();
  });

  it("is privacy-scoped: an internal, un-exposed node never appears", () => {
    const [a] = createSignal(1);
    const exposed = createMemo(() => a() + 1);
    createMemo(() => a() * 100); // NOT exposed and NOT read by any exposed accessor
    const bridge = createAgentBridge((r) => r.expose("exposed", () => exposed()));

    const g = bridge.graph();
    // Only the exposed memo + the signal it derives from — the sibling memo (an
    // observer of `a`, not a source of the exposed state) is invisible.
    expect(g.nodes.length).toBe(2);
    expect(g.nodes.map((n) => n.kind).sort()).toEqual(["memo", "signal"]);
    expect(g.nodes.find((n) => n.name === "exposed")!.kind).toBe("memo");

    bridge.dispose();
  });

  it("works through a store: a memo derives from the store field signals it reads", () => {
    const [s, set] = createStore({ rows: [{ id: "a", status: "open" }, { id: "b", status: "open" }] });
    const openCount = createMemo(() => s.rows.filter((r) => r.status === "open").length);
    const bridge = createAgentBridge((r) => {
      r.expose("openCount", () => openCount());
      r.action("setStatus", (i, st) => set("rows", i as number, "status", st));
    });

    const g = bridge.graph();
    const oc = g.nodes.find((n) => n.name === "openCount")!;
    expect(oc.kind).toBe("memo");
    // The memo has sources (the store's per-field signals it read) → inbound edges.
    expect(g.edges.some((e) => e.to === oc.id)).toBe(true);
    // Actions are not part of the derives-from graph.
    expect(g.nodes.some((n) => n.name === "setStatus")).toBe(false);

    set("rows", 0, "status", "done"); // topology unaffected by a value change
    expect(bridge.graph().nodes.find((n) => n.name === "openCount")).toBeTruthy();

    bridge.dispose();
  });

  it("assigns stable ids: the same node keeps its id across graph() calls", () => {
    const [a] = createSignal(1);
    const total = createMemo(() => a() * 2);
    const bridge = createAgentBridge((r) => r.expose("total", () => total()));

    const g1 = bridge.graph();
    const g2 = bridge.graph();
    const id1 = g1.nodes.find((n) => n.name === "total")!.id;
    const id2 = g2.nodes.find((n) => n.name === "total")!.id;
    expect(id2).toBe(id1);
    // Ids are stable identifiers, distinct per node within the graph.
    expect(new Set(g1.nodes.map((n) => n.id)).size).toBe(g1.nodes.length);

    bridge.dispose();
  });

  it("a composite accessor's inputs appear as nodes but back no single name", () => {
    const [qty] = createSignal(2);
    const [price] = createSignal(5);
    const bridge = createAgentBridge((r) => r.expose("total", () => qty() * price()));

    const g = bridge.graph();
    // Both signals are surfaced; neither carries the name (the derivation lives in
    // the accessor closure, not in a single reactive node).
    expect(g.nodes.length).toBe(2);
    expect(g.nodes.every((n) => n.kind === "signal")).toBe(true);
    expect(g.nodes.every((n) => n.name === undefined)).toBe(true);
    expect(g.edges).toEqual([]); // two independent leaf signals

    bridge.dispose();
  });

  it("introspection leaves NO subscription behind (does not entangle the graph)", () => {
    const [n, setN] = createSignal(0);
    const bridge = createAgentBridge((r) => r.expose("n", () => n()));
    const spy = vi.fn();
    bridge.subscribe(spy);
    spy.mockClear();

    bridge.graph(); // the probe reads n() then unsubscribes
    bridge.graph();
    bridge.graph();
    expect(spy).not.toHaveBeenCalled(); // graph() pushes nothing

    // The exposing effect is still the sole observer — one write, exactly one push.
    setN(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ kind: "state", name: "n", value: 1, initial: false });

    bridge.dispose();
  });
});
