import { describe, it, expect, vi } from "vitest";
import {
  createSignal,
  createEffect,
  createMemo,
  batch,
  setScheduler,
  flushSync,
  untrack,
  onCleanup,
  createRoot,
} from "pimas";

describe("createSignal", () => {
  it("reads and writes a value", () => {
    const [count, setCount] = createSignal(0);
    expect(count()).toBe(0);
    setCount(5);
    expect(count()).toBe(5);
  });

  it("supports functional updates", () => {
    const [count, setCount] = createSignal(10);
    setCount((n) => n + 1);
    expect(count()).toBe(11);
  });

  it("write returns the new value", () => {
    const [, setCount] = createSignal(0);
    expect(setCount(42)).toBe(42);
  });
});

describe("createEffect", () => {
  it("runs immediately on creation", () => {
    const spy = vi.fn();
    createRoot(() => createEffect(spy));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-runs when a read signal changes", () => {
    const [count, setCount] = createSignal(0);
    const seen: number[] = [];
    createRoot(() => createEffect(() => seen.push(count())));
    setCount(1);
    setCount(2);
    expect(seen).toEqual([0, 1, 2]);
  });

  it("does NOT re-run when an unread signal changes", () => {
    const [a, setA] = createSignal(0);
    const [, setB] = createSignal(0);
    const spy = vi.fn();
    createRoot(() =>
      createEffect(() => {
        a(); // only subscribes to `a`
        spy();
      }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    setB(1); // b is never read
    expect(spy).toHaveBeenCalledTimes(1);
    setA(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not re-run when a value is set to an equal value", () => {
    const [count, setCount] = createSignal(0);
    const spy = vi.fn();
    createRoot(() => createEffect(() => { count(); spy(); }));
    expect(spy).toHaveBeenCalledTimes(1);
    setCount(0); // Object.is equal → no notification
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("tracks dependencies dynamically (conditional branches)", () => {
    const [toggle, setToggle] = createSignal(true);
    const [a, setA] = createSignal("a");
    const [b, setB] = createSignal("b");
    const seen: string[] = [];
    createRoot(() => createEffect(() => seen.push(toggle() ? a() : b())));

    expect(seen).toEqual(["a"]);
    setB("b2"); // not currently read (toggle is true) → no re-run
    expect(seen).toEqual(["a"]);

    setToggle(false); // now reads b (its current value is "b2"), stops reading a
    expect(seen).toEqual(["a", "b2"]);
    setA("a2"); // a no longer read → no re-run
    expect(seen).toEqual(["a", "b2"]);
    setB("b3"); // b now read → re-runs
    expect(seen).toEqual(["a", "b2", "b3"]);
  });
});

describe("createMemo", () => {
  it("derives and caches a value", () => {
    const [count, setCount] = createSignal(2);
    let computations = 0;
    const doubled = createRoot(() =>
      createMemo(() => {
        computations++;
        return count() * 2;
      }),
    );
    expect(doubled()).toBe(4);
    expect(doubled()).toBe(4); // cached read, no recompute
    expect(computations).toBe(1);
    setCount(5);
    expect(doubled()).toBe(10);
    expect(computations).toBe(2);
  });

  it("can be consumed by an effect", () => {
    const [count, setCount] = createSignal(1);
    const seen: number[] = [];
    createRoot(() => {
      const doubled = createMemo(() => count() * 2);
      createEffect(() => seen.push(doubled()));
    });
    setCount(3);
    expect(seen).toEqual([2, 6]);
  });
});

describe("batch", () => {
  it("coalesces multiple writes into a single re-run", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const spy = vi.fn();
    createRoot(() => createEffect(() => { a(); b(); spy(); }));
    expect(spy).toHaveBeenCalledTimes(1);

    batch(() => {
      setA(1);
      setB(1);
    });
    expect(spy).toHaveBeenCalledTimes(2); // one flush, not two
  });

  it("returns the callback result", () => {
    expect(batch(() => 7)).toBe(7);
  });
});

describe("scheduler seam", () => {
  it("flushes synchronously by default", () => {
    // The regression lock: a write's effects must be observable the instant the
    // write returns (renderToString + post-write DOM reads depend on this).
    const [n, setN] = createSignal(0);
    const seen: number[] = [];
    createRoot(() => createEffect(() => seen.push(n())));
    setN(1);
    expect(seen).toEqual([0, 1]); // no await — already flushed
  });

  it("a custom scheduler defers the flush until it is driven", () => {
    let captured: (() => void) | null = null;
    const prev = setScheduler((flush) => {
      captured = flush;
    });
    try {
      const [n, setN] = createSignal(0);
      const spy = vi.fn();
      createRoot(() => createEffect(() => (n(), spy())));
      expect(spy).toHaveBeenCalledTimes(1); // creation runs synchronously

      setN(1);
      expect(spy).toHaveBeenCalledTimes(1); // deferred — not re-run yet
      captured!(); // drive the captured flush
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      setScheduler(prev);
    }
  });

  it("coalesces a synchronous write-burst into one microtask flush, FIFO order", async () => {
    const prev = setScheduler((flush) => queueMicrotask(flush));
    try {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const order: string[] = [];
      createRoot(() => {
        createEffect(() => (a(), order.push("A")));
        createEffect(() => (b(), order.push("B")));
      });
      order.length = 0; // drop the synchronous creation runs

      setA(1);
      setB(1);
      setA(2); // A already dirty → not re-enqueued
      expect(order).toEqual([]); // nothing flushed synchronously

      await Promise.resolve(); // let the coalesced microtask run
      expect(order).toEqual(["A", "B"]); // one flush, enqueue order, each once
    } finally {
      setScheduler(prev);
    }
  });

  it("skips an effect disposed before a deferred flush runs", async () => {
    const prev = setScheduler((flush) => queueMicrotask(flush));
    try {
      const [n, setN] = createSignal(0);
      const spy = vi.fn();
      let dispose!: () => void;
      createRoot((d) => {
        dispose = d;
        createEffect(() => (n(), spy()));
      });
      expect(spy).toHaveBeenCalledTimes(1);

      setN(1); // enqueues the effect for the deferred flush
      dispose(); // …but it's disposed before the microtask fires
      await Promise.resolve();
      expect(spy).toHaveBeenCalledTimes(1); // disposed → skipped
    } finally {
      setScheduler(prev);
    }
  });

  it("flushSync forces a drain while a deferred scheduler is installed", () => {
    const prev = setScheduler(() => {
      /* never auto-flushes */
    });
    try {
      const [n, setN] = createSignal(0);
      const seen: number[] = [];
      createRoot(() => createEffect(() => seen.push(n())));
      setN(1);
      expect(seen).toEqual([0]); // scheduler dropped the flush
      flushSync(); // escape hatch drains now
      expect(seen).toEqual([0, 1]);
    } finally {
      setScheduler(prev);
    }
  });
});

describe("untrack", () => {
  it("reads without subscribing", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const seen: number[] = [];
    createRoot(() =>
      createEffect(() => {
        // depends on a, but reads b untracked
        seen.push(a() + untrack(() => b()));
      }),
    );
    expect(seen).toEqual([0]);
    setB(10); // untracked → no re-run
    expect(seen).toEqual([0]);
    setA(1); // re-runs, picks up b's latest value
    expect(seen).toEqual([0, 11]);
  });
});

describe("onCleanup", () => {
  it("runs before each re-run", () => {
    const [count, setCount] = createSignal(0);
    const cleanups: number[] = [];
    createRoot(() =>
      createEffect(() => {
        const c = count();
        onCleanup(() => cleanups.push(c));
      }),
    );
    expect(cleanups).toEqual([]);
    setCount(1); // cleanup for previous run (0) fires before re-run
    expect(cleanups).toEqual([0]);
    setCount(2);
    expect(cleanups).toEqual([0, 1]);
  });

  it("runs on disposal", () => {
    const spy = vi.fn();
    const dispose = createRoot((dispose) => {
      createEffect(() => onCleanup(spy));
      return dispose;
    });
    expect(spy).not.toHaveBeenCalled();
    dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("createRoot", () => {
  it("disposes nested effects so they stop reacting", () => {
    const [count, setCount] = createSignal(0);
    const spy = vi.fn();
    const dispose = createRoot((dispose) => {
      createEffect(() => { count(); spy(); });
      return dispose;
    });
    expect(spy).toHaveBeenCalledTimes(1);
    setCount(1);
    expect(spy).toHaveBeenCalledTimes(2);
    dispose();
    setCount(2); // effect disposed → no more runs
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("disposes deeply nested (owned) effects", () => {
    const [count, setCount] = createSignal(0);
    const inner = vi.fn();
    const dispose = createRoot((dispose) => {
      createEffect(() => {
        // inner effect is owned by the outer one
        createEffect(() => { count(); inner(); });
      });
      return dispose;
    });
    expect(inner).toHaveBeenCalledTimes(1);
    dispose();
    setCount(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe("push-pull guarantees", () => {
  it("is glitch-free in a diamond: D recomputes once, never stale", () => {
    const [a, setA] = createSignal(1);
    let dRuns = 0;
    const seen: number[] = [];
    createRoot(() => {
      const b = createMemo(() => a() + 1);
      const c = createMemo(() => a() + 1);
      const d = createMemo(() => {
        dRuns++;
        return b() + c();
      });
      createEffect(() => seen.push(d()));
    });
    expect(seen).toEqual([4]); // (1+1)+(1+1)
    expect(dRuns).toBe(1);

    setA(2);
    expect(seen).toEqual([4, 6]); // (2+1)+(2+1) — emitted once, never the glitched value
    expect(dRuns).toBe(2); // exactly one recompute, not two
  });

  it("memos are lazy — never computed until read", () => {
    const [a, setA] = createSignal(0);
    let runs = 0;
    createRoot(() => {
      createMemo(() => {
        runs++;
        return a();
      });
    });
    expect(runs).toBe(0); // created but never read
    setA(1);
    expect(runs).toBe(0); // still unread → still not computed
  });

  it("equality short-circuit stops downstream recompute", () => {
    const [a, setA] = createSignal(2);
    let effRuns = 0;
    createRoot(() => {
      const parity = createMemo(() => a() % 2);
      createEffect(() => {
        parity();
        effRuns++;
      });
    });
    expect(effRuns).toBe(1);

    setA(4); // 4 % 2 === 0, same as before → memo recomputes, value unchanged → effect NOT re-run
    expect(effRuns).toBe(1);

    setA(3); // 3 % 2 === 1, changed → effect re-runs
    expect(effRuns).toBe(2);
  });

  it("a write inside an effect cascades correctly", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const seen: number[] = [];
    createRoot(() => {
      createEffect(() => {
        if (a() === 1) setB(10); // write during flush
      });
      createEffect(() => seen.push(b()));
    });
    expect(seen).toEqual([0]);
    setA(1);
    expect(seen).toEqual([0, 10]); // the b-effect picked up the cascaded write
  });
});
