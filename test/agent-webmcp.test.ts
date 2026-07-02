/**
 * WebMCP projection (issue #13): a bridge's actions become WebMCP tools and its
 * exposed state becomes read-only `get_<name>` tools, tested against a mock host
 * that matches the spec — `registerTool(tool, { signal })`, teardown via abort,
 * `execute` returning the MCP content envelope.
 */
import { describe, it, expect } from "vitest";
import { createStore } from "pimas/store";
import { createAgentBridge } from "../src/agent/bridge";
import {
  toWebMCP,
  detectModelContext,
  type ModelContext,
  type WebMCPTool,
  type WebMCPRegisterOptions,
} from "../src/agent/webmcp";

function mockHost() {
  const tools = new Map<string, WebMCPTool>();
  const host: ModelContext = {
    registerTool(tool: WebMCPTool, options?: WebMCPRegisterOptions) {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
    },
  };
  return { host, tools };
}

/** Pull the value back out of the MCP content envelope an execute returns. */
async function callTool(tool: WebMCPTool, input: Record<string, unknown> = {}): Promise<unknown> {
  const r = (await tool.execute(input)) as { content: Array<{ text: string }> };
  return JSON.parse(r.content[0]!.text);
}

describe("toWebMCP — project the bridge onto the WebMCP tool API (issue #13)", () => {
  function build() {
    const [s, set] = createStore({ n: 1 });
    const bridge = createAgentBridge((r) => {
      r.expose("n", () => s.n, { description: "the number" });
      r.action("setN", (v) => set("n", v as number), { params: ["value"], description: "set n" });
      r.action("peek", () => s.n, { readOnly: true });
    });
    return { s, bridge };
  }

  it("registers actions as tools whose execute routes to bridge.call", async () => {
    const { s, bridge } = build();
    const { host, tools } = mockHost();
    const teardown = toWebMCP(bridge, { provider: host });

    const setN = tools.get("setN")!;
    expect(setN.description).toBe("set n");
    expect(setN.inputSchema).toEqual({ type: "object", properties: { value: {} }, required: ["value"] });
    expect(setN.annotations).toBeUndefined();

    await setN.execute({ value: 42 }); // named arg → positional → bridge.call("setN", 42)
    expect(s.n).toBe(42); // real mutation committed through the bridge

    // A read-only action carries the WebMCP hint.
    expect(tools.get("peek")!.annotations).toEqual({ readOnlyHint: true });

    teardown(); // aborts the controller → host removes every tool
    expect(tools.size).toBe(0);
  });

  it("registers exposed state as read-only get_<name> tools returning the live value", async () => {
    const { bridge } = build();
    const { host, tools } = mockHost();
    toWebMCP(bridge, { provider: host });

    const getN = tools.get("get_n")!;
    expect(getN.annotations).toEqual({ readOnlyHint: true });
    expect(getN.description).toBe("the number");
    expect(await callTool(getN)).toBe(1);

    // it's a LIVE read — reflects a later change made through another tool
    await tools.get("setN")!.execute({ value: 9 });
    expect(await callTool(getN)).toBe(9);

    // readTools:false suppresses them.
    const { host: h2, tools: t2 } = mockHost();
    toWebMCP(bridge, { provider: h2, readTools: false });
    expect([...t2.keys()].some((k) => k.startsWith("get_"))).toBe(false);
  });

  it("namespaces tool names to avoid cross-island collisions", () => {
    const { bridge } = build();
    const { host, tools } = mockHost();
    toWebMCP(bridge, { provider: host, namespace: "records" });
    expect(tools.has("records.setN")).toBe(true);
    expect(tools.has("records.get_n")).toBe(true);
  });

  it("projects L3 as simulate_<name> tools that predict without committing", async () => {
    const { s, bridge } = build();
    const { host, tools } = mockHost();
    toWebMCP(bridge, { provider: host });

    const sim = tools.get("simulate_setN")!;
    expect(sim.annotations).toEqual({ readOnlyHint: true }); // a what-if never mutates
    const predicted = await callTool(sim, { value: 77 });
    expect(predicted).toEqual({ n: 77 }); // predicted after-state
    expect(s.n).toBe(1); // ...but NOTHING committed — the real store is untouched

    // A read-only action has nothing to speculate → no simulate_ tool.
    expect(tools.has("simulate_peek")).toBe(false);
  });

  it("projects simulate_plan (multi-factor) and simulate_sweep (sensitivity)", async () => {
    const { s, bridge } = build();
    const { host, tools } = mockHost();
    toWebMCP(bridge, { provider: host });

    // plan: several steps composed in one shadow; last-write-wins, nothing commits
    const planned = await callTool(tools.get("simulate_plan")!, {
      steps: [{ action: "setN", args: [3] }, { action: "setN", args: [8] }],
    });
    expect(planned).toEqual({ n: 8 });

    // sweep: one independent prediction per arg-set
    const swept = await callTool(tools.get("simulate_sweep")!, {
      action: "setN",
      argsList: [[10], [20], [30]],
    });
    expect(swept).toEqual([{ n: 10 }, { n: 20 }, { n: 30 }]);

    expect(s.n).toBe(1); // every what-if left the real store untouched
  });

  it("simulateTools:false yields a poke-and-rescrape baseline (the A/B switch)", () => {
    const { bridge } = build();
    const { host, tools } = mockHost();
    toWebMCP(bridge, { provider: host, simulateTools: false });
    expect([...tools.keys()].some((k) => k.startsWith("simulate_"))).toBe(false);
    expect(tools.has("setN")).toBe(true); // actions + reads still present
    expect(tools.has("get_n")).toBe(true);
  });

  it("returns null host under Node and throws without a provider", () => {
    expect(detectModelContext()).toBe(null);
    const { bridge } = build();
    expect(() => toWebMCP(bridge)).toThrow(/no WebMCP host/);
  });
});
