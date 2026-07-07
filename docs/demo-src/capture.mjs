/**
 * Records docs/demo.gif from the live demo page (docs/demo-src/, served by
 * `vite --config docs/demo-src/vite.config.ts` on :5184).
 *
 * It walks a frame table, screenshots each `?count=&flash=` state with headless
 * Chromium, then encodes the PNGs into an animated GIF with gifenc — no ffmpeg
 * required. This is the reproducible source-of-truth for the README animation,
 * the same role docs/demo.tape plays for ataegina-cli.
 *
 *   node docs/demo-src/capture.mjs
 *
 * Deps: gifenc, pngjs (dev-only; install if missing). Chromium on PATH.
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
const W = 760;
const H = 430;
const DELAY = 90; // ms per frame

// Frame table: hold on each value, flash-decay on each change. Loops cleanly.
const FLASH = [0.5, 0.34, 0.2, 0.1, 0.03];
const frames = [];
const hold = (count, n) => {
  for (let i = 0; i < n; i++) frames.push({ count, flash: 0 });
};
const change = (count) => {
  for (const flash of FLASH) frames.push({ count, flash });
  hold(count, 4);
};
hold(0, 5);
change(1);
change(2);
change(3);
hold(3, 4);

mkdirSync(framesDir, { recursive: true });

// Pass 1: screenshot every frame and keep its RGBA buffer.
const buffers = [];
let dims = null;
for (let i = 0; i < frames.length; i++) {
  const { count, flash } = frames[i];
  const file = resolve(framesDir, `f${String(i).padStart(3, "0")}.png`);
  const url = `${URL_BASE}?count=${count}&flash=${flash}`;
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
      url,
    ],
    { stdio: "ignore" },
  );
  const png = PNG.sync.read(readFileSync(file));
  dims ??= { width: png.width, height: png.height };
  buffers.push(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length));
  process.stdout.write(`\rshoot ${i + 1}/${frames.length}`);
}

// One global palette for the whole clip (this content has few colors), sampled
// from a no-flash frame and a peak-flash frame so the greens are represented.
const sample = new Uint8Array(buffers[0].length + buffers[5].length);
sample.set(buffers[0], 0);
sample.set(buffers[5], buffers[0].length);
const palette = quantize(sample, 64);

// Collapse runs of identical frames into one frame with a longer delay — the
// long "hold" states are pixel-identical, so this is lossless but much smaller.
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const merged = [];
for (const buf of buffers) {
  const last = merged[merged.length - 1];
  if (last && equal(last.buf, buf)) last.delay += DELAY;
  else merged.push({ buf, delay: DELAY });
}

// Pass 2: encode. Palette is written once (global table); frames reference it.
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
