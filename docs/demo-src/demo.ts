/**
 * The README demo: an "agent" streams run-state updates into the *same* UI
 * rendered two ways, side by side.
 *
 *   React column  — illustrates React DevTools "Highlight updates": on every
 *                   state change the whole subtree re-renders (and a VDOM diff
 *                   runs), so every boundary flashes. "component re-renders"
 *                   climbs by the subtree size each change.
 *   Pimas column  — a REAL pimas app. Each field is a signal and each value is
 *                   a reactive child, so a change re-runs exactly one text node.
 *                   Only that node flashes; "DOM nodes updated" climbs by one.
 *
 * A single frame index drives everything so the GIF is deterministic:
 *   ?f=<n>   selects the frame; the state, counters, and flashes are pure
 *            functions of n. capture.mjs just walks f = 0 … FRAME_COUNT-1.
 */
import { render, h } from "pimas/dom";
import { createSignal, createEffect, batch } from "pimas";

type Field = "status" | "step" | "tokens" | "cost" | "elapsed";
const FIELDS: Field[] = ["status", "step", "tokens", "cost", "elapsed"];

const INITIAL: Record<Field, string> = {
  status: "idle",
  step: "0 / 12",
  tokens: "0",
  cost: "$0.000",
  elapsed: "0.0s",
};

// One field changes per event — keeps "1 node updated" literally true.
const EVENTS: { field: Field; value: string; label: string }[] = [
  { field: "status", value: "running", label: "set status = running" },
  { field: "step", value: "3 / 12", label: "set step = 3 / 12" },
  { field: "tokens", value: "1,240", label: "set tokens = 1,240" },
  { field: "tokens", value: "4,910", label: "set tokens = 4,910" },
  { field: "cost", value: "$0.061", label: "set cost = $0.061" },
  { field: "elapsed", value: "2.4s", label: "set elapsed = 2.4s" },
];

// A naive React subtree of this card re-renders this many component instances
// per state change (Card + 5 Rows). Pimas updates exactly 1 node.
const REACT_NODES_PER_UPDATE = 6;
const REACT_TOTAL = EVENTS.length * REACT_NODES_PER_UPDATE; // meter full-scale

// --- frame plan: intro, then per-event [flash x3, settle x2], then outro ---
const FLASH = [0.95, 0.6, 0.3];
type Frame = { event: number; level: number };
const FRAMES: Frame[] = [];
FRAMES.push({ event: -1, level: 0 }, { event: -1, level: 0 }); // intro
for (let e = 0; e < EVENTS.length; e++) {
  for (const level of FLASH) FRAMES.push({ event: e, level });
  FRAMES.push({ event: e, level: 0 }, { event: e, level: 0 }); // settle
}
FRAMES.push({ event: EVENTS.length - 1, level: 0 }, { event: EVENTS.length - 1, level: 0 }, { event: EVENTS.length - 1, level: 0 }); // outro
export const FRAME_COUNT = FRAMES.length;
(globalThis as unknown as { __FRAME_COUNT: number }).__FRAME_COUNT = FRAME_COUNT;

// State after applying every event up to and including `e` (-1 = initial).
function stateAt(e: number): Record<Field, string> {
  const s = { ...INITIAL };
  for (let i = 0; i <= e; i++) s[EVENTS[i].field] = EVENTS[i].value;
  return s;
}

// ---- Pimas column: a real pimas render ----
const signals = Object.fromEntries(
  FIELDS.map((f) => [f, createSignal(INITIAL[f])]),
) as Record<Field, ReturnType<typeof createSignal<string>>>;

const statusValue = () =>
  h(
    "span",
    { class: "v", "data-pv": "status" },
    h("span", { class: "dot" }),
    h("span", { class: "txt" }, () => signals.status[0]()),
  );

render(
  () =>
    h(
      "div",
      null,
      ...FIELDS.map((f) =>
        h(
          "div",
          { class: "row", "data-f": f },
          h("span", { class: "k" }, f),
          f === "status"
            ? statusValue()
            : h("span", { class: "v", "data-pv": f }, () => signals[f][0]()),
        ),
      ),
    ),
  document.getElementById("pcard")!,
);

// Reactively toggle the status dot on the pimas side (re-runs only on change).
createEffect(() => {
  const el = document.querySelector(".pimas .v[data-pv='status']");
  el?.classList.toggle("on", signals.status[0]() !== "idle");
});

// ---- per-frame paint ----
const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const frameIdx = Math.max(0, Math.min(FRAME_COUNT - 1, Number(new URLSearchParams(location.search).get("f") ?? 0)));
const frame = FRAMES[frameIdx];
const state = stateAt(frame.event);
const applied = frame.event + 1; // events applied so far

// event ticker text
$("#event").textContent = frame.event < 0 ? "run started…" : EVENTS[frame.event].label;

// React column values (plain DOM) + status dot
for (const f of FIELDS) {
  const el = $(`.react .v[data-rv="${f}"]`);
  if (f === "status") {
    el.querySelector(".txt")!.textContent = state.status;
    el.classList.toggle("on", state.status !== "idle");
  } else {
    el.textContent = state[f];
  }
}

// Pimas column values (drive the real signals)
batch(() => {
  for (const f of FIELDS) signals[f][1](state[f]);
});

// counters + meters (shared full-scale = REACT_TOTAL so Pimas reads as tiny)
const rCount = applied * REACT_NODES_PER_UPDATE;
const pCount = applied;
$("#rcount").textContent = String(rCount);
$("#pcount").textContent = String(pCount);
($("#rfill") as HTMLElement).style.width = `${(rCount / REACT_TOTAL) * 100}%`;
($("#pfill") as HTMLElement).style.width = `${(pCount / REACT_TOTAL) * 100}%`;

// highlight
document.documentElement.style.setProperty("--hl", String(frame.level));
document.querySelectorAll(".flash").forEach((e) => e.classList.remove("flash"));
if (frame.level > 0 && frame.event >= 0) {
  // React: every boundary re-rendered
  document.querySelectorAll(".react #rcard, .react .row, .react .v").forEach((e) => e.classList.add("flash"));
  // Pimas: only the one node that read the changed value
  const changed = EVENTS[frame.event].field;
  $(`.pimas .v[data-pv="${changed}"]`)?.classList.add("flash");
}
