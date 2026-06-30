import { describe, it, expect } from "vitest";
import { createSignal } from "pimas";
import { render } from "pimas/dom";

describe("render", () => {
  it("mounts a component and updates text fine-grained on signal change", () => {
    function Counter() {
      const [n, setN] = createSignal(0);
      return (
        <button type="button" onClick={() => setN(n() + 1)}>
          count: {() => n()}
        </button>
      );
    }

    const root = document.createElement("div");
    render(() => <Counter />, root);

    const btn = root.querySelector("button")!;
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.textContent).toBe("count: 0");

    btn.click();
    expect(btn.textContent).toBe("count: 1");
    btn.click();
    expect(btn.textContent).toBe("count: 2");
  });

  it("updates a dynamic attribute, not just text", () => {
    const [active, setActive] = createSignal(false);
    const root = document.createElement("div");
    render(() => <div class={() => (active() ? "on" : "off")} />, root);

    const el = root.querySelector("div")!;
    expect(el.getAttribute("class")).toBe("off");
    setActive(true);
    expect(el.getAttribute("class")).toBe("on");
  });

  it("swaps element children dynamically (show/hide)", () => {
    const [show, setShow] = createSignal(true);
    const root = document.createElement("div");
    render(() => <section>{() => (show() ? <span>hi</span> : null)}</section>, root);

    const wrap = root.querySelector("section")!;
    expect(wrap.querySelector("span")?.textContent).toBe("hi");
    setShow(false);
    expect(wrap.querySelector("span")).toBeNull();
    setShow(true);
    expect(wrap.querySelector("span")?.textContent).toBe("hi");
  });

  it("renders a Fragment without a wrapper element", () => {
    const root = document.createElement("div");
    render(
      () => (
        <>
          <i>a</i>
          <b>b</b>
        </>
      ),
      root,
    );
    expect(root.querySelector("i")?.textContent).toBe("a");
    expect(root.querySelector("b")?.textContent).toBe("b");
    expect(root.children.length).toBe(2); // no wrapper around the fragment
  });

  it("dispose tears down the tree and stops reactions", () => {
    const [n, setN] = createSignal(0);
    const root = document.createElement("div");
    const dispose = render(() => <p>{() => n()}</p>, root);

    expect(root.querySelector("p")!.textContent).toBe("0");
    dispose();
    expect(root.innerHTML).toBe("");
    setN(1); // effect disposed → no throw, no work
    expect(root.innerHTML).toBe("");
  });
});
