/**
 * Real event dispatch + bubbling. We use direct addEventListener (no delegation),
 * so a click on a deep child must bubble to an ancestor's handler through the
 * real browser event system — not a simulated one.
 */
import { createSignal } from "pimas";
import { test, expect, mount } from "../runner";

test("a real click on a child bubbles to an ancestor onClick", () => {
  let outerHits = 0;
  const m = mount(() => (
    <div onClick={() => outerHits++}>
      <button type="button">
        <span>deep</span>
      </button>
    </div>
  ));
  const span = m.container.querySelector("span")!;
  span.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(outerHits).toBe(1);
  m.dispose();
});

test("onClick handler updating a signal re-renders fine-grained, in place", () => {
  const m = mount(() => {
    const [n, setN] = createSignal(0);
    return (
      <button type="button" onClick={() => setN(n() + 1)}>
        count: {() => n()}
      </button>
    );
  });
  const btn = m.container.querySelector("button")!;
  const textNodeBefore = btn.lastChild; // the reactive text node
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(btn.textContent).toBe("count: 1");
  expect(btn.lastChild).toBe(textNodeBefore); // same text node, just retargeted
  m.dispose();
});
