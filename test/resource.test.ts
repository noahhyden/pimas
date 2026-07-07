import { describe, it, expect } from "vitest";
import { createRoot, createSignal, createEffect } from "pimas";
import { createResource } from "pimas/resource";

/** A promise whose settlement we control from the test. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush all pending microtasks (the resource's internal `.then` handlers). */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createResource (#19)", () => {
  it("fetcher-only: pending → ready, value + loading transitions", async () => {
    const d = deferred<number>();
    const [data] = createRoot(() => createResource(() => d.promise));

    expect(data()).toBeUndefined();
    expect(data.loading()).toBe(true);
    expect(data.state()).toBe("pending");

    d.resolve(42);
    await tick();

    expect(data()).toBe(42);
    expect(data.loading()).toBe(false);
    expect(data.state()).toBe("ready");
    expect(data.error()).toBeUndefined();
  });

  it("rejection routes to error state, not a throw", async () => {
    const d = deferred<number>();
    const [data] = createRoot(() => createResource(() => d.promise));

    d.reject(new Error("boom"));
    await tick();

    expect(data.state()).toBe("errored");
    expect((data.error() as Error).message).toBe("boom");
    expect(data.loading()).toBe(false);
    expect(data()).toBeUndefined();
  });

  it("source form: skips falsy source, fetches on truthy, refetches on change", async () => {
    const [id, setId] = createSignal<number | null>(null);
    const calls: number[] = [];
    const [data] = createRoot(() =>
      createResource(id, (n) => {
        calls.push(n);
        return Promise.resolve(n * 2);
      }),
    );

    expect(data.state()).toBe("unresolved");
    expect(calls).toEqual([]); // null source → no fetch

    setId(2);
    await tick();
    expect(calls).toEqual([2]);
    expect(data()).toBe(4);
    expect(data.state()).toBe("ready");

    setId(3);
    await tick();
    expect(calls).toEqual([2, 3]);
    expect(data()).toBe(6);
  });

  it("drops a stale in-flight fetch (last source wins, no out-of-order commit)", async () => {
    const [id, setId] = createSignal(1);
    const ds = new Map<number, ReturnType<typeof deferred<number>>>();
    const [data] = createRoot(() =>
      createResource(id, (n) => {
        const d = deferred<number>();
        ds.set(n, d);
        return d.promise;
      }),
    );
    await tick(); // request for id=1 is in flight

    setId(2); // request for id=2 now in flight; id=1 is stale
    await tick();

    ds.get(2)!.resolve(20);
    await tick();
    expect(data()).toBe(20);

    ds.get(1)!.resolve(10); // stale resolution must be ignored
    await tick();
    expect(data()).toBe(20);
  });

  it("refetch() re-runs the fetcher", async () => {
    let n = 0;
    const [data, { refetch }] = createRoot(() => createResource(() => Promise.resolve(++n)));
    await tick();
    expect(data()).toBe(1);
    expect(data.state()).toBe("ready");

    refetch();
    expect(data.state()).toBe("refreshing"); // had a value → refreshing, not pending
    await tick();
    expect(data()).toBe(2);
    expect(data.state()).toBe("ready");
  });

  it("mutate() sets the value locally and invalidates an in-flight fetch", async () => {
    const d = deferred<number>();
    const [data, { mutate }] = createRoot(() => createResource(() => d.promise));

    mutate(99);
    expect(data()).toBe(99);
    expect(data.state()).toBe("ready");
    expect(data.loading()).toBe(false);

    d.resolve(1); // the original fetch resolves late — must not clobber the mutation
    await tick();
    expect(data()).toBe(99);
  });

  it("the resource accessor is reactive (drives effects on resolve)", async () => {
    const d = deferred<number>();
    const [data] = createRoot(() => createResource(() => d.promise));
    const seen: (number | undefined)[] = [];
    createRoot(() => createEffect(() => seen.push(data())));

    expect(seen).toEqual([undefined]); // initial run

    d.resolve(5);
    await tick();
    expect(seen).toContain(5);
  });

  it("does not commit after the owning root is disposed", async () => {
    const d = deferred<number>();
    let data!: ReturnType<typeof createResource<number>>[0];
    const dispose = createRoot((d2) => {
      [data] = createResource(() => d.promise);
      return d2;
    });

    dispose();
    d.resolve(7);
    await tick();
    // The late resolution is dropped; value stays unresolved (no throw, no write).
    expect(data()).toBeUndefined();
  });
});
