/**
 * pimas/flow — control-flow components.
 *
 * These are renderer-agnostic: each returns a reactive accessor (a thunk) that
 * the renderer's `insert` binds as a dynamic child. They never touch a backend,
 * so they work under DOM and SSR alike.
 *
 * Ownership is the trick. Each component returns a memo; the branch it renders is
 * created *during that memo's run*, so the branch's effects/cleanups are owned by
 * the memo. When the condition changes and the memo re-runs, the previous
 * branch's owner is torn down (its `onCleanup`s fire) before the new one is built
 * — that's how `<Show>` actually unmounts, not just hides.
 *
 * Convention: pass branch children as a THUNK — `<Show when={x}>{() => <Heavy/>}</Show>`
 * — so the subtree is built lazily (only while shown) and disposed when hidden.
 */
import {
  createMemo,
  createSignal,
  createRoot,
  onCleanup,
  untrack,
  catchError,
  type Accessor,
} from "../reactive/index.js";
import type { Child } from "../dom/engine.js";

type Maybe<T> = T | (() => T);
const evalMaybe = <T>(v: Maybe<T>): T => (typeof v === "function" ? (v as () => T)() : v);
const toAccessor = <T>(v: T | Accessor<T>): Accessor<T> =>
  typeof v === "function" ? (v as Accessor<T>) : () => v;
const disposeAll = (ds: Array<() => void>): void => {
  for (const d of ds) d();
};

/**
 * Render `children` while `when` is truthy, else `fallback`. The branch is built
 * once per truthy transition and disposed when it flips false (or `<Show>` is
 * removed). `when` may be a value or an accessor; children/fallback may be a node
 * or a thunk.
 */
export function Show(props: {
  when: Maybe<unknown>;
  fallback?: Child;
  children: Child;
}): Accessor<Child> {
  // Memoize to a boolean so the branch only rebuilds on a true<->false flip,
  // not on every change to the underlying value.
  const condition = createMemo(() => !!evalMaybe(props.when));
  return createMemo<Child>(() =>
    condition() ? evalMaybe(props.children as Maybe<Child>) : evalMaybe(props.fallback as Maybe<Child>),
  );
}

/**
 * Catch errors thrown while building or updating `children` and render `fallback`
 * instead. `fallback` may be a static child or a function `(err, reset) => Child`;
 * calling `reset()` clears the error and rebuilds `children` fresh.
 *
 * Like `<Show>`, children must be a THUNK — `<ErrorBoundary fallback={...}>{() =>
 * <App/>}</ErrorBoundary>` — because eager children would be built before the
 * boundary's owner scope exists, so their throws wouldn't be caught here.
 */
export function ErrorBoundary(props: {
  fallback: Child | ((err: unknown, reset: () => void) => Child);
  children: Child;
}): Accessor<Child> {
  const [errored, setErrored] = createSignal<unknown>(undefined);
  const reset = () => setErrored(undefined);
  const renderFallback = (e: unknown): Child => {
    const f = props.fallback;
    return typeof f === "function" && (f as Function).length >= 1
      ? untrack(() => (f as (err: unknown, reset: () => void) => Child)(e, reset))
      : (f as Child);
  };
  return createMemo<Child>(() => {
    const e = errored();
    if (e !== undefined) return renderFallback(e);
    // Catch synchronously. The handler both records the error into `errored`
    // (so `reset()` is reactive) and captures it locally — because the signal
    // write happens DURING this memo's own compute and would otherwise be
    // clobbered when the pull marks us CLEAN, so we render the fallback inline
    // in the SAME pass rather than waiting for a re-run that never comes.
    let thrown: { err: unknown } | undefined;
    const built = catchError(
      () => (typeof props.children === "function" ? (props.children as () => Child)() : props.children),
      (err) => {
        const norm = err === undefined ? new Error("undefined thrown") : err;
        thrown = { err: norm };
        setErrored(norm);
      },
    );
    return thrown ? renderFallback(thrown.err) : built;
  });
}

export interface MatchProps {
  when: Maybe<unknown>;
  children: Child;
}

/**
 * A single case inside `<Switch>`. It's a marker: it returns its own props for
 * `<Switch>` to inspect, but is typed as `Child` so it type-checks as a JSX
 * element. `<Switch>` casts the children back to `MatchProps` at runtime.
 */
