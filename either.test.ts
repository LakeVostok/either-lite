import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { type AsyncEither, type Either, fromPromise, left, right } from "./either";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

type Chain<LeftValue, RightValue> = AsyncEither<LeftValue, RightValue>;

describe("Either core (neverthrow Left/Right)", () => {
  it("creates Left and Right holding exact payloads", () => {
    const ok = right<string, number>(42);
    const err = left<string, number>("boom");

    expect(ok.isRight()).toBe(true);
    expect(ok.isLeft()).toBe(false);
    expect(err.isLeft()).toBe(true);
    expect(err.isRight()).toBe(false);
    expect(ok.value).toBe(42);
    expect(err.value).toBe("boom");
  });

  it.each([[0], [""], [false], [null], [undefined], [NaN]])(
    "treats falsy payload %s as real data",
    (value) => {
      const onRight = vi.fn();
      const onLeft = vi.fn();

      right(value).right(onRight);
      left(value).left(onLeft);

      expect(onRight).toHaveBeenCalledWith(value);
      expect(onLeft).toHaveBeenCalledWith(value);
    },
  );

  it(".right()/.left() run synchronously, only on their side, and return the same instance", () => {
    const order: string[] = [];
    const either = right<string, number>(1);

    expect(either.right(() => order.push("handler"))).toBe(either);
    order.push("after");
    const onLeft = vi.fn();
    expect(either.left(onLeft)).toBe(either);

    expect(order).toEqual(["handler", "after"]);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("narrows through the isRight()/isLeft() guards", () => {
    const either: Either<string, number> = right(2);

    if (either.isRight()) {
      expectTypeOf(either.value).toEqualTypeOf<number>();
      expect(either.value).toBe(2);
    } else {
      expectTypeOf(either.value).toEqualTypeOf<string>();
    }
  });
});

describe("AsyncEither construction", () => {
  it("wraps an existing promise of Either", async () => {
    const promise = Promise.resolve(right<string, number>(2));
    const chain = fromPromise(() => promise);
    const settled = await chain;

    expect(settled.isRight()).toBe(true);
    expect(settled.value).toBe(2);
  });

  it("fromPromise unwraps a resolved Right", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, number>(2)));
    const settled = await chain;

    expect(settled.isRight()).toBe(true);
    expect(settled.value).toBe(2);
  });

  it("fromPromise unwraps a resolved Left without calling right handlers", async () => {
    const chain = fromPromise(() => Promise.resolve(left<string, number>("bad")));
    const settled = await chain;

    expect(settled.isLeft()).toBe(true);
    expect(settled.value).toBe("bad");
  });

  it("a rejecting source rejects the chain, keeping the reason verbatim", async () => {
    const chain = fromPromise(() => Promise.reject<Either<string, number>>("bad"));
    await expect(Promise.resolve(chain)).rejects.toBe("bad");
  });

  it("a synchronously throwing thunk propagates to the caller", () => {
    expect(() =>
      fromPromise(() => {
        throw new Error("sync failure");
      }),
    ).toThrow("sync failure");
  });
});

describe("consumption", () => {
  it(".right()/.left() observe only the settled side", async () => {
    const onRight = vi.fn();
    const onLeft = vi.fn();

    fromPromise(() => Promise.resolve(right<string, number>(1))).right(onRight).left(onLeft);

    await tick();
    expect(onRight).toHaveBeenCalledWith(1);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("awaits to the settled Either through PromiseLike", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, number>(4)));
    const settled: Either<string, number> = await chain;

    expect(settled.value).toBe(4);
  });
});

