import { describe, it, expect } from "vitest";
import { createContext, useContext, createSignal, createRoot } from "pimas";
import { render } from "pimas/dom";
import { renderToString } from "pimas/server";

describe("createContext / useContext", () => {
  it("returns the default value when no Provider is above the reader", () => {
    const Theme = createContext("light");
    createRoot(() => {
      expect(useContext(Theme)).toBe("light");
    });
  });

  it("supplies a value to a descendant component (DOM)", () => {
    const Theme = createContext("light");
    function Label() {
      return <span>{useContext(Theme)}</span>;
    }
    const root = document.createElement("div");
    render(
      () => (
        <Theme.Provider value="dark">{() => <Label />}</Theme.Provider>
      ),
      root,
    );
    expect(root.textContent).toBe("dark");
  });

  it("nearest Provider wins for nested providers", () => {
    const Theme = createContext("light");
    function Label() {
      return <span>{useContext(Theme)}</span>;
    }
    const root = document.createElement("div");
    render(
      () => (
        <Theme.Provider value="dark">
          {() => (
            <div>
              <Label />
              <Theme.Provider value="solarized">{() => <Label />}</Theme.Provider>
            </div>
          )}
        </Theme.Provider>
      ),
      root,
    );
    // first Label sees "dark", inner one sees "solarized"
    expect(root.textContent).toBe("darksolarized");
  });

  it("carries a reactive value through context (signal pair stays stable)", () => {
    const Counter = createContext<readonly [() => number, (n: number) => void]>([
      () => 0,
      () => {},
    ]);
    function Display() {
      const [count] = useContext(Counter);
      return <span>{() => count()}</span>;
    }
    const [count, setCount] = createSignal(1);
    const root = document.createElement("div");
    render(
      () => (
        <Counter.Provider value={[count, setCount]}>
          {() => <Display />}
        </Counter.Provider>
      ),
      root,
    );
    expect(root.textContent).toBe("1");
    setCount(5); // the signal is reactive; the provider node is not rebuilt
    expect(root.textContent).toBe("5");
  });

  it("works under SSR (renderToString)", () => {
    const Theme = createContext("light");
    function Label() {
      return <span>{useContext(Theme)}</span>;
    }
    const html = renderToString(() => (
      <Theme.Provider value="dark">{() => <Label />}</Theme.Provider>
    ));
    expect(html).toContain("<span>dark</span>");
  });

  it("supports an explicit undefined default (no-arg createContext)", () => {
    const Maybe = createContext<string>();
    createRoot(() => {
      expect(useContext(Maybe)).toBeUndefined();
    });
  });
});
