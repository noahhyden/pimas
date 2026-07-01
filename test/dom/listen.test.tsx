import { describe, it, expect, vi } from "vitest";
import { render } from "pimas/dom";
import type { HandlerDescriptor } from "pimas/dom";

describe("listen seam — closures and descriptors (#30)", () => {
  it("binds a bare closure handler (today's path)", () => {
    const spy = vi.fn();
    const root = document.createElement("div");
    render(() => <button onClick={spy}>go</button>, root);
    (root.querySelector("button") as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("binds a handler descriptor via synchronous load()", () => {
    const spy = vi.fn();
    const desc: HandlerDescriptor = { ref: "demo#onClick", load: () => spy };
    const root = document.createElement("div");
    render(() => <button onClick={desc as unknown as () => void}>go</button>, root);
    (root.querySelector("button") as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("carries a capture bag without disturbing the closure path", () => {
    const seen: number[] = [];
    const desc: HandlerDescriptor = {
      ref: "demo#withCapture",
      capture: [7], // reserved serialization channel; ignored at runtime today
      load: () => () => seen.push(1),
    };
    const root = document.createElement("div");
    render(() => <button onClick={desc as unknown as () => void}>go</button>, root);
    (root.querySelector("button") as HTMLButtonElement).click();
    expect(seen).toEqual([1]);
  });

  it("throws a clear error for an async (promise) descriptor — not built yet", () => {
    const desc: HandlerDescriptor = { ref: "x", load: () => Promise.resolve(() => {}) };
    const root = document.createElement("div");
    expect(() =>
      render(() => <button onClick={desc as unknown as () => void}>go</button>, root),
    ).toThrow(/unsupported/);
  });
});
