/**
 * The CLAIM/HYDRATE backend in a REAL browser (#6 / D#31). happy-dom proves the
 * plan-tree walk and buffer flush; this proves what a simulated DOM can't:
 *   1. Against a REAL HTML parser, the server nodes are ADOPTED (same identity),
 *      not rebuilt — the whole point vs. client-render-first.
 *   2. A signal write mutates the adopted Text node in place (real layout stays).
 *   3. A claimed handler fires on a REAL, trusted-ish event.
 */
import { createSignal } from "pimas";
import { renderToString } from "pimas/server";
import { claim } from "pimas/hydrate";
import { test, expect } from "../runner";

// Server-render `view` into an attached container, as an SSR page delivers markup.
function serverMount(view: () => any): { container: HTMLElement; dispose: () => void } {
  const html = renderToString(view);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return { container, dispose: () => container.remove() };
}

test("claim adopts real server nodes (identity preserved, none recreated)", () => {
  const [n] = createSignal(0);
  const App = () => (
    <div class="card">
      <span>{() => n()}</span>
    </div>
  );
  const m = serverMount(() => <App />);
  const divBefore = m.container.querySelector("div.card")!;
  const spanBefore = m.container.querySelector("span")!;
  const textBefore = spanBefore.firstChild;

  const dispose = claim(() => <App />, m.container);

  expect(m.container.querySelector("div.card") === divBefore).toBe(true);
  expect(m.container.querySelector("span") === spanBefore).toBe(true);
  expect(m.container.querySelector("span")!.firstChild === textBefore).toBe(true);

  dispose();
  m.dispose();
});

test("a signal write updates the adopted text node in place", () => {
  const [n, setN] = createSignal(7);
  const App = () => <b>{() => n()}</b>;
  const m = serverMount(() => <App />);
  expect(m.container.querySelector("b")!.textContent).toBe("7");

  const dispose = claim(() => <App />, m.container);
  const textNode = m.container.querySelector("b")!.firstChild as Text;

  setN(8);
  expect(textNode.data).toBe("8"); // same node, mutated
  expect(m.container.querySelector("b")!.firstChild === textNode).toBe(true);

  dispose();
  m.dispose();
});

test("a claimed handler fires on a real click", () => {
  let clicks = 0;
  const App = () => <button type="button" onClick={() => clicks++}>go</button>;
  const m = serverMount(() => <App />);
  const btn = m.container.querySelector("button")!;

  const dispose = claim(() => <App />, m.container);
  expect(m.container.querySelector("button") === btn).toBe(true);

  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(clicks).toBe(1);

  dispose();
  m.dispose();
});