export function Match(props: MatchProps): Child {
  return props as unknown as Child;
}

/**
 * Render the first `<Match>` whose `when` is truthy, else `fallback`. Only the
 * selected branch is built; switching selection disposes the previous one.
 */
export function Switch(props: {
  fallback?: Child;
  children: Child | Child[];
}): Accessor<Child> {
  const matches = (Array.isArray(props.children) ? props.children : [props.children]) as unknown as MatchProps[];
  // Which case is selected — recomputes when any `when` changes, but only marks
  // downstream dirty when the *selected case* actually changes (equality cutoff).
  const selected = createMemo<MatchProps | null>(() => {
    for (const m of matches) if (evalMaybe(m.when)) return m;
    return null;
  });
  return createMemo<Child>(() => {
    const m = selected();
    return m ? evalMaybe(m.children as Maybe<Child>) : evalMaybe(props.fallback as Maybe<Child>);
  });
}

// ── Keyed list reconciliation ────────────────────────────────────────────

/**
 * Map a reactive array to rows keyed by ITEM IDENTITY (`===` / SameValueZero).
 * A surviving item's row — its DOM and reactive scope — is reused across updates;
 * the body runs once per row and never re-runs on reorder. If the body reads its
 * index, only that row's index signal is written when it moves. Removed rows are
 * disposed (their `onCleanup`s fire). Returns the reconciler; `<For>` wraps it in
 * a memo. (After Solid's `mapArray`.)
 */
