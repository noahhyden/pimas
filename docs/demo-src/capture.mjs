/**
 * Records docs/demo.gif from the live demo page (docs/demo-src/, served by
 * `vite --config docs/demo-src/vite.config.ts` on :5184).
 *
 * The page renders a full, deterministic frame for any `?f=<n>`; this script
 * screenshots f = 0 … FRAME_COUNT-1 with headless Chromium, merges identical
 * consecutive frames (lossless), and encodes them into an animated GIF with
 * gifenc — no ffmpeg. It is the reproducible source-of-truth for the README
 * animation, the same role docs/demo.tape plays for ataegina-cli.
 *
 *   node docs/demo-src/capture.mjs
 *
 * Deps: gifenc, pngjs (devDependencies). Chromium on PATH (or set CHROMIUM).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import { PNG } from "pngjs";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const here = dirname(fileURLToPath(import.meta.url));
const framesDir = resolve(here, ".frames");
const outGif = resolve(here, "..", "demo.gif");

const URL_BASE = "http://localhost:5184/";
const CHROMIUM = process.env.CHROMIUM || "chromium";
const W = 1120;
const H = 600;
const DELAY = 150; // ms per raw frame (merged holds accumulate)

// Must match the timeline in demo.ts: intro(2) + EVENTS(6) * [flash(3)+settle(2)] + outro(3).
const FRAME_COUNT = 2 + 6 * (3 + 2) + 3; // = 35

mkdirSync(framesDir, { recursive: true });

// Pass 1: screenshot every frame, keep its RGBA buffer.
const buffers = [];
let dims = null;
for (let i = 0; i < FRAME_COUNT; i++) {
  const file = resolve(framesDir, `f${String(i).padStart(3, "0")}.png`);
  execFileSync(
    CHROMIUM,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${W},${H}`,
      "--default-background-color=0b0b0dff",
      `--screenshot=${file}`,
      `${URL_BASE}?f=${i}`,
    ],
    { stdio: "ignore" },
  );
  const png = PNG.sync.read(readFileSync(file));
  dims ??= { width: png.width, height: png.height };
  buffers.push(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length));
  process.stdout.write(`\rshoot ${i + 1}/${FRAME_COUNT}`);
}

// One global palette for the whole clip. Sample a flash frame and a settle
// frame so both accent colors and the base UI are represented.
const s1 = buffers[3]; // first flash of event 0
const s2 = buffers[buffers.length - 1]; // final settle
const sample = new Uint8Array(s1.length + s2.length);
sample.set(s1, 0);
sample.set(s2, s1.length);
const palette = quantize(sample, 64);

// Merge runs of identical frames into one frame with a longer delay (lossless).
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const merged = [];
for (const buf of buffers) {
  const last = merged[merged.length - 1];
  if (last && equal(last.buf, buf)) last.delay += DELAY;
  else merged.push({ buf, delay: DELAY });
}

// Pass 2: encode. Palette written once (global table); frames reference it.
const gif = GIFEncoder();
for (let i = 0; i < merged.length; i++) {
  const index = applyPalette(merged[i].buf, palette);
  gif.writeFrame(index, dims.width, dims.height, {
    palette: i === 0 ? palette : undefined,
    delay: merged[i].delay,
    repeat: 0, // loop forever
  });
}
gif.finish();
writeFileSync(outGif, gif.bytes());
rmSync(framesDir, { recursive: true, force: true });
console.log(
  `\nwrote ${outGif} (${merged.length} frames after merge, ${dims.width}x${dims.height})`,
);
