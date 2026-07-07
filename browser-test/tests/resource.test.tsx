/**
 * createResource (#19) in a REAL browser: an async fetch must drive live DOM text
 * through pending → ready with real microtask timing and a real reactive update to
 * a text node (not just signal reads in a simulated DOM).
 */
import { createResource } from "pimas/resource";
import { test, expect, mount } from "../runner";

const flush = () => new Promise((r) => setTimeout(r, 0));

test("createResource drives live DOM text from pending to the resolved value", async () => {
  let resolve!: (v: string) => void;
  const p = new Promise<string>((r) => (resolve = r));

  const m = mount(() => {
    const [data] = createResource(() => p);
    return <span>{() => (data.loading() ? "loading…" : String(data()))}</span>;
  });
  const span = m.container.querySelector("span")!;

  expect(span.textContent).toBe("loading…"); // pending state rendered

  resolve("done");
  await p;
  await flush(); // resource .then + reactive flush

  expect(span.textContent).toBe("done"); // live text node updated on resolve
  m.dispose();
});

test("createResource surfaces a rejection as error state without throwing", async () => {
  let reject!: (e: unknown) => void;
  const p = new Promise<string>((_, rej) => (reject = rej));

  const m = mount(() => {
    const [data] = createResource(() => p);
    return <span>{() => (data.error() ? "error" : data.loading() ? "loading…" : String(data()))}</span>;
  });
  const span = m.container.querySelector("span")!;

  reject(new Error("nope"));
  await p.catch(() => {});
  await flush();

  expect(span.textContent).toBe("error");
  m.dispose();
});
