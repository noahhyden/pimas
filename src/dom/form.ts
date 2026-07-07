/**
 * pimas/dom — two-way form binding helpers (issue #23).
 *
 * Controlled inputs in pimas are a `value`/`checked` thunk plus a change handler.
 * These helpers package that pair so you can *spread* it onto a control:
 *
 *   const [text, setText] = createSignal("");
 *   <input {...model(text, setText)} />                       // text / textarea
 *   <input type="checkbox" {...modelChecked(done, setDone)} /> // boolean
 *   <input type="number" {...modelNumber(qty, setQty)} />      // numeric
 *
 * The `value`/`checked` side is a thunk (so the control tracks the signal), and the
 * user's edit is written back on the appropriate event. Pass your signal's getter
 * and setter directly. These live in `pimas/dom` (they read `event.target`) and are
 * tree-shaken away unless imported.
 */
import type { Accessor } from "../reactive/index.js";

/** Bind a string signal to a text `<input>` / `<textarea>` (value ↔ signal). */
export function model(get: Accessor<string>, set: (value: string) => void) {
  return {
    value: () => get(),
    onInput: (e: Event) => set((e.target as HTMLInputElement).value),
  };
}

/** Bind a boolean signal to a checkbox/radio (`checked` ↔ signal). */
export function modelChecked(get: Accessor<boolean>, set: (value: boolean) => void) {
  return {
    checked: () => get(),
    onChange: (e: Event) => set((e.target as HTMLInputElement).checked),
  };
}

/** Bind a number signal to a numeric `<input>` (uses `valueAsNumber`). */
export function modelNumber(get: Accessor<number>, set: (value: number) => void) {
  return {
    value: () => String(get()),
    onInput: (e: Event) => set((e.target as HTMLInputElement).valueAsNumber),
  };
}
