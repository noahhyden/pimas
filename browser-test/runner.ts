/**
 * A tiny in-browser test runner. Deliberately framework-free (except `mount`,
 * which uses pimas/dom) so a bug in Pimas can't mask itself in the harness.
 *
 * It collects results, publishes them to `window.__PIMAS_TEST_RESULTS__` as JSON
 * (so Kimi WebBridge can read the verdict via `evaluate()`), and paints a
 * pass/fail list into the page (so a `screenshot()` shows the same thing).
 *
 * This complements — does not replace — the happy-dom vitest suite. It exists
 * only for things a simulated DOM can't honestly answer: real layout, focus
 * across a keyed reorder, SVG geometry, trusted-ish event dispatch, live
 * form-control state. Keep assertions here to those.
 */
import { render } from "pimas/dom";
import type { Child } from "pimas/dom";

export interface TestResult {
  name: string;
  ok: boolean;
  error?: string;
  ms: number;
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

class AssertionError extends Error {}

const fmt = (v: unknown): string =>
  typeof v === "string" ? JSON.stringify(v) : String(v);

export function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (!Object.is(actual, expected))
        throw new AssertionError(`expected ${fmt(expected)}, got ${fmt(actual)}`);
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new AssertionError(`expected ${fmt(expected)}, got ${fmt(actual)}`);
    },
    toBeTruthy() {
      if (!actual) throw new AssertionError(`expected truthy, got ${fmt(actual)}`);
    },
    toBeGreaterThan(n: number) {
      if (!((actual as number) > n))
        throw new AssertionError(`expected > ${n}, got ${fmt(actual)}`);
    },
    toContain(sub: string) {
      if (!String(actual).includes(sub))
        throw new AssertionError(`expected ${fmt(actual)} to contain ${fmt(sub)}`);
    },
  };
}

/**
 * Mount a component into a container that is REALLY attached to the document —
 * required for focus, layout (offsetWidth), and SVG getBBox to be meaningful.
 * Returns a dispose that also detaches the container.
 */
export function mount(code: () => Child): { container: HTMLElement; dispose: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(code, container);
  return {
    container,
    dispose() {
      dispose();
      container.remove();
    },
  };
}

function paint(summary: { total: number; passed: number; failed: number; results: TestResult[] }) {
  const out = document.getElementById("out");
  if (!out) return;
  out.textContent = "";
  const h = document.createElement("h1");
  h.className = summary.failed === 0 ? "pass" : "fail";
  h.textContent = `${summary.passed}/${summary.total} passing${summary.failed ? `  —  ${summary.failed} FAILED` : ""}`;
  out.appendChild(h);
  const ul = document.createElement("ul");
  for (const r of summary.results) {
    const li = document.createElement("li");
    li.className = r.ok ? "pass" : "fail";
    li.textContent = `${r.ok ? "✓" : "✗"} ${r.name}  (${r.ms.toFixed(1)}ms)`;
    ul.appendChild(li);
    if (!r.ok && r.error) {
      const pre = document.createElement("pre");
      pre.textContent = r.error;
      ul.appendChild(pre);
    }
  }
  out.appendChild(ul);
}

export async function run(): Promise<void> {
  const results: TestResult[] = [];
  for (const t of tests) {
    const start = performance.now();
    try {
      await t.fn();
      results.push({ name: t.name, ok: true, ms: performance.now() - start });
    } catch (e) {
      results.push({
        name: t.name,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        ms: performance.now() - start,
      });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const summary = { total: results.length, passed, failed: results.length - passed, results };
  (window as unknown as { __PIMAS_TEST_RESULTS__: typeof summary }).__PIMAS_TEST_RESULTS__ = summary;
  paint(summary);
}
