/**
 * The type-tagged codec (#7 / resumability task 6, D#32) — round-trips the values
 * JSON can't carry, powering the resumability capture table + island props.
 */
import { describe, it, expect } from "vitest";
import { encode, decode } from "../src/dom/wire";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const round = (v: unknown): any => decode(encode(v));

describe("wire codec — round-trip", () => {
  it("passes plain JSON data through unchanged (still ordinary JSON)", () => {
    const v = { a: 1, b: "x", c: [true, null, { d: 2 }] };
    expect(encode(v)).toBe(JSON.stringify(v)); // no sentinels → identical to JSON
    expect(round(v)).toEqual(v);
  });

  it("round-trips undefined, NaN, ±Infinity and -0 (with Object.is fidelity)", () => {
    expect(round({ x: NaN }).x).toBeNaN();
    expect(round({ x: Infinity }).x).toBe(Infinity);
    expect(round({ x: -Infinity }).x).toBe(-Infinity);
    expect(Object.is(round({ x: -0 }).x, -0)).toBe(true); // sign preserved
    const arr = round([undefined, 5]) as unknown[];
    expect(arr[0]).toBeUndefined();
    expect(arr[1]).toBe(5);
  });

  it("round-trips bigint, Date, RegExp", () => {
    expect(round({ n: 90071992547409910n }).n).toBe(90071992547409910n);
    const d = round({ t: new Date("2026-07-02T12:00:00.000Z") }).t as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(new Date("2026-07-02T12:00:00.000Z").getTime());
    const r = round({ re: /ab+c/gi }).re as RegExp;
    expect(r).toBeInstanceOf(RegExp);
    expect([r.source, r.flags]).toEqual(["ab+c", "gi"]);
  });

  it("round-trips Map and Set, including nested special values", () => {
    const m = round({ m: new Map<string, unknown>([["a", 1], ["d", new Date(0)]]) }).m as Map<string, unknown>;
    expect(m).toBeInstanceOf(Map);
    expect(m.get("a")).toBe(1);
    expect((m.get("d") as Date).getTime()).toBe(0);
    const s = round({ s: new Set([1, 2, 3]) }).s as Set<number>;
    expect(s).toBeInstanceOf(Set);
    expect([...s]).toEqual([1, 2, 3]);
  });

  it("escapes </script> so it can't break out of the state script", () => {
    const out = encode({ s: "</script><script>alert(1)" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script>");
    expect(round({ s: "</script>" })).toEqual({ s: "</script>" }); // still round-trips
  });

  it("escapes </script> even inside a Map value", () => {
    const out = encode({ m: new Map([["k", "</script>"]]) });
    expect(out).not.toContain("</script>");
  });

  it("drops __proto__ on decode (no prototype pollution)", () => {
    const evil = '{"__proto__":{"polluted":1}}';
    const parsed = decode(evil) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it("throws (server-side, fail loud) on a function", () => {
    expect(() => encode({ fn: () => {} })).toThrow(/cannot serialize a function/);
  });

  it("throws on a user object shaped exactly like a reserved sentinel", () => {
    expect(() => encode({ x: { $: "d", v: "2020" } })).toThrow(/reserved/);
    // ...but a $-keyed object that is NOT sentinel-shaped is fine (extra key)
    expect(round({ x: { $: "d", v: "2020", extra: 1 } })).toEqual({ x: { $: "d", v: "2020", extra: 1 } });
    expect(round({ x: { $: "hello" } })).toEqual({ x: { $: "hello" } }); // unknown tag
  });
});
