# README demo — source

This directory generates [`docs/demo.gif`](../demo.gif), the animation at the top
of the project README. It plays the role `docs/demo.tape` plays in
`ataegina-cli`: the reproducible source-of-truth for the demo, checked in next to
the rendered artifact.

## What the demo shows

An "agent" streams run-state updates (`status`, `step`, `tokens`, …) into the
**same UI rendered two ways**, side by side:

- **React** — illustrates React DevTools' _Highlight updates_: on every state
  change the whole subtree re-renders and a VDOM diff runs, so every boundary
  flashes and "component re-renders" climbs by the subtree size each change.
- **Pimas** — a **real pimas app** (`demo.ts`). Each field is a signal and each
  value is a reactive child, so a change re-runs exactly one text node. Only that
  node flashes; "DOM nodes updated" climbs by one.

The two work-meters share a scale, so Pimas visibly does ~6× less work for the
identical run.

## Regenerate

```sh
# 1. serve the demo page from source (aliases pimas → ../../src)
npx vite --config docs/demo-src/vite.config.ts

# 2. in another shell: screenshot each frame and encode the GIF
node docs/demo-src/capture.mjs
```

- `index.html` — layout + styles for both columns and the meters.
- `demo.ts` — the real pimas column, plus the deterministic per-frame timeline
  (state, counters, and flashes are pure functions of `?f=<n>`).
- `capture.mjs` — walks `f = 0 … FRAME_COUNT-1`, screenshots each state with
  headless Chromium, merges identical hold-frames (lossless), and encodes with
  `gifenc` (no ffmpeg).

Requires Chromium on `PATH` and the `gifenc` / `pngjs` devDependencies. Set
`CHROMIUM=/path/to/chrome` if the binary isn't named `chromium`. If you change
the timeline in `demo.ts`, update `FRAME_COUNT` in `capture.mjs` to match.
