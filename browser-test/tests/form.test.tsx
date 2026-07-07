/**
 * Two-way form binding (#30) in a REAL browser. happy-dom simulates input/change
 * events and live IDL properties; this confirms the `model`/`modelChecked`/
 * `modelNumber` helpers work against trusted-ish real DOM events — especially a
 * checkbox `.click()`, which in a real browser toggles `.checked` AND fires a
 * genuine `change` event (the behavior a simulated DOM most often gets wrong).
 */
import { createSignal } from "pimas";
import { model, modelChecked, modelNumber } from "pimas/dom";
import { test, expect, mount } from "../runner";

test("model: signal drives live .value, and a real input event writes back", () => {
  const [text, setText] = createSignal("hi");
  const m = mount(() => <input {...model(text, setText)} />);
  const input = m.container.querySelector("input")!;

  expect(input.value).toBe("hi"); // signal → live IDL property
  setText("bye");
  expect(input.value).toBe("bye"); // reactive update to the live property

  input.value = "typed";
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(text()).toBe("typed"); // real input event → signal

  m.dispose();
});

test("modelChecked: a real click toggles the bound signal via a trusted change event", () => {
  const [on, setOn] = createSignal(false);
  const m = mount(() => <input type="checkbox" {...modelChecked(on, setOn)} />);
  const box = m.container.querySelector("input")!;

  expect(box.checked).toBe(false);
  box.click(); // genuine gesture: flips .checked AND dispatches a trusted 'change'
  expect(box.checked).toBe(true);
  expect(on()).toBe(true);

  setOn(false);
  expect(box.checked).toBe(false); // signal → live property

  m.dispose();
});

test("modelNumber: valueAsNumber round-trips as a real number", () => {
  const [qty, setQty] = createSignal(2);
  const m = mount(() => <input type="number" {...modelNumber(qty, setQty)} />);
  const input = m.container.querySelector("input")!;

  expect(input.value).toBe("2");
  input.value = "5";
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(qty()).toBe(5); // number, not "5"

  m.dispose();
});
