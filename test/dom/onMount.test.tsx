import { describe, it, expect, vi } from "vitest";
import { render, onMount } from "pimas/dom";
import { renderToString } from "pimas/server";

describe("onMount — post-insertion lifecycle hook (#10)", () => {
  it("runs after the node is inserted (not during construction)", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    let connectedAtRef: boolean | null = null;
    let connectedAtMount: boolean | null = null;

    render(() => {
      let el!: HTMLInputElement;
      onMount(() => {
        connectedAtMount = el.isConnected;
      });
      return (
        <input
          ref={(n: HTMLInputElement) => {
            el = n;
            connectedAtRef = n.isConnected; // ref fires during construction → detached
          }}
        />
      );
    }, root);

    // ref ran synchronously against a detached node; onMount hasn't fired yet.
    expect(connectedAtRef).toBe(false);
    expect(connectedAtMount).toBe(null);

    await Promise.resolve(); // let the microtask flush
    expect(connectedAtMount).toBe(true);
    root.remove();
  });

  it("runs exactly once", async () => {
    const root = document.createElement("div");
    const spy = vi.fn();
    render(() => {
      onMount(spy);
      return <p>hi</p>;
    }, root);
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("can focus an element once mounted (the ref-timing use case)", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(() => {
      let el!: HTMLInputElement;
      onMount(() => el.focus());
      return <input ref={(n: HTMLInputElement) => (el = n)} />;
    }, root);
    await Promise.resolve();
    expect(document.activeElement).toBe(root.querySelector("input"));
    root.remove();
  });

  it("is a no-op under SSR (run-once, no live nodes)", () => {
    const spy = vi.fn();
    const html = renderToString(() => {
      onMount(spy);
      return <p>server</p>;
    });
    expect(html).toContain("server");
    expect(spy).not.toHaveBeenCalled(); // never scheduled on the string backend
  });
});
