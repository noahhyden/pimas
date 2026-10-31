import type { AgentBridge, AgentDescriptor } from "./bridge.js";
import { detectModelContext, toWebMCP } from "./webmcp.js";
import type { WebMCPTool } from "./webmcp.js";
import { toolsForDescriptor } from "./webmcp-tools.js";
import type { WebMCPBridgeSurface } from "./webmcp-tools.js";

export type BridgeStep = [string, ...unknown[]] | { action: string; args?: unknown[] };

export type BridgeRequest =
  | { op: "snapshot" | "descriptor" }
  | { op: "speculate" | "call"; action?: string; args?: unknown[] }
  | { op: "speculatePlan"; steps?: BridgeStep[] };

export interface RemoteBridge extends WebMCPBridgeSurface {
  snapshot(): Promise<{ state: Record<string, unknown>; actions: string[] }>;
  descriptor(): Promise<AgentDescriptor>;
  speculate(action: string, ...args: unknown[]): Promise<unknown>;
  call(action: string, ...args: unknown[]): Promise<unknown>;
  speculatePlan(steps: Array<[string, ...unknown[]]>): Promise<unknown>;
}

export interface PageAgent {
  bridge: WebMCPBridgeSurface;
  tools: Map<string, WebMCPTool>;
  snapshot: WebMCPBridgeSurface["snapshot"];
  speculate: WebMCPBridgeSurface["speculate"];
  call: WebMCPBridgeSurface["call"];
}

export interface PageAgentOptions {
  namespace?: string;
}

function actionFrom(body: { action?: string }): string {
  if (!body.action) throw new Error("bridge request: action is required");
  return body.action;
}

function normalizeSteps(steps: BridgeStep[] = []): Array<[string, ...unknown[]]> {
  return steps.map((step) =>
    Array.isArray(step) ? step : ([step.action, ...(step.args ?? [])] as [string, ...unknown[]]),
  );
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

/** Dispatch one JSON bridge request; a host parses the POST body, calls this, and serializes the result. */
export async function handleBridgeRequest(bridge: AgentBridge, body: BridgeRequest): Promise<unknown> {
  let result: unknown;
  switch (body.op) {
    case "snapshot":
      result = bridge.snapshot();
      break;
    case "descriptor":
      result = bridge.descriptor();
      break;
    case "speculate":
      result = bridge.speculate(actionFrom(body), ...(body.args ?? []));
      break;
    case "call":
      result = await bridge.call(actionFrom(body), ...(body.args ?? []));
      break;
    case "speculatePlan":
      result = bridge.speculatePlan(normalizeSteps(body.steps));
      break;
    default:
      throw new Error(`bridge request: unsupported op "${(body as { op?: unknown }).op as string}"`);
  }
  return jsonValue(await result);
}

export interface RemoteBridgeOptions {
  url: string;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
}

/** Connect a browser-side bridge facade to one server-side POST endpoint. */
export function connectRemoteBridge(opts: RemoteBridgeOptions): RemoteBridge {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("connectRemoteBridge: fetch is unavailable; pass opts.fetch");
  }

  const post = async <T>(body: BridgeRequest): Promise<T> => {
    const headers = new Headers(opts.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetchImpl(opts.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`connectRemoteBridge: POST ${opts.url} failed (${response.status} ${response.statusText})`);
    }
    return (await response.json()) as T;
  };

  return {
    snapshot: () => post({ op: "snapshot" }),
    descriptor: () => post({ op: "descriptor" }),
    speculate: (action, ...args) => post({ op: "speculate", action, args }),
    call: (action, ...args) => post({ op: "call", action, args }),
    speculatePlan: (steps) => post({ op: "speculatePlan", steps }),
  };
}

/** Install the browser-agent global whether or not WebMCP exists; a remote bridge awaits its descriptor once. */
export async function installPageAgent(
  bridge: WebMCPBridgeSurface,
  opts: PageAgentOptions = {},
): Promise<PageAgent> {
  // Publish synchronously, before the remote descriptor settles; await the call for populated tools.
  const tools = new Map<string, WebMCPTool>();
  const pageAgent: PageAgent = {
    bridge,
    tools,
    snapshot: bridge.snapshot.bind(bridge),
    speculate: bridge.speculate.bind(bridge),
    call: bridge.call.bind(bridge),
  };

  const target = globalThis as typeof globalThis & Record<string, unknown>;
  if (opts.namespace) {
    const current = target["__pimas"];
    const root =
      current !== null && typeof current === "object"
        ? (current as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    root[opts.namespace] = pageAgent;
    target["__pimas"] = root;
  } else {
    target["__pimas"] = pageAgent;
  }

  const descriptor = await bridge.descriptor();
  for (const [name, tool] of toolsForDescriptor(bridge, descriptor)) tools.set(name, tool);

  if (detectModelContext()) {
    const webBridge = { ...bridge, descriptor: () => descriptor } as AgentBridge;
    toWebMCP(webBridge, { namespace: opts.namespace });
  }

  return pageAgent;
}
