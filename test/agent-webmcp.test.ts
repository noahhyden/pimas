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

  it("returns null host under Node and throws without a provider", () => {
    expect(detectModelContext()).toBe(null);
    const { bridge } = build();
    expect(() => toWebMCP(bridge)).toThrow(/no WebMCP host/);
  });
});
