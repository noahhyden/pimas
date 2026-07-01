/**
 * ErrorBoundary in a REAL browser: a genuine throw during render/update is
 * caught and the fallback is painted into the live DOM, reset() rebuilds the
 * subtree, and a throw on a later signal update swaps to the fallback in place.
 * (Complements the happy-dom vitest suite with real-DOM throw/catch + reconcile.)
 */
import { createSignal } from "pimas";
import { ErrorBoundary } from "pimas/flow";
import { test, expect, mount } from "../runner";

test("ErrorBoundary shows the fallback when a child throws on first render", () => {
  function Boom(): unknown {
    throw new Error("kaboom");
  }
  const m = mount(() => (
    <ErrorBoundary fallback={() => <p>fell back</p>}>{() => <Boom />}</ErrorBoundary>
  ));
  expect(m.container.textContent).toBe("fell back");
  m.dispose();
});

test("ErrorBoundary reset() rebuilds children fresh — a once-thrower then succeeds", () => {
  let first = true;
  function OnceThrows(): unknown {
    if (first) {
      first = false;
      throw new Error("once");
    }
    return <span>recovered</span>;
  }
  let resetFn!: () => void;
  const m = mount(() => (
    <ErrorBoundary
      fallback={(_err, reset) => {
        resetFn = reset;
        return <p>error</p>;
      }}
    >
      {() => <OnceThrows />}
    </ErrorBoundary>
  ));
  expect(m.container.textContent).toBe("error");
  resetFn();
  expect(m.container.textContent).toBe("recovered");
  m.dispose();
});

test("ErrorBoundary catches a throw on a later signal update, in place", () => {
  const [n, setN] = createSignal(0);
  function Flaky(): unknown {
    return <span>{() => (n() > 0 ? ((): string => { throw new Error("late") })() : "fine")}</span>;
  }
  const m = mount(() => (
    <ErrorBoundary fallback={() => <p>late-fallback</p>}>{() => <Flaky />}</ErrorBoundary>
  ));
  expect(m.container.textContent).toBe("fine");
  setN(1); // the binding effect re-runs and throws → boundary swaps to fallback
  expect(m.container.textContent).toBe("late-fallback");
  m.dispose();
});
