/**
 * Live form-control state. The DOM `.value`/`.checked` IDL properties diverge
 * from the attributes after user interaction; happy-dom is unreliable here.
 * A real browser confirms a reactive binding drives the live property.
 */
import { createSignal } from "pimas";
import { test, expect, mount } from "../runner";

test("a reactive value binding drives the live input .value property", () => {
  const [v, setV] = createSignal("hello");
  const m = mount(() => <input value={() => v()} />);
  const input = m.container.querySelector("input")!;
  expect(input.value).toBe("hello");
  setV("world");
  expect(input.value).toBe("world"); // live IDL property, not just the attribute
  m.dispose();
});

test("a reactive checked binding drives the live checkbox .checked property", () => {
  const [on, setOn] = createSignal(false);
  const m = mount(() => <input type="checkbox" checked={() => on()} />);
  const box = m.container.querySelector("input")!;
  expect(box.checked).toBe(false);
  setOn(true);
  expect(box.checked).toBe(true);
  m.dispose();
});
