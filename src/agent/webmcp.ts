/** EXPERIMENTAL WebMCP projection of an agent bridge: actions, get_ reads and simulate_ tools; the push channel is not projected. */
import type { AgentBridge } from "./bridge.js";
import { toolsForDescriptor } from "./webmcp-tools.js";

/** A single WebMCP tool descriptor (matches the spec's `ModelContextTool`). */
export interface WebMCPTool {
  name: string;
  title?: string;
  description: string;
  /** JSON Schema (object) for the tool's arguments. */
  inputSchema: object;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
  annotations?: { readOnlyHint?: boolean };
}

/** The minimal WebMCP host surface the projection needs. */
export interface ModelContext {
  registerTool(tool: WebMCPTool, options?: { signal?: AbortSignal }): Promise<void> | void;
}

export interface WebMCPOptions {
  /** Provide the WebMCP host explicitly; otherwise auto-detect the browser global. */
  provider?: ModelContext;
  /** Prefix tool names so multiple bridges don't collide. */
  namespace?: string;
  /** Abort this to tear down all registrations (else use the returned disposer). */
  signal?: AbortSignal;
}

/** Best-effort detection of the browser WebMCP host. Returns null under Node/SSR. */
export function detectModelContext(): ModelContext | null {
  const g = globalThis as {
    document?: { modelContext?: ModelContext };
    navigator?: { modelContext?: ModelContext };
  };
  const mc = g.document?.modelContext ?? g.navigator?.modelContext ?? null;
  return mc && typeof mc.registerTool === "function" ? mc : null;
}

/** Register `bridge` as WebMCP tools; returns a teardown (see AGENTS.d/314-webmcp-teardown-is-an-abortcontroller-because-registertool-returns-no-handle.md), throws if no host is found. */
export function toWebMCP(bridge: AgentBridge, opts: WebMCPOptions = {}): () => void {
  const host = opts.provider ?? detectModelContext();
  if (!host) {
    throw new Error(
      "toWebMCP: no WebMCP host found (document/navigator.modelContext). Pass opts.provider, or run where WebMCP is available.",
    );
  }
  const controller = new AbortController();
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const tools = toolsForDescriptor(bridge, bridge.descriptor(), opts);
  for (const tool of tools.values()) host.registerTool(tool, { signal: controller.signal });

  return () => controller.abort();
}
