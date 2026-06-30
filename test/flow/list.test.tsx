import { describe, it, expect } from "vitest";
import { createSignal, onCleanup } from "pimas";
import { render } from "pimas/dom";
import { renderToString } from "pimas/server";
import { For, Index } from "pimas/flow";

const texts = (root: Element, sel = "li") =>
  [...root.querySelectorAll(sel)].map((n) => n.textContent);

describe("For (identity-keyed)", () => {
  it("renders a list and updates on add/remove", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const [items, setItems] = createSignal([a, b, c]);
    const root = document.createElement("div");
    render(
      () => (
        <ul>
          <For each={items}>{(it) => <li>{() => it.id}</li>}</For>
        </ul>
      ),
      root,
    );
    expect(texts(root)).toEqual(["a", "b", "c"]);
    setItems([a, c]); // remove b
    expect(texts(root)).toEqual(["a", "c"]);
    setItems([a, c, b]); // re-add b at end
    expect(texts(root)).toEqual(["a", "c", "b"]);
  });

  it("reuses the SAME DOM node for a surviving item across reorder", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const [items, setItems] = createSignal([a, b, c]);
    const root = document.createElement("div");
    render(() => <ul><For each={items}>{(it) => <li>{() => it.id}</li>}</For></ul>, root);

    const liB = root.querySelectorAll("li")[1]!; // b's node
    setItems([c, b, a]); // reverse
    const after = [...root.querySelectorAll("li")];
    expect(after.map((l) => l.textContent)).toEqual(["c", "b", "a"]);
    expect(after[1]).toBe(liB); // same instance, moved — not rebuilt
  });

  it("does not re-run a surviving row's body on move; updates its index", () => {
    const a = { n: "a" }, b = { n: "b" };
    const [items, setItems] = createSignal([a, b]);
    let builds = 0;
    const root = document.createElement("div");
    render(
      () => (
        <ul>
          <For each={items}>
            {(it, i) => {
              builds++;
              return <li>{() => i() + ":" + it.n}</li>;
            }}
          </For>
        </ul>
      ),
      root,
    );
    expect(builds).toBe(2);
    expect(texts(root)).toEqual(["0:a", "1:b"]);

    setItems([b, a]); // swap
    expect(builds).toBe(2); // bodies did NOT re-run
    expect(texts(root)).toEqual(["0:b", "1:a"]); // index signals updated
  });

  it("disposes removed rows (runs their onCleanup)", () => {
    const a = { id: "a" }, b = { id: "b" };
    const [items, setItems] = createSignal([a, b]);
    const cleaned: string[] = [];
    function Row(props: { id: string }) {
      onCleanup(() => cleaned.push(props.id));
      return <li>{props.id}</li>;
    }
    const root = document.createElement("div");
    render(() => <ul><For each={items}>{(it) => <Row id={it.id} />}</For></ul>, root);

    expect(cleaned).toEqual([]);
    setItems([a]); // remove b
    expect(cleaned).toEqual(["b"]);
  });

  it("renders fallback when empty", () => {
    const [items, setItems] = createSignal<number[]>([1, 2]);
    const root = document.createElement("div");
    render(
      () => (
        <ul>
          <For each={items} fallback={() => <li>empty</li>}>
            {(n) => <li>{() => n}</li>}
          </For>
        </ul>
      ),
      root,
    );
    expect(texts(root)).toEqual(["1", "2"]);
    setItems([]);
    expect(texts(root)).toEqual(["empty"]);
    setItems([3]);
    expect(texts(root)).toEqual(["3"]);
  });
});

describe("Index (position-keyed)", () => {
  it("updates a slot's value in place without rebuilding the row", () => {
    const [cells, setCells] = createSignal(["x", "y"]);
    let builds = 0;
    const root = document.createElement("div");
    render(
      () => (
        <ul>
          <Index each={cells}>
            {(value) => {
              builds++;
              return <li>{() => value()}</li>;
            }}
          </Index>
        </ul>
      ),
      root,
    );
    expect(builds).toBe(2);
    expect(texts(root)).toEqual(["x", "y"]);

    setCells(["x", "z"]); // position 1 value changed
    expect(builds).toBe(2); // no new row built
    expect(texts(root)).toEqual(["x", "z"]); // value signal updated in place
  });
});

describe("For under SSR", () => {
  it("renders every row once, in order", () => {
    const html = renderToString(() => (
      <ul>
        <For each={[1, 2, 3]}>{(n) => <li>{() => n}</li>}</For>
      </ul>
    ));
    expect(html).toContain("1");
    expect(html).toContain("2");
    expect(html).toContain("3");
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
  });
});
