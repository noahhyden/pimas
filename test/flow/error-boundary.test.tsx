import { describe, it, expect } from "vitest";
import { createSignal } from "pimas";
import { render } from "pimas/dom";
import { renderToString } from "pimas/server";
import { ErrorBoundary } from "pimas/flow";

describe("ErrorBoundary (DOM)", () => {
  it("(10) renders the fallback when a child throws on initial render", () => {
    function Boom(): any {
      throw new Error("kaboom");
    }
    const root = document.createElement("div");
    render(
      () => (
        <ErrorBoundary fallback={() => <p>fell back</p>}>
          {() => <Boom />}
        </ErrorBoundary>
      ),
      root,
    );
    expect(root.textContent).toBe("fell back");
  });

  it("(11) reset() rebuilds children fresh — a once-throwing child then succeeds", () => {
    let first = true;
    function OnceThrows(): any {
      if (first) {
        first = false;
        throw new Error("first-only");
      }
      return <span>recovered</span>;
    }
    let resetFn!: () => void;
    const root = document.createElement("div");
    render(
      () => (
        <ErrorBoundary
          fallback={(_err, reset) => {
            resetFn = reset;
            return <p>error</p>;
          }}
        >
          {() => <OnceThrows />}
        </ErrorBoundary>
      ),
      root,
    );
    expect(root.textContent).toBe("error");
    resetFn(); // clears error, rebuilds — OnceThrows no longer throws
    expect(root.textContent).toBe("recovered");
  });

  it("(11b) swaps to fallback when a child throws on a later UPDATE (not initial build)", () => {
    const [n, setN] = createSignal(0);
    function Flaky(): any {
      // fine at 0; the binding effect re-runs and throws once n flips post-mount
      return (
        <span>
          {() => (n() > 0 ? ((): string => { throw new Error("late") })() : "ok")}
        </span>
      );
    }
    const root = document.createElement("div");
    render(
      () => (
        <ErrorBoundary fallback={() => <p>late-fallback</p>}>{() => <Flaky />}</ErrorBoundary>
      ),
      root,
    );
    expect(root.textContent).toBe("ok");
    setN(1); // triggers the child binding effect to re-run and throw
    expect(root.textContent).toBe("late-fallback");
  });

  it("(12) both a static fallback and a render-fn fallback work", () => {
    function Boom(): any {
      throw new Error("x");
    }
    // static fallback (a plain child, not a function)
    const rootA = document.createElement("div");
    render(
      () => <ErrorBoundary fallback={<p>static</p>}>{() => <Boom />}</ErrorBoundary>,
      rootA,
    );
    expect(rootA.textContent).toBe("static");

    // render-fn fallback receives the error
    const rootB = document.createElement("div");
    render(
      () => (
        <ErrorBoundary fallback={(err: unknown) => <p>{(err as Error).message}</p>}>
          {() => <Boom />}
        </ErrorBoundary>
      ),
      rootB,
    );
    expect(rootB.textContent).toBe("x");
  });
});

describe("ErrorBoundary (SSR)", () => {
  it("(13) emits fallback HTML when a child throws with a boundary", () => {
    function Boom(): any {
      throw new Error("ssr boom");
    }
    const html = renderToString(() => (
      <ErrorBoundary fallback={() => <p>ssr fallback</p>}>
        {() => <Boom />}
      </ErrorBoundary>
    ));
    expect(html).toContain("ssr fallback");
  });

  it("(14) renderToString throws when a child throws with NO boundary", () => {
    function Boom(): any {
      throw new Error("no boundary");
    }
    expect(() => renderToString(() => <Boom />)).toThrow("no boundary");
  });
});
