/**
 * Resumability in a REAL browser (#6 / #30). happy-dom proves the wire shape and
 * the dispatch walk; this proves the two things a simulated DOM can't honestly
 * answer:
 *   1. A server-rendered tree becomes interactive on a REAL, trusted-ish event
 *      with ZERO component re-execution (resume, not re-render).
 *   2. The capture-phase dispatcher reaches a NON-BUBBLING event (focus) — the
 *      reason resume registers in the capture phase rather than delegating on
 *      bubble. A bubble-only dispatcher would silently miss this.
 */
import { renderToString } from "pimas/server";
import { resume, registerHandler, clearHandlers } from "pimas/resume";
import { test, expect } from "../runner";

// Author a serializable descriptor (the compiler will emit these later).
const desc = (ref: string, capture?: unknown[]): (() => void) =>
  ({ ref, capture, load: () => () => {} }) as unknown as () => void;

// Server-render `view`, drop the HTML into an attached container as a page would.
function serverMount(view: () => any): { container: HTMLElement; dispose: () => void } {
  clearHandlers();
  const html = renderToString(view);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return { container, dispose: () => container.remove() };
}

test("a server-rendered handler resumes on a real click, component never re-runs", () => {
  let componentRuns = 0;
  function App() {
    componentRuns++;
    return <button type="button" onClick={desc("app#inc", [42])}>count</button>;
  }
  const m = serverMount(() => <App />);
  expect(componentRuns).toBe(1); // the one server render

  const seen: unknown[] = [];
  registerHandler("app#inc", (_e, capture) => seen.push(capture));
  const stop = resume({ root: m.container });

  m.container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(seen.length).toBe(1);
  expect(seen).toEqual([[42]]); // capture delivered
  expect(componentRuns).toBe(1); // ← resumed, not re-rendered

  stop();
  m.dispose();
});

test("capture-phase dispatch reaches a NON-BUBBLING event (focus)", () => {
  const m = serverMount(() => <input type="text" onFocus={desc("field#focus")} />);
  let focused = 0;
  registerHandler("field#focus", () => focused++);
  const stop = resume({ root: m.container });

  // A real focus() fires a non-bubbling `focus` event; a bubble-only delegator
  // would never see it. Capture-phase registration does.
  m.container.querySelector("input")!.focus();

  expect(focused).toBe(1);

  stop();
  m.dispose();
});

test("nearest ancestor's handler wins on a real bubbling click", () => {
  const m = serverMount(() => (
    <div onClick={desc("outer")}>
      <button type="button" onClick={desc("inner")}>
        <span>deep</span>
      </button>
    </div>
  ));
  const hits: string[] = [];
  registerHandler("outer", () => hits.push("outer"));
  registerHandler("inner", () => hits.push("inner"));
  const stop = resume({ root: m.container });

  m.container.querySelector("span")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(hits).toEqual(["inner"]);

  stop();
  m.dispose();
});