describe("asyncRight", () => {
  it("applies the handler to Right and flattens the returned Either", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, number>(2))).asyncRight(
      (value) => right<string, number>(value * 10),
    );
    const settled = await chain;

    expect(settled.isRight()).toBe(true);
    expect(settled.value).toBe(20);
  });

  it("passes Left through without calling the handler", async () => {
    const onRight = vi.fn((value: number) => right<string, number>(value));
    const chain = fromPromise(() => Promise.resolve(left<string, number>("bad"))).asyncRight(
      onRight,
    );
    const settled = await chain;

    expect(onRight).not.toHaveBeenCalled();
    expect(settled.isLeft()).toBe(true);
    expect(settled.value).toBe("bad");
  });

  it("flattens a promise of Either returned by the handler", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, number>(1))).asyncRight(
      async (value) => right<string, number>(value + 1),
    );

    expect((await chain).value).toBe(2);
  });

  it("flattens an AsyncEither returned by the handler", async () => {
    const inner = fromPromise(() => Promise.resolve(right<string, number>(5)));
    const chain = fromPromise(() => Promise.resolve(right<string, number>(1))).asyncRight(
      () => inner,
    );

    expect((await chain).value).toBe(5);
  });

  it("widens the left type when the handler can fail", async () => {
    const chain = fromPromise(() => Promise.resolve(right<"base", number>(0))).asyncRight(
      (value) => (value === 0 ? left("zero") : right<"base", number>(10 / value)),
    );

    expectTypeOf(chain).toEqualTypeOf<Chain<"base" | "zero", number>>();

    const settled = await chain;
    expect(settled.isLeft()).toBe(true);
    expect(settled.value).toBe("zero");
  });

  it("runs chained steps in order", async () => {
    const order: string[] = [];
    const settled = await fromPromise(() => Promise.resolve(right<string, number>(1)))
      .asyncRight(async (value) => {
        order.push(`first:${value}`);
        return right<string, number>(value + 1);
      })
      .asyncRight(async (value) => {
        order.push(`second:${value}`);
        return right<string, number>(value + 1);
      });

    expect(order).toEqual(["first:1", "second:2"]);
    expect(settled.value).toBe(3);
  });

  it("rejects the chain when the handler throws instead of returning a step", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, number>(1))).asyncRight(() => {
      throw new Error("boom");
    });

    await expect(Promise.resolve(chain)).rejects.toThrow("boom");
  });
});

describe("asyncLeft", () => {
  it("recovers Left through the handler", async () => {
    const chain = fromPromise(() => Promise.resolve(left<string, number>("bad"))).asyncLeft(
      (error) => right<never, number>(error.length),
    );
    const settled = await chain;

    expect(settled.isRight()).toBe(true);
    expect(settled.value).toBe(3);
  });

  it("passes Right through without calling the handler", async () => {
    const onLeft = vi.fn((error: string) => right<never, number>(error.length));
    const settled = await fromPromise(() =>
      Promise.resolve(right<string, number>(7)),
    ).asyncLeft(onLeft);

    expect(onLeft).not.toHaveBeenCalled();
    expect(settled.isRight()).toBe(true);
    expect(settled.value).toBe(7);
  });

  it("widens the right type when recovery produces a new value", async () => {
    const chain = fromPromise(() => Promise.resolve(left<string, number>("bad"))).asyncLeft(
      (error) => right<never, number>(error.length),
    );

    expectTypeOf(chain).toEqualTypeOf<Chain<never, number>>();
    expect((await chain).value).toBe(3);
  });

  it("can return a new Left and stay on the left side", async () => {
    const settled = await fromPromise(() => Promise.resolve(left<string, number>("bad"))).asyncLeft(
      (error) => left<string, number>(error + "!"),
    );

    expect(settled.isLeft()).toBe(true);
    expect(settled.value).toBe("bad!");
  });
});

describe("chaining", () => {
  it("mixes asyncRight and asyncLeft until a value settles", async () => {
    const settled = await fromPromise(() => Promise.resolve(right<string, number>(1)))
      .asyncRight((value) =>
        value > 0 ? right<string, number>(value + 1) : left("not positive"),
      )
      .asyncLeft((error) => right<never, number>(error.length))
      .asyncRight((value) => right<never, string>(`final:${value}`));

    expect(settled.isRight()).toBe(true);
    expect(settled.value).toBe("final:2");
  });
});

