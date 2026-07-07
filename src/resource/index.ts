/**
 * pimas/resource — 🔬 EXPERIMENTAL async data primitive (issue #19).
 *
 * `createResource` turns an async fetch into reactive state: an accessor for the
 * value, plus `loading`/`error`/`state` accessors and `refetch`/`mutate` actions.
 * It's a thin, headless layer over the core — a driving `createEffect` runs the
 * fetcher and writes plain signals; reading the resource subscribes you like any
 * signal. Kept out of the core (its own subpath) so the hot-path floor pays
 * nothing unless you import it.
 *
 * Two forms:
 *   const [data] = createResource(() => fetch(url).then(r => r.json()));
 *   const [user] = createResource(userId, (id) => fetchUser(id)); // refetch when id changes
 *
 * The `source` form only fetches when the source is truthy (non-null/undefined and
 * not `false`) — the idiom for "wait until we have an id". A stale in-flight fetch
 * whose source has since changed is dropped (last-write-wins), so rapid source
 * changes never resolve out of order.
 *
 * There is no Suspense boundary yet; gate UI on `data.loading` with `<Show>` (a
 * `<Suspense>` that coordinates multiple resources is the follow-up in #19). Under
 * SSR (`renderToString`, synchronous) a fetch is kicked off but won't resolve
 * before the string is returned — resources are a client-side concern for now.
 */
import { createSignal, createEffect, untrack, onCleanup, batch, type Accessor } from "../reactive/index.js";

export type ResourceState = "unresolved" | "pending" | "ready" | "refreshing" | "errored";

/** The reactive read side of a resource. Calling it returns the current value (and
 *  subscribes the caller); the extra accessors expose loading/error/state. */
export interface Resource<T> {
  (): T | undefined;
  /** True while a fetch is in flight (initial or refetch). */
  loading: Accessor<boolean>;
  /** The last rejection, or undefined. Reading it re-throws nothing — it's data. */
  error: Accessor<unknown>;
  /** The last resolved value, retained across a refetch (unlike the accessor,
   *  which also reflects it — provided for parity/clarity). */
  latest: Accessor<T | undefined>;
  /** Coarse lifecycle state. */
  state: Accessor<ResourceState>;
}

/** The write side: force a refetch, or set the value locally without fetching. */
export interface ResourceActions<T> {
  refetch: () => void;
  mutate: (value: T) => void;
}

/** Info passed to the fetcher: the previous value, and whether this is a refetch. */
export interface ResourceFetcherInfo<T> {
  value: T | undefined;
  refetching: boolean;
}

export type ResourceFetcher<S, T> = (
  source: S,
  info: ResourceFetcherInfo<T>,
) => Promise<T> | T;

/** No-source form: fetch once (and on `refetch`). */
export function createResource<T>(
  fetcher: ResourceFetcher<true, T>,
): [Resource<T>, ResourceActions<T>];
/** Source form: (re)fetch whenever `source` changes to a truthy value. */
export function createResource<T, S>(
  source: Accessor<S | false | null | undefined>,
  fetcher: ResourceFetcher<S, T>,
): [Resource<T>, ResourceActions<T>];
export function createResource<T, S>(
  first: Accessor<S | false | null | undefined> | ResourceFetcher<true, T>,
  second?: ResourceFetcher<S, T>,
): [Resource<T>, ResourceActions<T>] {
  // Disambiguate the two overloads: (source, fetcher) vs (fetcher).
  const hasSource = typeof second === "function";
  const source = (hasSource ? first : () => true) as Accessor<S | false | null | undefined>;
  const fetcher = (hasSource ? second : first) as ResourceFetcher<S, T>;

  const [value, setValue] = createSignal<T | undefined>(undefined);
  const [error, setError] = createSignal<unknown>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [state, setState] = createSignal<ResourceState>("unresolved");
  const [refetchTick, setRefetchTick] = createSignal(0);

  // Race guard: only the newest request may commit its result.
  let version = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  // The driver. It subscribes to `source` and the refetch trigger ONLY — every
  // read of the resource's own signals is untracked, so writing them back here
  // can't re-trigger the effect (no feedback loop).
  createEffect(() => {
    const s = source();
    refetchTick(); // subscribe to refetch()

    if (s === false || s == null) {
      // Nothing to fetch yet (e.g. id not ready). Reset to unresolved.
      batch(() => {
        setLoading(false);
        setState("unresolved");
      });
      return;
    }

    const requestId = ++version;
    const prev = untrack(value);
    const refetching = untrack(state) !== "unresolved";
    batch(() => {
      setLoading(true);
      setState(prev === undefined ? "pending" : "refreshing");
    });

    const commit = (fn: () => void) => {
      // Drop stale resolutions and anything after teardown.
      if (requestId === version && !disposed) batch(fn);
    };

    let out: Promise<T> | T;
    try {
      out = fetcher(s as S, { value: prev, refetching });
    } catch (err) {
      commit(() => {
        setError(() => err);
        setLoading(false);
        setState("errored");
      });
      return;
    }

    Promise.resolve(out).then(
      (resolved) =>
        commit(() => {
          setValue(() => resolved); // functional form: safe even if T is a function
          setError(() => undefined);
          setLoading(false);
          setState("ready");
        }),
      (err) =>
        commit(() => {
          setError(() => err);
          setLoading(false);
          setState("errored");
        }),
    );
  });

  const resource = (() => value()) as Resource<T>;
  resource.loading = loading;
  resource.error = error;
  resource.latest = value;
  resource.state = state;

  const actions: ResourceActions<T> = {
    refetch: () => setRefetchTick((n) => n + 1),
    mutate: (v: T) =>
      batch(() => {
        setValue(() => v);
        setError(() => undefined);
        setState("ready");
        setLoading(false);
        version++; // invalidate any in-flight fetch so it can't overwrite the mutation
      }),
  };

  return [resource, actions];
}
