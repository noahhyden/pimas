/**
 * onMount in a REAL browser — the things happy-dom can't honestly answer:
 * genuine post-insertion timing (the node is really connected) and REAL focus
 * (document.activeElement actually moves). onMount defers past the synchronous
 * build+insert via a microtask, so each test awaits a microtask turn.
 */
import { onMount } from "pimas/dom";
import { test, expect, mount } from "../runner";

test("onMount fires after the node is really in the document", async () => {
  let connectedAtMount: boolean | null = null;
  const m = mount(() => {
    let el!: HTMLDivElement;
    onMount(() => {
      connectedAtMount = el.isConnected;
    });
    return <div ref={(n: HTMLDivElement) => (el = n)}>x</div>;
  });
  await Promise.resolve(); // flush the mount microtask
  expect(connectedAtMount).toBe(true);
  m.dispose();
});

test("onMount + ref moves real focus to an input", async () => {
  const m = mount(() => {
    let el!: HTMLInputElement;
    onMount(() => el.focus());
    return <input ref={(n: HTMLInputElement) => (el = n)} />;
  });
  await Promise.resolve();
  expect(document.activeElement).toBe(m.container.querySelector("input"));
  m.dispose();
});

test("onMount runs exactly once", async () => {
  let calls = 0;
  const m = mount(() => {
    onMount(() => {
      calls++;
    });
    return <p>hi</p>;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toBe(1);
  m.dispose();
});
