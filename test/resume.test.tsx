/**
 * Resumability end-to-end (#6 / #30), compiler-free slice.
 *
 * Server side: `renderToString` serializes handler DESCRIPTORS into `on:<type>`
 * attributes + an `application/pimas-state` capture table.
 * Client side: `resume()` reads that table and wires live events by resolving
 * `ref` → handler — WITHOUT re-running any component. That last property (a
 * server-rendered tree becomes interactive with zero component re-execution) is
 * the whole point, asserted below with a component-run sentinel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString, STATE_SCRIPT_TYPE } from "pimas/server";
import type { HandlerDescriptor } from "pimas/dom";
import { resume, registerHandler, clearHandlers } from "pimas/resume";

// A descriptor as authored today (the compiler will emit these later). Cast
// through unknown because JSX types onClick as a plain closure.
const desc = (ref: string, capture?: unknown[]): (() => void) =>
  ({ ref, capture, load: () => () => {} }) as unknown as () => void;

beforeEach(() => clearHandlers());

describe("resume — server serialization shape", () => {
  it("emits on:<type> + a state script for a handler descriptor", () => {
    const html = renderToString(() => <button onClick={desc("app#inc", [7])}>go</button>);
    // the element carries the capture-table INDEX, not the ref
    expect(html).toContain('on:click="0"');
    // the table lives in a typed state script
    expect(html).toContain(`<script type="${STATE_SCRIPT_TYPE}">`);
    const json = html.slice(html.indexOf(">", html.indexOf(STATE_SCRIPT_TYPE)) + 1, html.lastIndexOf("</script>"));
    expect(JSON.parse(json)).toEqual([{ ref: "app#inc", capture: [7] }]);
  });

  it("numbers multiple handlers by create order", () => {
    const html = renderToString(() => (
      <div>
        <button onClick={desc("a")}>a</button>
        <button onClick={desc("b")}>b</button>
      </div>
    ));
    expect(html).toContain('on:click="0"');
    expect(html).toContain('on:click="1"');
    const json = html.slice(html.indexOf(">", html.indexOf(STATE_SCRIPT_TYPE)) + 1, html.lastIndexOf("</script>"));
    expect(JSON.parse(json)).toEqual([
      { ref: "a", capture: [] },
      { ref: "b", capture: [] },
    ]);
  });

  it("emits NOTHING extra for a page with no handlers (0-KB static guarantee)", () => {
    const html = renderToString(() => <p>just text</p>);
    expect(html).toBe("<p>just text</p>");
    expect(html).not.toContain(STATE_SCRIPT_TYPE);
  });

  it("warns and drops a bare closure (can't serialize a live function)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderToString(() => <button onClick={() => {}}>go</button>);
    expect(html).not.toContain("on:click");
    expect(html).not.toContain(STATE_SCRIPT_TYPE);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/closure can't serialize/));
    warn.mockRestore();
  });

  it("escapes </script> in a capture so it can't break out of the tag", () => {
    const html = renderToString(() => <button onClick={desc("x", ["</script>"])}>go</button>);
    expect(html).not.toContain("</script></script>"); // the capture's tag was escaped
    expect(html).toContain("\\u003c/script>");
  });
});

describe("resume — client dispatch (no component re-execution)", () => {
  // Server-render an app, drop the HTML into a fresh container (as a real page
  // would receive it), and resume — the component function must NOT run again.
  function mount(view: () => any) {
    const html = renderToString(view);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    return { container, html };
  }

  it("fires the resumed handler with its capture, without re-running the component", () => {
    let componentRuns = 0;
    function App() {
      componentRuns++; // bumps once per component EXECUTION
      return <button onClick={desc("app#inc", [42])}>count</button>;
    }
    const { container } = mount(() => <App />);
    expect(componentRuns).toBe(1); // the server render

    const seen: unknown[][] = [];
    registerHandler("app#inc", (_e, capture) => seen.push(capture));
    const dispose = resume({ root: container });

    container.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true }));

    expect(seen).toEqual([[42]]); // handler ran with the serialized capture
    expect(componentRuns).toBe(1); // ← resumed, not re-rendered

    dispose();
    container.remove();
  });

  it("round-trips a rich capture (Date/Map) through the state script end-to-end", () => {
    const when = new Date("2026-07-02T00:00:00.000Z");
    const tags = new Map<string, number>([["a", 1]]);
    const { container } = mount(() => <button onClick={desc("row#save", [when, tags])}>save</button>);

    const seen: unknown[][] = [];
    registerHandler("row#save", (_e, capture) => seen.push(capture));
    const dispose = resume({ root: container });

    container.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true }));

    const [cap] = seen;
    expect((cap![0] as Date).getTime()).toBe(when.getTime()); // Date survived
    expect((cap![1] as Map<string, number>).get("a")).toBe(1); // Map survived

    dispose();
    container.remove();
  });

  it("resolves the NEAREST ancestor's handler (delegation walk)", () => {
    const { container } = mount(() => (
      <div onClick={desc("outer")}>
        <button onClick={desc("inner")}>x</button>
      </div>
    ));
    const hits: string[] = [];
    registerHandler("outer", () => hits.push("outer"));
    registerHandler("inner", () => hits.push("inner"));
    const dispose = resume({ root: container });

    container.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(hits).toEqual(["inner"]); // nearest wins, like a single bound listener

    dispose();
    container.remove();
  });

  it("dispose() removes the listeners", () => {
    const { container } = mount(() => <button onClick={desc("app#x")}>x</button>);
    const hits: number[] = [];
    registerHandler("app#x", () => hits.push(1));
    const dispose = resume({ root: container });
    const btn = container.querySelector("button")!;

    btn.dispatchEvent(new Event("click", { bubbles: true }));
    dispose();
    btn.dispatchEvent(new Event("click", { bubbles: true }));
    expect(hits).toEqual([1]); // only the pre-dispose click

    container.remove();
  });

  it("warns (does not throw) when a ref has no registered handler", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = mount(() => <button onClick={desc("app#missing")}>x</button>);
    const dispose = resume({ root: container });

    expect(() =>
      container.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true })),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no handler registered for ref "app#missing"/));

    warn.mockRestore();
    dispose();
    container.remove();
  });

  it("registerHandler warns on a conflicting duplicate ref", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerHandler("dup", () => {});
    registerHandler("dup", () => {}); // different fn, same ref
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/registered twice/));
    warn.mockRestore();
  });
});
