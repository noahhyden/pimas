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
