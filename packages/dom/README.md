# @pimas/dom

The DOM renderer and JSX runtime for [Pimas](../../README.md). Turns the
reactive core into real DOM: JSX creates DOM nodes **once**, and each dynamic
attribute/child is wrapped in an effect from
[`@pimas/reactive`](../reactive), so only that node updates when a signal
changes. No virtual DOM, no diffing.

> **Status: Phase 2, in progress.** This is currently a stub. The dependency
> direction is fixed: `@pimas/dom` → `@pimas/reactive`, never the reverse.
