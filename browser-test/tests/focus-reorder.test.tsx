/**
 * THE payoff test for keyed <For>. happy-dom tracks document.activeElement but
 * has no real focus model across DOM moves. In a real browser, if <For> truly
 * reuses the SAME input node when a row moves (rather than rebuilding it), the
 * focus and caret survive the reorder. That's the whole point of identity keying.
 */
import { createSignal } from "pimas";
import { For } from "pimas/flow";
import { test, expect, mount } from "../runner";

test("focus survives a keyed <For> reorder (node is moved, not rebuilt)", () => {
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  const [rows, setRows] = createSignal([a, b, c]);

  const m = mount(() => (
    <ul>
      <For each={rows}>
        {(row) => (
          <li>
            <input data-id={row.id} />
          </li>
        )}
      </For>
    </ul>
  ));

  const inputB = m.container.querySelector<HTMLInputElement>('input[data-id="b"]')!;
  inputB.focus();
  inputB.value = "typed into b";
  expect(document.activeElement).toBe(inputB);

  setRows([c, b, a]); // reverse the order

  // Same physical node, moved — so focus, value, and identity all persist.
  const afterB = m.container.querySelector<HTMLInputElement>('input[data-id="b"]')!;
  expect(afterB).toBe(inputB);
  expect(document.activeElement).toBe(inputB);
  expect(afterB.value).toBe("typed into b");
  m.dispose();
});
