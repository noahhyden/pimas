/**
 * GOLDEN create-order test — locks the D#31 invariant that both backends receive
 * the ENGINE's operations in an identical sequence.
 *
 * Resumability (and the deferred claim/hydrate backend, #6) map a serialized
 * `<!---->`-anchored server tree back onto client nodes POSITIONALLY. That only
 * works if the string backend and the DOM backend are visited in exactly the
 * same order — same prop-loop order, same child-append order, anchors reserved
 * at the same points. That order is a *convention* in engine.ts (`for (const key
 * in props)` + `appendChildren` in array order), enforced by nothing else.
 *
 * This test records the engine→backend call stream for one component that
 * exercises attrs, nesting, a listener, and dynamic (anchored) children, then
 * asserts the DOM run and the SSR run produced the identical stream. A refactor
 * that reorders creation on one backend but not the other breaks this loudly.
 */
import { describe, it, expect } from "vitest";
import { createSignal } from "pimas";
import { renderWith, type RenderBackend } from "../src/dom/engine";
import { domBackend } from "../src/dom/dom-backend";
import { stringBackend, newRoot } from "../src/server/string-backend";

/**
 * Wrap a backend so every order-relevant op appends a compact token to `log`,
 * then delegates to the real backend. The engine drives both backends with a
 * backend-independent call order, so the two logs MUST match.
 */
function recordingBackend(inner: RenderBackend, log: string[]): RenderBackend {
  return {
    element(tag) {
      log.push(`el:${tag}`);
      return inner.element(tag);
    },
    text(value) {
      log.push(`tx:${value}`);
      return inner.text(value);
    },
    anchor() {
      log.push("an");
      return inner.anchor();
    },
    setText(node, value) {
      log.push(`sx:${value}`);
      inner.setText(node, value);
    },
    insert(parent, node, before) {
      log.push("in");
      inner.insert(parent, node, before);
    },
    remove(parent, node) {
      log.push("rm");
      inner.remove(parent, node);
    },
    setAttr(el, key, value) {
      log.push(`at:${key}`);
      inner.setAttr(el, key, value);
    },
    setStyle(el, name, value) {
      log.push(`st:${name}`);
      inner.setStyle(el, name, value);
    },
    listen(el, type, handler, opts) {
      log.push(`ln:${type}`);
      inner.listen(el, type, handler, opts);
    },
    // Not order-tokens (delegated verbatim): identity/query ops the engine uses
    // internally, plus the effect/mount seam whose *timing* differs by design.
    isNode: (v) => inner.isNode(v),
    nextSibling: (n) => inner.nextSibling(n),
    effect: (run) => inner.effect(run),
    scheduleMount: (fn) => inner.scheduleMount(fn),
  };
}

// One component covering the create-order surface: attribute order (id → class →
// data-x), nested children in source order, a listener, a static + a dynamic
// (anchored, effect-bound) child, and a property-backed attr (value/disabled).
function Widget() {
  const [n] = createSignal(1);
  return (
    <section id="root" class="wrap" data-x="1">
      <h1 title="t">Hello</h1>
      <button type="button" onClick={() => {}}>
        count: {() => n()}
      </button>
      <ul>
        <li>a</li>
        <li>{() => n()}</li>
      </ul>
      <input value="v" disabled />
    </section>
  );
}

describe("create-order invariant (D#31)", () => {
  it("the DOM and string backends receive an identical engine op stream", () => {
    const domLog: string[] = [];
    const domRoot = document.createElement("div");
    const disposeDom = renderWith(recordingBackend(domBackend, domLog), () => <Widget />, domRoot);

    const strLog: string[] = [];
    const disposeStr = renderWith(recordingBackend(stringBackend, strLog), () => <Widget />, newRoot());

    // The whole point: same sequence, token for token.
    expect(strLog).toEqual(domLog);

    // Sanity — the stream actually exercised the surface we care about, so a
    // future gutting of Widget can't hollow the test into a trivial pass.
    expect(domLog).toContain("an"); // a dynamic child reserved an anchor
    expect(domLog).toContain("ln:click"); // a listener was bound
    expect(domLog.filter((t) => t.startsWith("el:")).length).toBeGreaterThan(4);
    // <section>'s own attrs keep source order (id → class → data-x). NB: JSX
    // evaluates child elements before the parent's h() runs, so the section is
    // created last; we assert the relative order of its three attrs, not their
    // absolute position in the whole-tree stream.
    expect(domLog.indexOf("at:id")).toBeGreaterThanOrEqual(0);
    expect(domLog.indexOf("at:id")).toBeLessThan(domLog.indexOf("at:class"));
    expect(domLog.indexOf("at:class")).toBeLessThan(domLog.indexOf("at:data-x"));

    disposeDom();
    disposeStr();
  });
});
