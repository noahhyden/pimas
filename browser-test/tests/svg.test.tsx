/**
 * Real SVG geometry. happy-dom can report a namespace but cannot compute
 * getBBox() — it returns zeros. noahhyden.com's azulejo pattern is inline SVG,
 * so "the circle actually has geometry" is a guarantee worth checking for real.
 */
import { test, expect, mount } from "../runner";

const SVG_NS = "http://www.w3.org/2000/svg";

test("inline <svg>/<circle> get the SVG namespace (not HTMLUnknownElement)", () => {
  const m = mount(() => (
    <svg viewBox="0 0 100 100" width="100" height="100">
      <circle cx="50" cy="50" r="40" />
    </svg>
  ));
  const circle = m.container.querySelector("circle")! as unknown as SVGGraphicsElement;
  expect((circle as Element).namespaceURI).toBe(SVG_NS);
  m.dispose();
});

test("a rendered <circle> has real geometry via getBBox()", () => {
  const m = mount(() => (
    <svg viewBox="0 0 100 100" width="100" height="100">
      <circle cx="50" cy="50" r="40" />
    </svg>
  ));
  const circle = m.container.querySelector("circle")! as unknown as SVGGraphicsElement;
  const box = circle.getBBox();
  expect(box.width).toBeGreaterThan(70); // r=40 → ~80 wide; 0 in happy-dom
  expect(box.height).toBeGreaterThan(70);
  m.dispose();
});
