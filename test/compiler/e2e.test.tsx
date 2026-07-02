/**
 * Compiler Phase A — end-to-end (#4 / #12 Phase A).
 *
 * Proves the transform hits the identical runtime branches as hand-written
 * thunks: author a component with NO thunks, run it through transform → esbuild
 * JSX-desugar → the real pimas runtime, and assert fine-grained reactivity.
 * The contrast case (same source, WITHOUT the transform) is frozen — showing
 * the transform is exactly what supplies the reactivity.
 */
import { describe, it, expect } from "vitest";
import * as esbuild from "esbuild";
import { createSignal } from "pimas";
import { h, Fragment, render } from "pimas/dom";
import { transform } from "../../src/compiler/transform";

// Authored WITHOUT thunks: a reactive class + a reactive text child.
const SRC = `
function Comp() {
  const [n, setN] = createSignal(0);
  const [active, setActive] = createSignal(false);
  sink.setN = setN;
  sink.setActive = setActive;
  return <button class={active() ? "on" : "off"}>count: {n()}</button>;
}
`;

async function compile(src: string, applyTransform: boolean) {
  const code = applyTransform ? transform(src, "comp.tsx") : src;
  const { code: js } = await esbuild.transform(code, {
    loader: "tsx",
    jsx: "transform",
    jsxFactory: "__h",
    jsxFragment: "__Fragment",
  });
  const sink: { setN?: (n: number) => void; setActive?: (b: boolean) => void } = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function("__h", "__Fragment", "createSignal", "sink", `${js}\nreturn Comp;`);
  const Comp = make(h, Fragment, createSignal, sink) as () => unknown;
  return { Comp, sink };
}

describe("thunk-eraser end-to-end", () => {
  it("thunkless source becomes fine-grained reactive after the transform", async () => {
    const { Comp, sink } = await compile(SRC, true);
    const root = document.createElement("div");
    render(Comp as () => any, root);

    const btn = root.querySelector("button")!;
    expect(btn.textContent).toBe("count: 0");
    expect(btn.getAttribute("class")).toBe("off");

    sink.setN!(1);
    expect(btn.textContent).toBe("count: 1"); // reactive text child updated in place

    sink.setActive!(true);
    expect(btn.getAttribute("class")).toBe("on"); // reactive class attribute flipped
  });

  it("the SAME source WITHOUT the transform is frozen (proves the transform did it)", async () => {
    const { Comp, sink } = await compile(SRC, false);
    const root = document.createElement("div");
    render(Comp as () => any, root);

    const btn = root.querySelector("button")!;
    expect(btn.textContent).toBe("count: 0");

    sink.setN!(1);
    sink.setActive!(true);
    expect(btn.textContent).toBe("count: 0"); // read once, never updates
    expect(btn.getAttribute("class")).toBe("off");
  });
});