describe("payload identity", () => {
  it("passes stored objects by identity, not by copy", () => {
    const payload = { id: 1 };
    let received: unknown;
    right(payload).right((value) => {
      received = value;
    });
    expect(received).toBe(payload);
  });

  it("allows an Either as a value (no unwrap at this layer)", () => {
    const inner = right(1);
    const outer = right(inner);
    expect(outer.isRight()).toBe(true);
    expect(outer.value).toBe(inner);
  });
});

describe("fromPromise contracts", () => {
  it("invokes the thunk once and unwraps the resolved Either", async () => {
    const cell = right<string, number>(7);
    const factory = vi.fn(() => Promise.resolve(cell));
    const chain = fromPromise(factory);
    expectTypeOf(chain).toEqualTypeOf<Chain<string, number>>();
    expect(factory).toHaveBeenCalledTimes(1);
    expect((await chain).value).toBe(7);
    expect(await chain).toBe(cell);
  });

  it("schedules asyncRight handlers asynchronously even for an already-resolved thunk", async () => {
    const onRight = vi.fn((value: number) => right<string, number>(value));
    fromPromise(() => Promise.resolve(right<string, number>(1))).asyncRight(onRight);
    expect(onRight).not.toHaveBeenCalled();
    await tick();
    expect(onRight).toHaveBeenCalledWith(1);
  });
});

describe("chain derivation and fan-out", () => {
  it("asyncRight/asyncLeft return new chains that settle to an equal Either", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, number>(1)));
    const chainedRight = chain.asyncRight((value) => right<string, number>(value));
    const chainedLeft = chain.asyncLeft((error) => left<string, number>(error));
    expect(chainedRight).not.toBe(chain);
    expect(chainedLeft).not.toBe(chain);
    expect((await chainedRight).value).toBe(1);
    expect((await chainedLeft).value).toBe(1);
  });

  it("fans taps out to multiple handlers in registration order", async () => {
    const calls: string[] = [];
    const chain = fromPromise(() => Promise.resolve(right<string, string>("v")));
    chain.right(() => calls.push("r1"));
    chain.left(() => calls.push("l1"));
    chain.right(() => calls.push("r2"));
    await chain;
    await tick();
    expect(calls).toEqual(["r1", "r2"]);
  });

  it("fires handlers registered after settlement", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, number>(1)));
    await chain;
    await tick();
    const onRight = vi.fn();
    chain.right(onRight);
    const onStep = vi.fn((value: number) => right<string, number>(value));
    chain.asyncRight(onStep);
    await tick();
    expect(onRight).toHaveBeenCalledWith(1);
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it("keeps derived chains independent of the source and of each other", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, string>("ab")));
    const first = chain.asyncRight((text) => right<string, number>(text.length));
    const second = chain.asyncRight((text) => right<string, number>(text.length * 10));
    expect((await first).value).toBe(2);
    expect((await second).value).toBe(20);
    expect((await chain).value).toBe("ab");
  });
});

describe("mid-chain short-circuit", () => {
  it("a Left produced mid-chain skips the remaining right handlers", async () => {
    const onRight = vi.fn((value: number) => right<string, number>(value));
    const chained = fromPromise(() => Promise.resolve(right<string, string>("a")))
      .asyncRight((text) =>
        text.length > 2 ? right<string, number>(text.length) : left<string, number>("too-short"),
      )
      .asyncRight(onRight);
    await tick();
    expect(onRight).not.toHaveBeenCalled();
    const settled = await chained;
    expect(settled.isLeft()).toBe(true);
    if (settled.isLeft()) {
      expect(settled.value).toBe("too-short");
    }
  });

  it("rejects the chain when a step promise rejects", async () => {
    const chain = fromPromise(() => Promise.resolve(right<string, number>(1))).asyncRight(() =>
      Promise.reject<Either<string, number>>(new Error("step boom")),
    );
    await expect(Promise.resolve(chain)).rejects.toThrow("step boom");
  });
});

