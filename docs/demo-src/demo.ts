/**
 * The demo rendered into docs/demo.gif. It is a *real* pimas app — the count
 * value is a signal, and the text inside the pill is a reactive child, so
 * `setCount` re-runs exactly that one text node and nothing else. That is the
 * whole point the GIF is trying to show.
 *
 * For deterministic frame capture the target state is read from the URL:
 *   ?count=<n>&flash=<0..1>
 * The capture script (capture.mjs) walks a frame table and screenshots each
 * state; nothing here is capture-specific beyond reading those two params.
 */
import { render } from "pimas/dom";
import { createSignal } from "pimas";
import { h } from "pimas/dom";

const params = new URLSearchParams(location.search);
const initial = Number(params.get("count") ?? 0);
const flash = Number(params.get("flash") ?? 0);

const [count, setCount] = createSignal(initial);

// The one reactive node. The function child re-runs only when count() changes.
render(
  () =>
    h(
      "div",
      { class: "line" },
      h("span", { class: "static" }, "count is"),
      h("span", { class: "pill" }, () => String(count())),
    ),
  document.getElementById("app")!,
);

// Drive the flash overlay for this frame (presentation only).
document.documentElement.style.setProperty("--flash", String(flash));

// Expose for any interactive poking; also proves setCount is what's driving it.
(globalThis as unknown as { setCount: typeof setCount }).setCount = setCount;
