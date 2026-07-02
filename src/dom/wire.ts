/**
 * The resumability WIRE CONTRACT — shared verbatim by the server (which writes
 * it) and the client `resume()` dispatcher (which reads it).
 *
 * Deliberately ZERO imports: `resume()` must be shippable WITHOUT the renderer
 * (resumption ships no component code), so it can only depend on a module that
 * drags nothing else in. Both `engine.ts` and `resume.ts` import from here.
 */

/**
 * The serialized form of a handler. The string backend records one per
 * `on:<type>`; `resume()` resolves `ref` → handler and invokes it with `capture`.
 * It is `HandlerDescriptor` with the live `load` dropped (see engine.ts).
 */
export interface CaptureEntry {
  ref: string;
  capture: unknown[];
}

/** The `<script type>` carrying the serialized capture table into the document. */
export const STATE_SCRIPT_TYPE = "application/pimas-state";

// ── type-tagged codec (#7 / resumability task 6, D#32) ───────────────────────
//
// JSON already carries strings/numbers/booleans/null/arrays/plain-objects — the
// overwhelming majority of a captured value or island prop. We only TAG the
// values JSON can't represent, as single-key sentinels, and let the native
// parser/serializer do all the structural work. This makes the DECODER (shipped
// to every resumable page) as small as possible: a reviver switch, nothing more.
//
// Sentinels: {"$":"u"} undefined · {"$":"n","v":"N"|"I"|"-I"|"-0"} non-finite/-0
// · {"$":"b","v":"…"} bigint · {"$":"d","v":iso} Date · {"$":"m","v":[[k,val]…]}
// Map · {"$":"s","v":[…]} Set · {"$":"r","v":[src,flags]} RegExp.
//
// No cycles/dedup (the driver data — typed rows — is acyclic). A user object
// shaped EXACTLY like a sentinel would be misread on decode, so `encode` throws
// on it (server-side, rare) rather than silently corrupt — the decoder then
// never has to defend against ambiguity.

const TAGS = new Set(["u", "n", "b", "d", "m", "s", "r"]);

/** True for a plain object shaped exactly like a reserved sentinel. */
function isSentinelShape(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.$ !== "string" || !TAGS.has(o.$)) return false;
  const n = Object.keys(o).length;
  return o.$ === "u" ? n === 1 : n === 2 && "v" in o;
}

/**
 * Serialize `value` to an embeddable string (a superset of JSON that round-trips
 * undefined/NaN/±Infinity/-0/bigint/Date/Map/Set/RegExp). Throws on a function
 * or an object shaped like a reserved sentinel — server-side, fail loud rather
 * than drop/corrupt. The `<`→`<` escape prevents a string value containing
 * `</script>` from breaking out of the state script (valid JSON, so `decode`
 * needs no un-escape step).
 */
export function encode(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
    const raw = this[key];
    if (raw === undefined) return { $: "u" };
    if (typeof raw === "bigint") return { $: "b", v: (raw as bigint).toString() };
    if (raw instanceof Date) return { $: "d", v: raw.toISOString() };
    if (raw instanceof RegExp) return { $: "r", v: [raw.source, raw.flags] };
    if (raw instanceof Map) return { $: "m", v: [...raw] };
    if (raw instanceof Set) return { $: "s", v: [...raw] };
    if (typeof v === "number") {
      if (Number.isNaN(v)) return { $: "n", v: "N" };
      if (v === Infinity) return { $: "n", v: "I" };
      if (v === -Infinity) return { $: "n", v: "-I" };
      if (Object.is(v, -0)) return { $: "n", v: "-0" };
      return v;
    }
    if (typeof v === "function") throw new Error("pimas: cannot serialize a function.");
    if (isSentinelShape(v)) throw new Error('pimas: cannot serialize an object shaped like a reserved {"$":…} sentinel.');
    return v;
  }).replace(/</g, "\\u003c");
}

/** Parse a string produced by `encode`, reconstructing the tagged types. */
export function decode(text: string): unknown {
  return JSON.parse(text, (key, value) => {
    if (key === "__proto__") return undefined; // never rebuild a proto key
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      const t = o.$;
      if (typeof t === "string" && TAGS.has(t)) {
        const n = Object.keys(o).length;
        if (t === "u" && n === 1) return undefined;
        if (n === 2 && "v" in o) {
          const v = o.v;
          if (t === "b") return BigInt(v as string);
          if (t === "d") return new Date(v as string);
          if (t === "r") return new RegExp((v as string[])[0]!, (v as string[])[1]);
          if (t === "m") return new Map(v as [unknown, unknown][]);
          if (t === "s") return new Set(v as unknown[]);
          if (t === "n") return v === "N" ? NaN : v === "I" ? Infinity : v === "-I" ? -Infinity : -0;
        }
      }
    }
    return value;
  });
}
