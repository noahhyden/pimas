/**
 * EXPERIMENTAL — `pimas/agent/webmcp`, issue #13.
 * Projects an agent bridge onto the WebMCP browser API (W3C WebML CG draft;
 * Chrome origin trial). WebMCP is TOOLS-ONLY — no resources, no push channel —
 * so the projection is:
 *
 *   - each bridge ACTION  → a WebMCP tool (execute → bridge.call)
 *   - each exposed VALUE  → a read-only `get_<name>` tool (a live read, since
 *                           WebMCP has no resource/subscribe concept)
 *   - each ACTION also    → a read-only `simulate_<name>` tool (execute →
 *                           bridge.speculate: predicts the after-state against a
 *                           shadow graph and COMMITS NOTHING), plus one
 *                           `simulate_plan` (multi-factor scenario) and
 *                           `simulate_sweep` (sensitivity sweep). This is the L3
 *                           wedge — the what-if a scrape-and-poke agent cannot do
 *                           without mutating the real UI and re-reading it.
 *   - the bridge's own subscribe → kept as the LIVE PUSH channel WebMCP lacks;
 *                           that is the differentiator, not projected.
 *
 * The spec is a moving origin-trial target, so the volatile bits are isolated
 * here (per the WebMCP maintainers' own guidance):
 *   - entry point: `document.modelContext` (current) with a `navigator.modelContext`
 *     fallback (the deprecated Chrome-149 location).
 *   - registration: `registerTool(tool, { signal })` → `Promise<undefined>`; there is
 *     no handle, so teardown is an `AbortController` (abort → unregister).
 *   - return: the MCP content envelope `{ content: [{ type: "text", text }] }`,
 *     which reference hosts/agents expect (the platform itself accepts `any`).
 */
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
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}

/** Options accepted by `registerTool` (spec's `ModelContextRegisterToolOptions`). */
export interface WebMCPRegisterOptions {
  signal?: AbortSignal;
  /** Origin allowlist; default is same-origin only. */
  exposedTo?: string[];
}

/** The minimal WebMCP host surface the projection needs. */
export interface ModelContext {
  registerTool(tool: WebMCPTool, options?: WebMCPRegisterOptions): Promise<void> | void;
}

export interface WebMCPOptions {
  /** Provide the WebMCP host explicitly; otherwise auto-detect the browser global. */
  provider?: ModelContext;
  /** Prefix tool names (e.g. an island slug) so multiple bridges don't collide. */
  namespace?: string;
  /** Also register a `get_<name>` read tool per exposed value. Default true. */
  readTools?: boolean;
  /** Also register the L3 `simulate_<name>` + `simulate_plan`/`simulate_sweep`
   *  tools (speculate/plan/sweep — predict without committing). Default true.
   *  Set false for a poke-and-rescrape baseline (the A/B eval switch). */
  simulateTools?: boolean;
  /** Forwarded to `registerTool` as the origin allowlist. */
  exposedTo?: string[];
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

/**
 * Register `bridge`'s actions + state as WebMCP tools on the host (auto-detected
 * or `opts.provider`). Returns a teardown that unregisters everything (via an
 * AbortController — the spec's canonical lifecycle). Throws if no host is found
 * and none was provided.
 */
export function toWebMCP(bridge: AgentBridge, opts: WebMCPOptions = {}): () => void {
  const host = opts.provider ?? detectModelContext();
  if (!host) {
    throw new Error(
      "toWebMCP: no WebMCP host found (document/navigator.modelContext). Pass opts.provider, or run where WebMCP is available.",
    );
  }
  const controller = new AbortController();
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const regOpts: WebMCPRegisterOptions = { signal: controller.signal, exposedTo: opts.exposedTo };
  const tools = toolsForDescriptor(bridge, bridge.descriptor(), opts);
  for (const tool of tools.values()) host.registerTool(tool, regOpts);

  return () => controller.abort();
}
