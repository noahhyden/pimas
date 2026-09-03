import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "pimas/store";
import { createAgentBridge } from "pimas/agent";
import {
  connectRemoteBridge,
  handleBridgeRequest,
  installPageAgent,
  type BridgeRequest,
  type PageAgent,
} from "pimas/agent/page";
import type { WebMCPTool } from "pimas/agent/webmcp";

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
    const installed = await installPageAgent(bridge, { namespace: "cartonization" });
    const root = (globalThis as typeof globalThis & {
      __pimas?: { cartonization?: PageAgent };
    }).__pimas;

    expect(root?.cartonization).toBe(installed);
    expect(root?.cartonization?.tools).toBeInstanceOf(Map);
    const simulate = installed.tools.get("simulate_setN")!;
    expect(simulate.annotations).toEqual({ readOnlyHint: true });

    expect(await toolValue(simulate, { value: 8 })).toEqual({ n: 8 });
    expect(state.n).toBe(1);
    expect(bridge.snapshot().state).toEqual({ n: 1 });

    await installed.call("setN", 8);
    expect(state.n).toBe(8);
    expect(bridge.snapshot().state).toEqual({ n: 8 });
    bridge.dispose();
  });

  it("dispatches speculate without mutation and call with mutation", async () => {
    const { state, bridge } = build();

    expect(
      await handleBridgeRequest(bridge, { op: "speculate", action: "setN", args: [4] }),
    ).toEqual({ n: 4 });
    expect(state.n).toBe(1);

    expect(await handleBridgeRequest(bridge, { op: "call", action: "setN", args: [4] })).toBeNull();
    expect(state.n).toBe(4);
    expect(await handleBridgeRequest(bridge, { op: "snapshot" })).toEqual({
      state: { n: 4 },
      actions: ["setN"],
    });
    bridge.dispose();
  });

  it("also registers with WebMCP when modelContext exists", async () => {
    const { bridge } = build();
    const registered = new Map<string, WebMCPTool>();
    (document as Document & {
      modelContext?: { registerTool(tool: WebMCPTool): void };
    }).modelContext = {
      registerTool(tool) {
        registered.set(tool.name, tool);
      },
    };

    await installPageAgent(bridge, { namespace: "cartonization" });

    expect(registered.has("cartonization.setN")).toBe(true);
    expect(registered.has("cartonization.simulate_setN")).toBe(true);
    bridge.dispose();
  });

  it("connects a remote bridge through a fake POST transport", async () => {
    const { state, bridge } = build();
    const requests: BridgeRequest[] = [];
    const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as BridgeRequest;
      requests.push(body);
      const result = await handleBridgeRequest(bridge, body);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const remote = connectRemoteBridge({
      url: "/api/pimas/cartonization",
      fetch: fakeFetch,
      headers: { authorization: "Bearer test" },
    });

    expect(await remote.speculate("setN", 6)).toEqual({ n: 6 });
    expect(state.n).toBe(1);
    expect(await remote.call("setN", 6)).toBeNull();
    expect((await remote.snapshot()).state).toEqual({ n: 6 });
    expect((await remote.descriptor()).actions.setN?.params).toEqual(["value"]);
    expect(await remote.speculatePlan([["setN", 9]])).toEqual({ n: 9 });
    expect(requests.map((request) => request.op)).toEqual([
      "speculate",
      "call",
      "snapshot",
      "descriptor",
      "speculatePlan",
    ]);
    bridge.dispose();
  });
});
