import { describe, it, expect } from "vitest";
import { createSignal } from "pimas";
import { render, model, modelChecked, modelNumber } from "pimas/dom";

describe("form binding helpers (#23)", () => {
  it("model: binds value both ways (signal → input, input → signal)", () => {
    const [text, setText] = createSignal("hi");
    const root = document.createElement("div");
    render(() => <input {...model(text, setText)} />, root);
    const input = root.querySelector("input") as HTMLInputElement;

    expect(input.value).toBe("hi"); // signal → DOM

    setText("bye");
    expect(input.value).toBe("bye"); // reactive update

    input.value = "typed";
    input.dispatchEvent(new Event("input"));
    expect(text()).toBe("typed"); // DOM → signal
  });

  it("modelChecked: binds a boolean to a checkbox", () => {
    const [done, setDone] = createSignal(false);
    const root = document.createElement("div");
    render(() => <input type="checkbox" {...modelChecked(done, setDone)} />, root);
    const box = root.querySelector("input") as HTMLInputElement;

    expect(box.checked).toBe(false);

    setDone(true);
    expect(box.checked).toBe(true); // signal → DOM

    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(done()).toBe(false); // DOM → signal
  });

  it("modelNumber: binds a number via valueAsNumber", () => {
    const [qty, setQty] = createSignal(2);
    const root = document.createElement("div");
    render(() => <input type="number" {...modelNumber(qty, setQty)} />, root);
    const input = root.querySelector("input") as HTMLInputElement;

    expect(input.value).toBe("2");

    input.value = "5";
    input.dispatchEvent(new Event("input"));
    expect(qty()).toBe(5);
    expect(typeof qty()).toBe("number");
  });
});
