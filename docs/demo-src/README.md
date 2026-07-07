# README demo — source

This directory generates [`docs/demo.gif`](../demo.gif), the animation at the top
of the project README. It plays the role `docs/demo.tape` plays in
`ataegina-cli`: the reproducible source-of-truth for the demo, checked in next to
the rendered artifact.

The demo is a **real pimas app** (`demo.ts`), not a mockup — the count is a
signal and the number in the pill is a reactive child, so `setCount` re-runs
exactly that one text node. That is the property the GIF is showing.

## Regenerate

```sh
# 1. serve the demo page from source (aliases pimas → ../../src)
npx vite --config docs/demo-src/vite.config.ts

# 2. in another shell: screenshot each frame and encode the GIF
node docs/demo-src/capture.mjs
```

- `index.html` / `demo.ts` — the app; reads target state from `?count=&flash=`.
- `capture.mjs` — walks a frame table, screenshots each state with headless
  Chromium, and encodes them with `gifenc` (no ffmpeg needed).

Requires Chromium on `PATH` and the `gifenc` / `pngjs` devDependencies. Set
`CHROMIUM=/path/to/chrome` if the binary isn't named `chromium`.
