import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../src/store/index.js";
import { createAgentBridge } from "../src/agent/index.js";
import { installPageAgent, type PageAgent } from "../src/agent/page.js";
import type { WebMCPTool } from "../src/agent/webmcp.js";

function build() {
  const [state, setState] = createStore({ n: 1 });
  const bridge = createAgentBridge((registrar) => {
    registrar.expose("n", () => state.n);
    registrar.action("setN", (value) => setState("n", value as number), {
      params: ["value"],
      description: "Set n.",
    });
  });
  return { state, bridge };
}

async function toolValue(tool: WebMCPTool, input: Record<string, unknown>): Promise<unknown> {
  const result = (await tool.execute(input)) as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0]!.text) as unknown;
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { __pimas?: unknown }).__pimas;
  delete (document as Document & { modelContext?: unknown }).modelContext;
});

describe("page agent", () => {
  it("installs without modelContext and exposes non-mutating simulation plus committed call", async () => {
    const { state, bridge } = build();
    const installed = installPageAgent(bridge, { namespace: "cartonization" });
    const root = (globalThis as typeof globalThis & {
      __pimas?: { cartonization?: PageAgent };
    }).__pimas;

    expect(root?.cartonization).toBe(installed);
    expect(root?.cartonization?.tools).toBeInstanceOf(Map);
    const simulate = installed.tools.get("cartonization.simulate_setN")!;
    expect(simulate.annotations).toEqual({ readOnlyHint: true });

    expect(await toolValue(simulate, { value: 8 })).toEqual({ n: 8 });
    expect(state.n).toBe(1);
    expect(bridge.snapshot().state).toEqual({ n: 1 });

    await installed.bridge.call("setN", 8);
    expect(state.n).toBe(8);
    expect(bridge.snapshot().state).toEqual({ n: 8 });
    bridge.dispose();
  });

  it("installs un-namespaced at window.__pimas.default", () => {
    const { bridge } = build();
    const installed = installPageAgent(bridge);
    expect((globalThis as { __pimas?: Record<string, unknown> }).__pimas?.default).toBe(installed);
    expect(installed.tools.has("setN")).toBe(true);
    bridge.dispose();
  });

  it("also registers with WebMCP when modelContext exists", () => {
    const { bridge } = build();
    const registered = new Map<string, WebMCPTool>();
    (document as Document & {
      modelContext?: { registerTool(tool: WebMCPTool): void };
    }).modelContext = {
      registerTool(tool) {
        registered.set(tool.name, tool);
      },
    };

    installPageAgent(bridge, { namespace: "cartonization" });

    expect(registered.has("cartonization.setN")).toBe(true);
    expect(registered.has("cartonization.simulate_setN")).toBe(true);
    bridge.dispose();
  });
});
