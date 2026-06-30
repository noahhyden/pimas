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
import { createMemo, type Accessor } from "../reactive/index.js";
import type { Child } from "../dom/engine.js";

type Maybe<T> = T | (() => T);
const evalMaybe = <T>(v: Maybe<T>): T => (typeof v === "function" ? (v as () => T)() : v);

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
