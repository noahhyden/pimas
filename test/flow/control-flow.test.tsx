import { describe, it, expect } from "vitest";
import { createSignal, onCleanup } from "pimas";
import { render } from "pimas/dom";
import { renderToString } from "pimas/server";
import { Show, Switch, Match } from "pimas/flow";

describe("Show", () => {
  it("toggles a branch on a boolean condition", () => {
    const [open, setOpen] = createSignal(false);
    const root = document.createElement("div");
    render(
      () => (
        <Show when={open} fallback={() => <p>closed</p>}>
          {() => <p>open</p>}
        </Show>
      ),
      root,
    );
    expect(root.textContent).toBe("closed");
    setOpen(true);
    expect(root.textContent).toBe("open");
    setOpen(false);
    expect(root.textContent).toBe("closed");
  });

  it("disposes the branch (runs onCleanup) when it flips false", () => {
    const [show, setShow] = createSignal(true);
    let cleaned = 0;
    function Child() {
      onCleanup(() => cleaned++);
      return <span>hi</span>;
    }
    const root = document.createElement("div");
    render(() => <Show when={show}>{() => <Child />}</Show>, root);

    expect(root.querySelector("span")).not.toBeNull();
    expect(cleaned).toBe(0);
    setShow(false);
    expect(root.querySelector("span")).toBeNull();
    expect(cleaned).toBe(1); // branch torn down, not just hidden
  });

  it("does not rebuild the branch on unrelated changes to the value", () => {
    // `when` flips truthiness only once; builds counts the branch instantiations.
    const [n, setN] = createSignal(1);
    let builds = 0;
    const root = document.createElement("div");
    render(
      () => (
        <Show when={() => n() > 0}>
          {() => {
            builds++;
            return <span>{() => n()}</span>;
          }}
        </Show>
      ),
      root,
    );
    expect(builds).toBe(1);
    setN(2); // still > 0 → condition boolean unchanged → branch NOT rebuilt
    expect(builds).toBe(1);
    expect(root.querySelector("span")!.textContent).toBe("2"); // inner binding updated
    setN(-1); // now falsy → branch disposed
    expect(root.querySelector("span")).toBeNull();
  });
});

describe("Switch / Match", () => {
  it("renders the first matching case, else fallback", () => {
    const [status, setStatus] = createSignal("loading");
    const root = document.createElement("div");
    render(
      () => (
        <Switch fallback={() => <p>idle</p>}>
          <Match when={() => status() === "loading"}>{() => <p>spinner</p>}</Match>
          <Match when={() => status() === "error"}>{() => <p>oops</p>}</Match>
        </Switch>
      ),
      root,
    );
    expect(root.textContent).toBe("spinner");
    setStatus("error");
    expect(root.textContent).toBe("oops");
    setStatus("done");
    expect(root.textContent).toBe("idle"); // no match → fallback
  });
});

describe("control flow under SSR", () => {
  it("Show renders the active branch to a string", () => {
    const html = renderToString(() => (
      <Show when={true} fallback={() => <p>no</p>}>
        {() => <p>yes</p>}
      </Show>
    ));
    // dynamic content carries a trailing <!----> hydration-marker anchor
    expect(html).toContain("<p>yes</p>");
    expect(html).not.toContain("<p>no</p>");
  });
});
