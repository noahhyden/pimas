/**
 * The CLAIM backend (resumability D-phase, D#31 / #6) — slice 1.
 *
 * Server-render a component to HTML, drop it into a container, then `claim()`.
 * The contract, versus today's client-render-first (`render()` after
 * `textContent = ""`):
 *   1. NO new nodes are created — the server DOM is adopted (identity preserved).
 *   2. A signal update mutates the EXISTING text node in place.
 *   3. A claimed event handler (live closure) fires.
 *   4. A dynamic attribute updates the adopted element.
 *   5. On a structural desync, claim degrades to a correct client render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "pimas";
import { renderToString } from "pimas/server";
import { claim } from "pimas/hydrate";

// Server-render `view` to HTML and seed a container with it, exactly as an SSR
// page delivers an island's markup before the client takes over.
function serverInto(view: () => any): HTMLDivElement {
  const html = renderToString(view);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // Bare-closure handlers can't serialize server-side (they warn + drop); claim
  // re-attaches them live. Silence the expected diagnostic.
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("claim — adopt server DOM in place", () => {
  it("creates NO new nodes and preserves node identity", () => {
    const [n] = createSignal(0);
    const App = () => (
      <div class="counter">
        <span>{() => n()}</span>
      </div>
    );
    const container = serverInto(() => <App />);

    const divBefore = container.querySelector("div.counter")!;
    const spanBefore = container.querySelector("span")!;
    const textBefore = spanBefore.firstChild; // the reactive Text node

    const createEl = vi.spyOn(document, "createElement");
    const createText = vi.spyOn(document, "createTextNode");

    const dispose = claim(() => <App />, container);

    expect(createEl).not.toHaveBeenCalled(); // adopted, not rebuilt
    expect(createText).not.toHaveBeenCalled();
    expect(container.querySelector("div.counter")).toBe(divBefore); // same instances
    expect(container.querySelector("span")).toBe(spanBefore);
    expect(container.querySelector("span")!.firstChild).toBe(textBefore);

    createEl.mockRestore();
    createText.mockRestore();
    dispose();
  });

  it("a signal update mutates the EXISTING text node in place", () => {
    const [n, setN] = createSignal(0);
    const App = () => <span>{() => n()}</span>;
    const container = serverInto(() => <App />);
    expect(container.querySelector("span")!.textContent).toBe("0");

    const dispose = claim(() => <App />, container);
    const textNode = container.querySelector("span")!.firstChild as Text;

    setN(1);
    expect(textNode.data).toBe("1"); // the SAME node's data changed
    expect(container.querySelector("span")!.firstChild).toBe(textNode); // identity held
    setN(42);
    expect(textNode.data).toBe("42");

    dispose();
  });

  it("wires a live event handler onto the adopted node", () => {
    let clicks = 0;
    const App = () => <button onClick={() => clicks++}>go</button>;
    const container = serverInto(() => <App />);
    const btn = container.querySelector("button")!;

    const dispose = claim(() => <App />, container);
    expect(container.querySelector("button")).toBe(btn); // same node

    btn.dispatchEvent(new Event("click", { bubbles: true }));
    expect(clicks).toBe(1);

    dispose();
  });

  it("updates a dynamic attribute on the adopted element", () => {
    const [cls, setCls] = createSignal("red");
    const App = () => <div class={() => cls()}>x</div>;
    const container = serverInto(() => <App />);
    const div = container.querySelector("div")!;
    expect(div.getAttribute("class")).toBe("red");

    const dispose = claim(() => <App />, container);
    expect(container.querySelector("div")).toBe(div);

    setCls("blue");
    expect(div.getAttribute("class")).toBe("blue"); // adopted node, updated in place

    dispose();
  });

  it("degrades to a correct client render on a structural desync", () => {
    const [n, setN] = createSignal(0);
    const App = () => (
      <div class="counter">
        <span>{() => n()}</span>
      </div>
    );
    // Corrupt the server markup so the plan tree can't match.
    const container = document.createElement("div");
    container.innerHTML = "<section>totally wrong</section>";
    document.body.appendChild(container);

    const dispose = claim(() => <App />, container);

    // Bailed to a fresh client render: the correct tree is present…
    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector("div.counter")).toBeTruthy();
    expect(container.querySelector("span")!.textContent).toBe("0");
    // …and it is fully reactive.
    setN(7);
    expect(container.querySelector("span")!.textContent).toBe("7");

    dispose();
  });

  it("dispose clears the container (parity with render())", () => {
    const [n] = createSignal(0);
    const App = () => <span>{() => n()}</span>;
    const container = serverInto(() => <App />);
    const dispose = claim(() => <App />, container);
    dispose();
    expect(container.innerHTML).toBe("");
  });
});