function mapArray<T, U>(
  list: Accessor<readonly T[]>,
  mapFn: (item: T, index: Accessor<number>) => U,
  fallback?: () => U,
): () => U[] {
  let items: T[] = [];
  let mapped: U[] = [];
  let disposers: Array<() => void> = [];
  let len = 0;
  // Only allocate index signals if the body actually reads its index.
  let indexes: Array<(i: number) => void> | null = mapFn.length > 1 ? [] : null;
  let usingFallback = false;

  onCleanup(() => disposeAll(disposers));

  function makeRow(j: number, item: T): U {
    return createRoot((d) => {
      disposers[j] = d;
      if (indexes) {
        const [index, setIndex] = createSignal(j);
        indexes[j] = setIndex;
        return mapFn(item, index);
      }
      return mapFn(item, () => j);
    });
  }

  return () => {
    const newItems = (list() || []) as T[];
    const newLen = newItems.length;
    return untrack(() => {
      // FAST: clear (→ optional fallback)
      if (newLen === 0) {
        if (len !== 0) {
          disposeAll(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          if (indexes) indexes = [];
        }
        if (fallback && !usingFallback) {
          usingFallback = true;
          mapped = [createRoot((d) => ((disposers[0] = d), fallback()))];
        }
        return mapped;
      }
      if (usingFallback) {
        disposeAll(disposers);
        disposers = [];
        mapped = [];
        usingFallback = false;
      }

      // FAST: initial create
      if (len === 0) {
        mapped = new Array(newLen);
        for (let j = 0; j < newLen; j++) {
          items[j] = newItems[j]!;
          mapped[j] = makeRow(j, newItems[j]!);
        }
        len = newLen;
        return mapped.slice();
      }

      // General diff: trim common prefix/suffix, then a backward key-map for the
      // middle. Survivors are staged into `temp` at their new index; missing rows
      // are disposed; genuinely new items are created.
      const temp: U[] = new Array(newLen);
      const tempDisposers: Array<() => void> = new Array(newLen);
      const tempIndexes: Array<(i: number) => void> | null = indexes ? new Array(newLen) : null;

      let start = 0;
      let end = Math.min(len, newLen);
      while (start < end && items[start] === newItems[start]) start++;

      end = len - 1;
      let newEnd = newLen - 1;
      while (end >= start && newEnd >= start && items[end] === newItems[newEnd]) {
        temp[newEnd] = mapped[end]!;
        tempDisposers[newEnd] = disposers[end]!;
        if (indexes && tempIndexes) tempIndexes[newEnd] = indexes[end]!;
        end--;
        newEnd--;
      }

      // Map each unresolved new item → its smallest index, chaining duplicates.
      const newIndices = new Map<T, number>();
      const newIndicesNext: number[] = new Array(newEnd + 1);
      for (let j = newEnd; j >= start; j--) {
        const item = newItems[j]!;
        const i = newIndices.get(item);
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(item, j);
      }

      // Walk the old middle: reuse where the item is still wanted, else dispose.
      for (let i = start; i <= end; i++) {
        const item = items[i]!;
        const j = newIndices.get(item);
        if (j !== undefined && j !== -1) {
          temp[j] = mapped[i]!;
          tempDisposers[j] = disposers[i]!;
          if (indexes && tempIndexes) tempIndexes[j] = indexes[i]!;
          newIndices.set(item, newIndicesNext[j]!);
        } else {
          disposers[i]!();
        }
      }

      // Materialize the new array: reuse staged rows (updating index), else create.
      for (let j = start; j < newLen; j++) {
        if (j in temp) {
          mapped[j] = temp[j]!;
          disposers[j] = tempDisposers[j]!;
          if (indexes && tempIndexes) {
            indexes[j] = tempIndexes[j]!;
            indexes[j]!(j);
          }
        } else {
          mapped[j] = makeRow(j, newItems[j]!);
        }
      }

      mapped = mapped.slice(0, newLen);
      disposers.length = newLen;
      if (indexes) indexes.length = newLen;
      len = newLen;
      items = newItems.slice();
      return mapped.slice();
    });
  };
}

/**
 * Render a reactive list, keyed by item identity. Reorders move DOM rows (and
 * their state) rather than rebuilding them.
 *
 *   <For each={items}>{(item, i) => <li>{() => i() + ": " + item.name}</li>}</For>
 */
export function For<T>(props: {
  each: readonly T[] | Accessor<readonly T[]>;
  fallback?: Child;
  children: (item: T, index: Accessor<number>) => Child;
}): Accessor<Child> {
  const list = toAccessor(props.each) as Accessor<readonly T[]>;
  const fallback = props.fallback != null ? () => props.fallback as Child : undefined;
  return createMemo(mapArray<T, Child>(list, props.children, fallback)) as Accessor<Child>;
}

/**
 * Map a reactive array to rows keyed by POSITION. The DOM at each slot stays put;
 * when the value at a position changes, only that slot's value signal updates. No
 * moves. Use for primitives or fixed-position state. (After Solid's `indexArray`.)
 */
function indexArray<T, U>(
  list: Accessor<readonly T[]>,
  mapFn: (value: Accessor<T>, index: number) => U,
): () => U[] {
  let items: T[] = [];
  let mapped: U[] = [];
  let disposers: Array<() => void> = [];
  let signals: Array<(v: T) => void> = [];
  let len = 0;

  onCleanup(() => disposeAll(disposers));

  return () => {
    const newItems = (list() || []) as T[];
    const newLen = newItems.length;
    return untrack(() => {
      if (newLen === 0) {
        if (len !== 0) {
          disposeAll(disposers);
          disposers = [];
          items = [];
          mapped = [];
          signals = [];
          len = 0;
        }
        return mapped;
      }
      let i = 0;
      for (; i < newLen; i++) {
        if (i < len && items[i] !== newItems[i]) {
          signals[i]!(newItems[i]!); // same slot, new value — no DOM move, no rebuild
        } else if (i >= len) {
          const j = i;
          mapped[j] = createRoot((d) => {
            disposers[j] = d;
            const [value, setValue] = createSignal(newItems[j]!);
            signals[j] = setValue as (v: T) => void;
            return mapFn(value, j);
          });
        }
      }
      for (; i < len; i++) disposers[i]!(); // shrink: dispose tail rows
      if (newLen < len) {
        mapped.length = signals.length = disposers.length = newLen;
      }
      len = newLen;
      items = newItems.slice();
      return mapped.slice();
    });
  };
}

/**
 * Render a reactive list, keyed by position. The value at each slot is an
 * accessor; changing it updates in place without moving or rebuilding rows.
 *
 *   <Index each={cells}>{(value, i) => <input value={value()} />}</Index>
 */
export function Index<T>(props: {
  each: readonly T[] | Accessor<readonly T[]>;
  children: (value: Accessor<T>, index: number) => Child;
}): Accessor<Child> {
  const list = toAccessor(props.each) as Accessor<readonly T[]>;
  return createMemo(indexArray<T, Child>(list, props.children)) as Accessor<Child>;
}
