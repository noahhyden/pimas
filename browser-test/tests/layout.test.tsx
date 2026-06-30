/**
 * Real layout. happy-dom has no layout engine, so offsetWidth/getBoundingClientRect
 * are always 0 there. A real browser proves our nodes actually take up space and
 * that a reactive style update relays out the box.
 */
import { createSignal } from "pimas";
import { test, expect, mount } from "../runner";

test("rendered element has real layout (non-zero box)", () => {
  const m = mount(() => (
    <div style="width:120px;height:40px;display:block">box</div>
  ));
  const el = m.container.querySelector("div")!;
  expect(el.offsetWidth).toBe(120);
  expect(el.getBoundingClientRect().height).toBe(40);
  m.dispose();
});

test("a reactive style binding relayouts the box", () => {
  const [w, setW] = createSignal(50);
  const m = mount(() => (
    <div style={() => `width:${w()}px;height:10px;display:block`}>x</div>
  ));
  const el = m.container.querySelector("div")!;
  expect(el.offsetWidth).toBe(50);
  setW(200);
  expect(el.offsetWidth).toBe(200); // not just the attribute — actual layout moved
  m.dispose();
});
