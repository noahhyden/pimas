/**
 * Headless browser-suite runner for CI (issue #20).
 *
 * The browser-test/ suite proves things a simulated DOM (happy-dom/vitest) can't
 * honestly answer — real layout, focus, SVG geometry, trusted events, live form
 * state, real async timing. It normally runs interactively (Vite + a real browser
 * via WebBridge). This drives it UNATTENDED so it can gate PRs:
 *
 *   1. serve browser-test/ with Vite's Node API,
 *   2. launch headless Chromium at that URL with remote debugging,
 *   3. over the DevTools Protocol (CDP), poll `window.__PIMAS_TEST_RESULTS__`,
 *   4. exit non-zero if any test failed.
 *
 * Zero new dependencies: Vite is already a devDependency; `fetch` and `WebSocket`
 * are Node 24 globals, so the CDP client is hand-rolled (no puppeteer/playwright).
 * Chromium binary: $CHROMIUM_BIN, else the first of the usual names on PATH
 * (google-chrome-stable is preinstalled on GitHub's ubuntu runners; /snap/bin/
 * chromium locally).
 */
import { spawn, execSync } from "node:child_process";
import { createServer } from "vite";

const DEBUG_PORT = 9223;
const TIMEOUT_MS = 60_000;

function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  const candidates = [
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "/snap/bin/chromium",
  ];
  for (const c of candidates) {
    try {
      const p = execSync(`command -v ${c} || true`, { encoding: "utf8" }).trim();
      if (p) return p;
    } catch {
      /* keep looking */
    }
  }
  throw new Error("no chromium/chrome binary found (set CHROMIUM_BIN)");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over one WebSocket: correlate responses by message id. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("CDP socket error")), { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return { send, close: () => ws.close() };
}

async function main() {
  const chromium = findChromium();
  console.log(`browser-ci: chromium = ${chromium}`);

  const server = await createServer({ configFile: "vite.config.ts" });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("vite did not report a local URL");
  console.log(`browser-ci: serving ${url}`);

  const child = spawn(
    chromium,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${DEBUG_PORT}`,
      url,
    ],
    { stdio: "ignore" },
  );

  let exitCode = 1;
  try {
    // Wait for the DevTools endpoint, then find the page target's socket.
    let wsUrl = null;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !wsUrl) {
      try {
        const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json());
        wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
      } catch {
        /* not up yet */
      }
      if (!wsUrl) await sleep(200);
    }
    if (!wsUrl) throw new Error("could not reach Chromium DevTools endpoint");

    const { send, close } = await cdp(wsUrl);
    await send("Runtime.enable");

    // Poll until the in-page runner publishes results (async tests included).
    const evalDeadline = Date.now() + TIMEOUT_MS;
    let summary = null;
    while (Date.now() < evalDeadline && !summary) {
      const { result } = await send("Runtime.evaluate", {
        expression: "JSON.stringify(window.__PIMAS_TEST_RESULTS__ || null)",
        returnByValue: true,
      });
      const val = result?.value;
      if (val && val !== "null") summary = JSON.parse(val);
      else await sleep(250);
    }
    close();

    if (!summary) throw new Error(`no test results after ${TIMEOUT_MS}ms`);

    for (const r of summary.results) {
      console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `\n      ${r.error}`}`);
    }
    console.log(`\nbrowser-ci: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`);
    exitCode = summary.failed === 0 ? 0 : 1;
  } finally {
    child.kill("SIGKILL");
    await server.close();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("browser-ci: FAILED —", err.message);
  process.exit(1);
});
