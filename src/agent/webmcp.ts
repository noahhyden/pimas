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
import type { AgentBridge, AgentDescriptor } from "./bridge.js";

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

/** Shape a bridge return value into the MCP content envelope reference agents expect. */
function envelope(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  // MCP content text MUST be a string. `JSON.stringify(undefined)` is `undefined`
  // (not a string) — a void action (e.g. a setter that returns nothing) would
  // otherwise emit `text: undefined`, which a reference agent's JSON.parse rejects.
  // Coalesce nullish to JSON `null`.
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
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

  // An action's WebMCP input schema: explicit `input`, else one built from named
  // `params`, else a free-form positional `args` array.
  const schemaFor = (a: AgentDescriptor["actions"][string]): object =>
    a.input ??
    (a.params
      ? { type: "object", properties: Object.fromEntries(a.params.map((p) => [p, {}])), required: a.params }
      : { type: "object", properties: { args: { type: "array", description: "positional arguments" } } });

  // Map a named-args (or free-form) input bag back to the action's positional
  // signature, per its `params`.
  const argvFor = (a: AgentDescriptor["actions"][string], input: unknown): unknown[] => {
    const bag = (input ?? {}) as Record<string, unknown>;
    return a.params ? a.params.map((p) => bag[p]) : Array.isArray(bag.args) ? (bag.args as unknown[]) : [];
  };

  // Actions → tools. A named-args object (per `params`, else free-form) is mapped
  // back to the action's positional signature before calling the bridge.
  for (const [name, a] of Object.entries(desc.actions)) {
    const inputSchema = schemaFor(a);
    host.registerTool(
      {
        name: `${prefix}${name}`,
        description: a.description ?? name,
        inputSchema,
        annotations: a.readOnly ? { readOnlyHint: true } : undefined,
        execute: async (input) => envelope(await bridge.call(name, ...argvFor(a, input))),
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

  // L3 → `simulate_*` tools. speculate/speculatePlan/speculateSweep predict the
  // exposed after-state against a SHADOW graph and COMMIT NOTHING — the wedge no
  // scrape-and-poke agent has (it would have to mutate the real UI and re-read).
  // All are readOnly. Set `simulateTools:false` for a poke-only baseline.
  if (opts.simulateTools !== false) {
    // Per mutating action: predict the state after applying it once.
    for (const [name, a] of Object.entries(desc.actions)) {
      if (a.readOnly) continue; // a read action has nothing to speculate
      host.registerTool(
        {
          name: `${prefix}simulate_${name}`,
          description: `Predict the state after ${name}(...) WITHOUT committing (L3 what-if).${a.description ? " " + a.description : ""}`,
          inputSchema: schemaFor(a),
          annotations: { readOnlyHint: true },
          execute: async (input) => envelope(bridge.speculate(name, ...argvFor(a, input))),
        },
        regOpts,
      );
    }
    // Multi-factor scenario: predict after applying several actions in one shadow.
    host.registerTool(
      {
        name: `${prefix}simulate_plan`,
        description:
          "Predict the state after applying several actions in order in ONE shadow (a multi-factor what-if). Commits nothing.",
        inputSchema: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              description: "Ordered steps applied in the shadow.",
              items: {
                type: "object",
                properties: {
                  action: { type: "string", description: "action name" },
                  args: { type: "array", description: "positional arguments" },
                },
                required: ["action"],
              },
            },
          },
          required: ["steps"],
        },
        annotations: { readOnlyHint: true },
        execute: async (input) => {
          const raw = ((input ?? {}) as { steps?: Array<{ action: string; args?: unknown[] }> }).steps ?? [];
          const steps = raw.map((s) => [s.action, ...(s.args ?? [])] as [string, ...unknown[]]);
          return envelope(bridge.speculatePlan(steps));
        },
      },
      regOpts,
    );
    // Sensitivity sweep: one independent what-if per arg-set for a single action.
    host.registerTool(
      {
        name: `${prefix}simulate_sweep`,
        description:
          "Run one independent what-if of an action per arg-set (a sensitivity sweep). Returns the predicted state at each point. Commits nothing.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", description: "action name to sweep" },
            argsList: {
              type: "array",
              description: "list of positional-argument arrays, one per sweep point",
              items: { type: "array" },
            },
          },
          required: ["action", "argsList"],
        },
        annotations: { readOnlyHint: true },
        execute: async (input) => {
          const bag = (input ?? {}) as { action?: string; argsList?: unknown[][] };
          return envelope(bridge.speculateSweep(bag.action as string, bag.argsList ?? []));
        },
      },
      regOpts,
    );
  }

  return () => controller.abort();
}
