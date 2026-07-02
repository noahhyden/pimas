/**
 * The scheduler seam in a REAL browser (#3). vitest can only drive the coalescing
 * with a hand-rolled microtask; here we install a genuine `queueMicrotask`
 * scheduler and prove, against real DOM, that:
 *   - a synchronous write-burst defers (the DOM does NOT update mid-turn), and
 *   - N writes coalesce into ONE flush (a single re-render), effects still FIFO,
 *   - `flushSync()` is the escape hatch that force-drains immediately.
 * This is the client-side repaint-coalescing contract a site opts into in its
 * island boot — the thing a simulated DOM can't honestly time.
 */
import { createSignal, createEffect, setScheduler, flushSync } from "pimas";
import { test, expect, mount } from "../runner";

test("a queueMicrotask scheduler coalesces a write-burst into one flush", async () => {
  const prev = setScheduler((f) => queueMicrotask(f));
  try {
    const [n, setN] = createSignal(0);
    let renders = 0;
    const m = mount(() => (
      <p>
        {() => {
          renders++;
          return `n=${n()}`;
        }}
      </p>
    ));
    const el = m.container.querySelector("p")!;
    expect(el.textContent).toBe("n=0");
    const rendersAfterMount = renders; // 1 (the initial synchronous build)

    // Three writes in one synchronous turn.
    setN(1);
    setN(2);
    setN(3);
    // Deferred: the DOM has NOT moved yet, and no re-render has happened.
    expect(el.textContent).toBe("n=0");
    expect(renders).toBe(rendersAfterMount);

    await Promise.resolve(); // let the coalesced microtask flush run
    expect(el.textContent).toBe("n=3"); // final value only
    expect(renders).toBe(rendersAfterMount + 1); // ONE flush, not three

    m.dispose();
  } finally {
    setScheduler(prev);
  }
});

test("flushSync force-drains while a deferred scheduler is installed", () => {
  const prev = setScheduler(() => {
    /* drop the callback — nothing auto-flushes */
  });
  try {
    const [n, setN] = createSignal(0);
    const m = mount(() => <p>{() => `n=${n()}`}</p>);
    const el = m.container.querySelector("p")!;

    setN(1);
    expect(el.textContent).toBe("n=0"); // scheduler dropped the flush
    flushSync(); // escape hatch drains now, against real DOM
    expect(el.textContent).toBe("n=1");

    m.dispose();
  } finally {
    setScheduler(prev);
  }
});

test("multiple independent effects still run in FIFO order under the scheduler", async () => {
  const prev = setScheduler((f) => queueMicrotask(f));
  try {
    const [a, setA] = createSignal(0);
    const order: string[] = [];
    const m = mount(() => {
      createEffect(() => (a(), order.push("first")));
      createEffect(() => (a(), order.push("second")));
      return <i>x</i>;
    });
    order.length = 0; // drop the synchronous creation runs
    setA(1);
    expect(order).toEqual([]); // deferred
    await Promise.resolve();
    expect(order).toEqual(["first", "second"]); // one flush, enqueue order
    m.dispose();
  } finally {
    setScheduler(prev);
  }
});
