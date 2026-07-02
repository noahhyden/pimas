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
import { For, Show } from "pimas/flow";
import { render } from "pimas/dom";
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

describe("claim — control flow (slice 2)", () => {
  const texts = (c: Element) => [...c.querySelectorAll("li")].map((l) => l.textContent);

  it("adopts a <For> first render without creating nodes", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const [items] = createSignal([a, b, c]);
    const App = () => (
      <ul>
        <For each={items}>{(it: { id: string }) => <li>{() => it.id}</li>}</For>
      </ul>
    );
    const container = serverInto(() => <App />);
    const before = [...container.querySelectorAll("li")];

    const createEl = vi.spyOn(document, "createElement");
    const createText = vi.spyOn(document, "createTextNode");
    const dispose = claim(() => <App />, container);

    expect(createEl).not.toHaveBeenCalled();
    expect(createText).not.toHaveBeenCalled();
    expect([...container.querySelectorAll("li")].every((li, i) => li === before[i])).toBe(true);
    expect(texts(container)).toEqual(["a", "b", "c"]);

    createEl.mockRestore();
    createText.mockRestore();
    dispose();
  });

  it("reorders <For> rows after claim, reusing the SAME adopted nodes", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const [items, setItems] = createSignal([a, b, c]);
    const App = () => (
      <ul>
        <For each={items}>{(it: { id: string }) => <li>{() => it.id}</li>}</For>
      </ul>
    );
    const container = serverInto(() => <App />);
    const dispose = claim(() => <App />, container);
    const liB = container.querySelectorAll("li")[1]!; // b's adopted node

    setItems([c, b, a]);
    const after = [...container.querySelectorAll("li")];
    expect(after.map((l) => l.textContent)).toEqual(["c", "b", "a"]);
    expect(after[1]).toBe(liB); // moved, not rebuilt — identity preserved

    dispose();
  });

  it("materializes a NEW <For> row (created post-adoption) and keeps it reactive", () => {
    const a = { id: "a" }, b = { id: "b" };
    const [items, setItems] = createSignal<Array<{ id: string }>>([a, b]);
    const [suffix, setSuffix] = createSignal("");
    const App = () => (
      <ul>
        <For each={items}>{(it: { id: string }) => <li>{() => it.id + suffix()}</li>}</For>
      </ul>
    );
    const container = serverInto(() => <App />);
    const dispose = claim(() => <App />, container);
    const liA = container.querySelectorAll("li")[0]!;

    const c = { id: "c" };
    setItems([a, b, c]); // append — no server DOM to adopt, must materialize
    expect(texts(container)).toEqual(["a", "b", "c"]);
    expect(container.querySelectorAll("li")[0]).toBe(liA); // survivors kept

    setSuffix("!"); // the freshly materialized row must be reactive too
    expect(texts(container)).toEqual(["a!", "b!", "c!"]);

    dispose();
  });

  it("removes a <For> row from the real DOM after claim", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const [items, setItems] = createSignal([a, b, c]);
    const App = () => (
      <ul>
        <For each={items}>{(it: { id: string }) => <li>{() => it.id}</li>}</For>
      </ul>
    );
    const container = serverInto(() => <App />);
    const dispose = claim(() => <App />, container);
    const liA = container.querySelectorAll("li")[0]!;

    setItems([a, c]); // drop b
    expect(texts(container)).toEqual(["a", "c"]);
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelectorAll("li")[0]).toBe(liA);

    dispose();
  });

  it("adopts adjacent text pieces the browser coalesced into one node (slice 3b)", () => {
    // `{a}{sep}{b}` is three plan text nodes, but the server serializes them into
    // one run that the HTML parser coalesces into a single Text node. claim splits
    // that node back apart to match the plan.
    const App = () => (
      <span>
        {"ACME"}
        {" · p."}
        {"3"}
      </span>
    );
    const container = serverInto(() => <App />);
    const span = container.querySelector("span")!;
    expect(span.textContent).toBe("ACME · p.3");

    const dispose = claim(() => <App />, container);
    expect(container.querySelector("span")).toBe(span); // same element adopted
    expect(span.textContent).toBe("ACME · p.3"); // content intact after any split
    dispose();
  });

  it("delivers a ref the REAL adopted node, not a plan node (slice 3a)", () => {
    let captured: unknown = null;
    const App = () => <div class="host" ref={(n: unknown) => (captured = n)}>x</div>;
    const container = serverInto(() => <App />);
    const real = container.querySelector("div.host")!;

    claim(() => <App />, container);
    expect(captured).toBe(real); // the adopted server node — a real Element, usable
    expect(captured instanceof HTMLElement).toBe(true);
  });

  it("delivers a ref on a row created post-adoption", () => {
    const a = { id: "a" };
    const [items, setItems] = createSignal<Array<{ id: string }>>([a]);
    const refs: Record<string, unknown> = {};
    const App = () => (
      <ul>
        <For each={items}>
          {(it: { id: string }) => <li ref={(n: unknown) => (refs[it.id] = n)}>{() => it.id}</li>}
        </For>
      </ul>
    );
    const container = serverInto(() => <App />);
    claim(() => <App />, container);
    expect(refs.a).toBe(container.querySelector("li")); // adopted row's ref

    setItems([a, { id: "b" }]); // new row materialized post-adoption
    const liB = container.querySelectorAll("li")[1]!;
    expect(refs.b).toBe(liB); // fired with the materialized real node
    expect(refs.b instanceof HTMLElement).toBe(true);
  });

  it("adopts an existing <svg> subtree and keeps its namespace", () => {
    const App = () => (
      <svg viewBox="0 0 10 10">
        <circle cx="5" cy="5" r="4" />
      </svg>
    );
    const container = serverInto(() => <App />);
    const svg = container.querySelector("svg")!;
    const circle = container.querySelector("circle")!;

    claim(() => <App />, container);
    expect(container.querySelector("svg")).toBe(svg); // adopted, not rebuilt
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(circle.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("materializes a NEW svg row post-adoption in the SVG namespace", () => {
    const [dots, setDots] = createSignal<Array<{ cx: number }>>([{ cx: 1 }]);
    const App = () => (
      <svg>
        <For each={dots}>{(d: { cx: number }) => <circle cx={() => String(d.cx)} r="1" />}</For>
      </svg>
    );
    const container = serverInto(() => <App />);
    claim(() => <App />, container);

    setDots([{ cx: 1 }, { cx: 2 }]); // new <circle> created via materialize()
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(2);
    expect(circles[1]!.namespaceURI).toBe("http://www.w3.org/2000/svg"); // not HTMLUnknownElement
  });

  it("toggles a <Show> branch after claim", () => {
    const [open, setOpen] = createSignal(true);
    const App = () => (
      <div>
        <Show when={open}>{() => <p class="body">shown</p>}</Show>
      </div>
    );
    const container = serverInto(() => <App />);
    expect(container.querySelector("p.body")).toBeTruthy();

    const dispose = claim(() => <App />, container);
    setOpen(false);
    expect(container.querySelector("p.body")).toBeNull(); // branch removed from real DOM
    setOpen(true);
    expect(container.querySelector("p.body")).toBeTruthy(); // re-materialized

    dispose();
  });
});

describe("env seam — mixed backends coexist (D#49)", () => {
  // A claimed island (claim backend) and a normally-rendered island (DOM backend)
  // on one page must NOT cross backends: each computation recomputes under the
  // backend it was created with. If the env seam regressed to a single global
  // backend, one island's <For> update would build through the other's backend —
  // e.g. the claimed island would stringify DOM-built rows into escaped text.
  it("a rendered <For> and a claimed <For> each reconcile under their own backend", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const [rendered, setRendered] = createSignal(["a", "b"]);
      const rContainer = document.createElement("div");
      document.body.appendChild(rContainer);
      render(
        () => (
          <ul>
            <For each={rendered}>{(x: string) => <li>{() => "R:" + x}</li>}</For>
          </ul>
        ),
        rContainer,
      );

      const [claimed, setClaimed] = createSignal(["x", "y"]);
      const App = () => (
        <ul>
          <For each={claimed}>{(x: string) => <li>{() => "C:" + x}</li>}</For>
        </ul>
      );
      const html = renderToString(() => <App />);
      const cContainer = document.createElement("div");
      cContainer.innerHTML = html;
      document.body.appendChild(cContainer);
      claim(() => <App />, cContainer);

      // Update BOTH — interleaved. Each appends a new row that must materialize
      // through its own backend.
      setRendered(["a", "b", "c"]);
      setClaimed(["x", "y", "z"]);

      expect([...rContainer.querySelectorAll("li")].map((l) => l.textContent)).toEqual([
        "R:a",
        "R:b",
        "R:c",
      ]);
      expect([...cContainer.querySelectorAll("li")].map((l) => l.textContent)).toEqual([
        "C:x",
        "C:y",
        "C:z", // if backends crossed, this row would be escaped/absent
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
