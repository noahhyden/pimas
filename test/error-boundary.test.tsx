import { describe, it, expect } from "vitest";
import {
  createSignal,
  createEffect,
  createMemo,
  catchError,
  onCleanup,
  createRoot,
} from "pimas";

describe("catchError (reactive core)", () => {
  it("(1) catches a synchronous throw in tryFn and returns undefined", () => {
    let caught: unknown;
    const result = catchError(
      () => {
        throw new Error("boom");
      },
      (err) => {
        caught = err;
      },
    );
    expect(result).toBeUndefined();
    expect((caught as Error).message).toBe("boom");
  });

  it("(2) returns the value when tryFn does not throw", () => {
    let caught = false;
    const result = catchError(
      () => 42,
      () => {
        caught = true;
      },
    );
    expect(result).toBe(42);
    expect(caught).toBe(false);
  });

  it("(3) catches a throw in an effect re-run created inside catchError", () => {
    createRoot(() => {
      const [n, setN] = createSignal(0);
      let caught: unknown;
      catchError(
        () => {
          createEffect(() => {
            if (n() === 1) throw new Error("effect boom");
          });
        },
        (err) => {
          caught = err;
        },
      );
      expect(caught).toBeUndefined(); // initial run n=0 is fine
      setN(1); // re-run throws
      expect((caught as Error).message).toBe("effect boom");
    });
  });

  it("(4) catches a throw in a memo recompute created inside catchError", () => {
    createRoot(() => {
      const [n, setN] = createSignal(0);
      let caught: unknown;
      let mem!: () => number;
      catchError(
        () => {
          mem = createMemo(() => {
            if (n() === 1) throw new Error("memo boom");
            return n();
          });
          // drive the memo via an effect so recompute happens on write
          createEffect(() => mem());
        },
        (err) => {
          caught = err;
        },
      );
      expect(caught).toBeUndefined();
      setN(1);
      expect((caught as Error).message).toBe("memo boom");
    });
  });

  it("(5) nested boundaries: inner catches; when inner rethrows, outer catches", () => {
    // inner catches (does not rethrow)
    {
      let inner: unknown;
      let outer: unknown;
      catchError(
        () => {
          catchError(
            () => {
              throw new Error("x");
            },
            (e) => {
              inner = e;
            },
          );
        },
        (e) => {
          outer = e;
        },
      );
      expect((inner as Error).message).toBe("x");
      expect(outer).toBeUndefined();
    }
    // inner rethrows → outer catches (owner walk, not self-catch)
    {
      let outer: unknown;
      catchError(
        () => {
          catchError(
            () => {
              throw new Error("y");
            },
            (e) => {
              throw e; // rethrow
            },
          );
        },
        (e) => {
          outer = e;
        },
      );
      expect((outer as Error).message).toBe("y");
    }
  });

  it("(6) with no boundary, the error propagates out", () => {
    expect(() => {
      createEffect(() => {
        throw new Error("uncaught");
      });
    }).toThrow("uncaught");
  });

  it("(7) onCleanup of a crashed subtree fires before rebuild", () => {
    createRoot(() => {
      const [n, setN] = createSignal(0);
      const order: string[] = [];
      catchError(
        () => {
          createEffect(() => {
            onCleanup(() => order.push("cleanup"));
            if (n() === 1) throw new Error("boom");
          });
        },
        () => {
          order.push("handler");
        },
      );
      expect(order).toEqual([]); // initial run, no cleanup yet
      setN(1); // re-run: cleanup fires, then it throws, then handler
      expect(order).toEqual(["cleanup", "handler"]);
    });
  });

  it("(8) throw undefined is caught and passed through as-is at the core level", () => {
    let called = false;
    let received: unknown = "sentinel";
    catchError(
      () => {
        throw undefined;
      },
      (err) => {
        called = true;
        received = err;
      },
    );
    expect(called).toBe(true);
    expect(received).toBeUndefined();
  });

  it("(9) NOT caught: a throw inside an event-handler-style callback escapes", () => {
    // catchError only guards synchronous tryFn and reactive re-runs it owns.
    // A callback invoked later (e.g. a DOM event handler) runs outside that
    // scope, so its throw is NOT routed to the boundary — it escapes.
    let handler!: () => void;
    catchError(
      () => {
        handler = () => {
          throw new Error("event boom");
        };
      },
      () => {
        throw new Error("should not be called");
      },
    );
    expect(() => handler()).toThrow("event boom");
  });
});