describe("PromiseLike interop", () => {
  it("then receives the settled Either; onRejected is not called for a settled source", async () => {
    const onFulfilled = vi.fn();
    const onRejected = vi.fn();
    await fromPromise(() => Promise.resolve(left<string, number>("x"))).then(
      onFulfilled,
      onRejected,
    );
    expect(onFulfilled).toHaveBeenCalledTimes(1);
    expect((onFulfilled.mock.calls[0]![0] as Either<string, number>).isLeft()).toBe(true);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("is adopted by Promise.resolve and Promise.all", async () => {
    const adopted = await Promise.resolve(
      fromPromise(() => Promise.resolve(right<string, number>(1))),
    );
    expect(adopted.isRight()).toBe(true);
    expect(adopted.value).toBe(1);

    const [ok, bad] = await Promise.all([
      fromPromise(() => Promise.resolve(right<string, number>(1))),
      fromPromise(() => Promise.resolve(left<string, number>("e"))),
    ]);
    expect(ok.isRight()).toBe(true);
    expect(bad.isLeft()).toBe(true);
  });
});

describe("sync taps on a chain", () => {
  it("ignores what a tap returns (pure reaction, no unwrap)", async () => {
    const settled = await fromPromise(() => Promise.resolve(right<string, number>(2))).right(() =>
      right<string, number>(999),
    );
    expect(settled.isRight()).toBe(true);
    expect(settled.value).toBe(2);
  });
});

describe("fail-loud handler contract", () => {
  const eitherNewUrl = pathToFileURL(join(process.cwd(), "either.ts")).href;

  const runScript = (script: string): { status: number | null; stdout: string; stderr: string } => {
    try {
      const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const failure = error as { status: number | null; stdout?: string; stderr?: string };
      return { status: failure.status, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    }
  };

  it("a throwing asyncRight handler crashes the process; other chains are unaffected", () => {
    const script = `
      const { fromPromise, right } = await import(${JSON.stringify(eitherNewUrl)});
      fromPromise(() => Promise.resolve(right(1)))
        .asyncRight(() => { throw new Error('handler boom'); })
        .asyncLeft(() => console.log('asyncLeft ran'));
      fromPromise(() => Promise.resolve(right(2))).asyncRight(() => console.log('isolated handler ran'));
      setTimeout(() => console.log('still alive'), 100);
    `;
    const { status, stdout, stderr } = runScript(script);
    expect(status).not.toBe(0);
    expect(stderr).toContain("handler boom");
    expect(stdout).toContain("isolated handler ran");
    expect(stdout).not.toContain("asyncLeft ran");
    expect(stdout).not.toContain("still alive");
  });

  it("a throwing sync tap crashes the process; other chains are unaffected", () => {
    const script = `
      const { fromPromise, right } = await import(${JSON.stringify(eitherNewUrl)});
      fromPromise(() => Promise.resolve(right(1)))
        .right(() => { throw new Error('tap boom'); })
        .left(() => console.log('left ran'));
      fromPromise(() => Promise.resolve(right(2))).right(() => console.log('isolated tap ran'));
      setTimeout(() => console.log('still alive'), 100);
    `;
    const { status, stdout, stderr } = runScript(script);
    expect(status).not.toBe(0);
    expect(stderr).toContain("tap boom");
    expect(stdout).toContain("isolated tap ran");
    expect(stdout).not.toContain("left ran");
    expect(stdout).not.toContain("still alive");
  });
});

describe("type-level contracts", () => {
  it("exposes literal-preserving factory typings and guard narrowing", () => {
    expectTypeOf(right(7)).toEqualTypeOf<Either<never, number>>();
    expectTypeOf(left("e")).toEqualTypeOf<Either<"e", never>>();
    expectTypeOf(left<string>("e")).toEqualTypeOf<Either<string, never>>();
    expectTypeOf(right<string, number>(1).value).toEqualTypeOf<string | number>();
    expectTypeOf(left<string, number>("e").value).toEqualTypeOf<string | number>();

    const either: Either<string, number> = right(2) as Either<string, number>;
    if (either.isRight()) expectTypeOf(either.value).toEqualTypeOf<number>();
    if (either.isLeft()) expectTypeOf(either.value).toEqualTypeOf<string>();
  });

  it("types fromPromise inference and handler params", async () => {
    const source = fromPromise(() => Promise.resolve(right<string, number>(1)));
    expectTypeOf(source).toEqualTypeOf<Chain<string, number>>();

    source.asyncRight((value) => {
      expectTypeOf(value).toEqualTypeOf<number>();
      return right<string, string>("x");
    });
    source.asyncLeft((value) => {
      expectTypeOf(value).toEqualTypeOf<string>();
      return left<string, number>("still-bad");
    });

    const either = await source;
    expectTypeOf(either).toEqualTypeOf<Either<string, number>>();
  });
});

describe("sample flows", () => {
  type Product = { name: string; category: string; previewLink: string };
  type RelatedProducts = Array<Product>;
  const product: Product = { name: "n", category: "c", previewLink: "l" };

  const fetchProduct = (): Promise<Either<string, Product>> =>
    Promise.resolve(right<string, Product>(product));
  const fetchRelatedProducts = (_categoryId: string): Promise<Either<string, RelatedProducts>> =>
    Promise.resolve(right<string, RelatedProducts>([product]));

  it("loadData1: asyncRight reaction followed by a sync right tap", async () => {
    const rendered: Product[] = [];
    const chain = fromPromise(fetchProduct)
      .asyncRight((loaded) => {
        rendered.push(loaded);
        return right<string, Product>(loaded);
      })
      .right(() => {
        rendered.push(product);
      });
    await chain;
    expect(rendered).toEqual([product, product]);
  });

  it("loadData2: Either-returning steps feed the next handler", async () => {
    const rendered: Product[] = [];
    const seen: unknown[] = [];
    const chain = fromPromise(fetchProduct)
      .asyncRight((loaded) => fetchRelatedProducts(loaded.category))
      .asyncRight((products) => {
        products.forEach((item) => rendered.push(item));
        return right<string, string>("some-data");
      });
    chain
      .right((data) => {
        seen.push(data);
      })
      .left(() => {
        seen.push("left!");
      });
    await chain;
    expect(rendered).toEqual([product]);
    expect(seen).toEqual(["some-data"]);
  });

  it("loadData2 with a failing step: the sync left tap intercepts the Left", async () => {
    const seen: string[] = [];
    const failing = (_categoryId: string): Promise<Either<string, RelatedProducts>> =>
      Promise.resolve(left<string, RelatedProducts>("related-failed"));
    await fromPromise(fetchProduct)
      .asyncRight((loaded) => failing(loaded.category))
      .asyncRight((products) => {
        products.forEach(() => seen.push("rendered"));
        return right<string, string>("data");
      })
      .right(() => seen.push("right"))
      .left((error) => seen.push(error));
    expect(seen).toEqual(["related-failed"]);
  });

  it("loadData3: asyncLeft reaction followed by an asyncRight transform", async () => {
    const errors: string[] = [];
    const settled = await fromPromise(fetchProduct)
      .asyncLeft((error) => {
        errors.push(error);
        return left<string, Product>(error);
      })
      .asyncRight((loaded) => fetchRelatedProducts(loaded.category));
    expect(errors).toEqual([]);
    expect(settled.isRight()).toBe(true);
    if (settled.isRight()) {
      expect(settled.value).toEqual([product]);
    }
  });
});
