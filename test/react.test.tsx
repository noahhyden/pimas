import { describe, it, expect } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { createSignal } from "../src/reactive/index.js";
import { createStore } from "../src/store/index.js";
import { usePimas } from "../src/react/index.js";

function mount(el: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("usePimas", () => {
  it("renders a signal and updates on write", () => {
    const [n, setN] = createSignal(1);
    function View() {
      const v = usePimas(n);
      return createElement("span", null, String(v));
    }
    const { container, unmount } = mount(createElement(View));
    expect(container.textContent).toBe("1");
    act(() => {
      setN(2);
    });
    expect(container.textContent).toBe("2");
    unmount();
  });

  it("only the component that read a field re-renders", () => {
    const [s, set] = createStore({ a: 1, b: 2 });
    let aRenders = 0;
    let bRenders = 0;
    function A() {
      aRenders++;
      const a = usePimas(() => s.a);
      return createElement("span", { id: "a" }, String(a));
    }
    function B() {
      bRenders++;
      const b = usePimas(() => s.b);
      return createElement("span", { id: "b" }, String(b));
    }
    function App() {
      return createElement("div", null, createElement(A), createElement(B));
    }
    const { container, unmount } = mount(createElement(App));
    expect(aRenders).toBeGreaterThanOrEqual(1);
    const a0 = aRenders;
    const b0 = bRenders;
    act(() => {
      set("a", 9);
    });
    expect(container.querySelector("#a")!.textContent).toBe("9");
    expect(container.querySelector("#b")!.textContent).toBe("2");
    expect(aRenders).toBeGreaterThan(a0);
    expect(bRenders).toBe(b0);
    unmount();
  });
});
