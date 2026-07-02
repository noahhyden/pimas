/**
 * `resume()` — the client-side dispatcher that makes a server-rendered tree
 * interactive WITHOUT re-running any component (the resumability path, #6 / #30).
 *
 * The string backend serialized each handler as an `on:<type>="<index>"`
 * attribute plus a capture table in a `<script type="application/pimas-state">`
 * (see pimas/server). This reads that table, registers ONE capture-phase
 * listener per event type actually present, and on an event walks from the
 * target up to the nearest element carrying `on:<type>`, resolves its `ref`
 * against a handler registry, and invokes the handler with the captured state.
 *
 * This is the compiler-free proof of the seam: `registerHandler(ref, fn)` stands
 * in for the eventual `import()` the compiler (#12 Phase D) will emit. Nothing
 * here touches the reactive core; it rides entirely on the reserved backend seam.
 *
 * Deliberate scope (like Qwik's "resume listeners first"): this resumes
 * LISTENERS, not reactive-graph STATE. A resumed handler that reads a signal
 * sees a fresh default — full state-resume is later work needing the compiler.
 */
import { STATE_SCRIPT_TYPE, type CaptureEntry } from "./wire.js";

/** A resumed handler: receives the DOM event and the serialized capture bag. */
export type ResumeHandler = (event: Event, capture: unknown[]) => void;

const DEFAULT_REGISTRY = new Map<string, ResumeHandler>();

/**
 * Register the handler a serialized `ref` resolves to. The compiler-free stand-in
 * for the `import()` a resumable build would emit. Refs must be unique — namespace
 * them per island/module to avoid collisions across independently-rendered roots.
 */
export function registerHandler(ref: string, fn: ResumeHandler): void {
  const existing = DEFAULT_REGISTRY.get(ref);
  if (existing && existing !== fn) {
    console.warn(
      `pimas resume: handler ref "${ref}" registered twice with different ` +
        `functions — refs must be unique (namespace per island/module).`,
    );
  }
  DEFAULT_REGISTRY.set(ref, fn);
}

/** Test/reset hook — clears the default registry. */
export function clearHandlers(): void {
  DEFAULT_REGISTRY.clear();
}

export interface ResumeOptions {
  /** The subtree to resume. Defaults to `document`. Listeners attach here. */
  root?: Document | Element;
  /** Handler lookup. Defaults to the module registry populated by registerHandler. */
  registry?: Map<string, ResumeHandler>;
}

const ATTR_PREFIX = "on:";

/**
 * Wire a server-rendered tree's serialized handlers to live events. Returns a
 * dispose function that removes every listener it added.
 */
export function resume(opts: ResumeOptions = {}): () => void {
  const root: Document | Element = opts.root ?? document;
  const registry = opts.registry ?? DEFAULT_REGISTRY;

  // 1. Read the capture table from the state script (search within the root).
  let table: CaptureEntry[] = [];
  const script = root.querySelector(`script[type="${STATE_SCRIPT_TYPE}"]`);
  if (script?.textContent) {
    try {
      table = JSON.parse(script.textContent) as CaptureEntry[];
    } catch {
      console.warn("pimas resume: could not parse the state script — ignoring.");
    }
  }

  // 2. Discover exactly which event types are present, so we register only those
  //    (capture-phase, which also reaches non-bubbling events like focus/blur).
  const types = new Set<string>();
  for (const el of root.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith(ATTR_PREFIX)) types.add(attr.name.slice(ATTR_PREFIX.length));
    }
  }

  // 3. One delegated capture-phase listener per type.
  const added: Array<[string, EventListener]> = [];
  for (const type of types) {
    const attr = `${ATTR_PREFIX}${type}`;
    const listener: EventListener = (event) => {
      // Walk target → nearest ancestor carrying on:<type>, bounded by `root`
      // (never above the delegation boundary). Nearest match wins — mirrors a
      // single directly-bound listener.
      let node: Node | null = event.target as Node | null;
      while (node) {
        if (node.nodeType === 1) {
          const idx = (node as Element).getAttribute(attr);
          if (idx !== null) {
            const entry = table[Number(idx)];
            if (entry) {
              const fn = registry.get(entry.ref);
              if (fn) fn(event, entry.capture);
              else console.warn(`pimas resume: no handler registered for ref "${entry.ref}".`);
            }
            return;
          }
        }
        if (node === root) break; // don't walk above the resumed subtree
        node = node.parentNode;
      }
    };
    root.addEventListener(type, listener, true);
    added.push([type, listener]);
  }

  return () => {
    for (const [type, listener] of added) root.removeEventListener(type, listener, true);
  };
}
