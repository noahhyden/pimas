/**
 * EXPERIMENTAL — `pimas/agent/webmcp`, issue #13.
 * Projects an agent bridge onto the WebMCP browser API (W3C WebML CG draft;
 * Chrome origin trial). WebMCP is TOOLS-ONLY — no resources, no push channel —
 * so the projection is:
 *
 *   - each bridge ACTION  → a WebMCP tool (execute → bridge.call)
 *   - each exposed VALUE  → a read-only `get_<name>` tool (a live read, since
 *                           WebMCP has no resource/subscribe concept)
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

/** Shape a bridge return value into the MCP content envelope reference agents expect. */
function envelope(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }] };
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
  const prefix = opts.namespace ? `${opts.namespace}.` : "";
  const desc = bridge.descriptor();
  const controller = new AbortController();
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const regOpts: WebMCPRegisterOptions = { signal: controller.signal, exposedTo: opts.exposedTo };

  // Actions → tools. A named-args object (per `params`, else free-form) is mapped
  // back to the action's positional signature before calling the bridge.
  for (const [name, a] of Object.entries(desc.actions)) {
    const inputSchema =
      a.input ??
      (a.params
        ? { type: "object", properties: Object.fromEntries(a.params.map((p) => [p, {}])), required: a.params }
        : { type: "object", properties: { args: { type: "array", description: "positional arguments" } } });
    host.registerTool(
      {
        name: `${prefix}${name}`,
        description: a.description ?? name,
        inputSchema,
        annotations: a.readOnly ? { readOnlyHint: true } : undefined,
        execute: async (input) => {
          const bag = (input ?? {}) as Record<string, unknown>;
          const argv = a.params
            ? a.params.map((p) => bag[p])
            : Array.isArray(bag.args)
              ? (bag.args as unknown[])
              : [];
          return envelope(await bridge.call(name, ...argv));
        },
      },
      regOpts,
    );
  }

  // Exposed state → read-only `get_<name>` tools (WebMCP has no resources). Each
  // is a LIVE read, so it reflects current state on every call.
  if (opts.readTools !== false) {
    for (const [name, s] of Object.entries(desc.state)) {
      host.registerTool(
        {
          name: `${prefix}get_${name}`,
          description: s.description ?? `Read the current value of "${name}".`,
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
          execute: async () => envelope(bridge.snapshot().state[name]),
        },
        regOpts,
      );
    }
  }

  return () => controller.abort();
}
