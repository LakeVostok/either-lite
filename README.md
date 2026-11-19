# either-lite

Opinionated `Either` implementation with a minimal API and async handlers.

```bash
npm i -SE either-lite
```

## Why

Modern Either/Result libraries like `neverthrow`, `@sweet-monads/either`, `true-myth`, `fp-ts`, `effect` and etc ship rich APIs: `map`, `chain`, `fold`, `match`, applicative combinators, companion monads. It's handy, but most of time you need just unwrap Either instance from promise and continue your chain. That is what this library does!

## The contract

Every step of a flow returns its outcome wrapped in `left()` / `right()`. Exceptions are never used for control flow: `try`/`catch` appears only at boundaries, to convert a foreign throwing API (like `fetch` or `JSON.parse`) into an Either. If a step can fail, it returns `left(...)` — that is a normal, non-exceptional outcome, and the chain carries it downstream.

The library enforces this rather than repairing deviations: `fromPromise` does not catch. A rejecting thunk rejects the chain and `await` throws, so a rejection is a bug that fails loudly — never a silently converted value.

## Table of contents

- [Core concepts](#core-concepts)
- [General example](#general-example)
- [Top-level API](#top-level-api)
- [Creating Eithers](#creating-eithers)
  - [`right(value)`](#rightvalue)
  - [`left(value)`](#leftvalue)
- [Inspecting an Either](#inspecting-an-either)
  - [`isRight()`](#isright)
  - [`isLeft()`](#isleft)
  - [The `value` field](#the-value-field)
- [Reacting to one side](#reacting-to-one-side)
  - [`.right(callback)`](#rightcallback)
  - [`.left(callback)`](#leftcallback)
- [Async chains](#async-chains)
  - [`AsyncEither` overview](#asynceither-overview)
  - [`fromPromise(fn)`](#frompromisefn)
  - [`AsyncEither#asyncRight(callback)`](#asynceitherasyncrightcallback)
  - [`AsyncEither#asyncLeft(callback)`](#asynceitherasyncleftcallback)
  - [Sync taps: `AsyncEither#right(callback)` / `AsyncEither#left(callback)`](#sync-taps-asynceitherrightcallback--asynceitherleftcallback)
  - [`await` and PromiseLike interop](#await-and-promiselike-interop)
- [Behavioral contracts and edge cases](#behavioral-contracts-and-edge-cases)
- [Type-level notes](#type-level-notes)
- [Design goals and non-goals](#design-goals-and-non-goals)

## Core concepts

`Either<LeftValue, RightValue>` is a union of two concrete classes — `Left<LeftValue, RightValue>` and `Right<LeftValue, RightValue>` — both exported. Each holds its payload in a readonly `value` field, so a Right's `value` is `RightValue` and a Left's `value` is `LeftValue`. This is what makes `isRight()` / `isLeft()` real type guards — after a check, TypeScript knows exactly which type `value` holds.

An **async chain** is an `AsyncEither<LeftValue, RightValue>`: a `PromiseLike<Either<LeftValue, RightValue>>` that settles to exactly what its source settles to, created via `fromPromise(fn)` — the only way to build a chain:

- it **settles to exactly what the source settles to** — `fromPromise` captures nothing: a resolved Either becomes the chain's value (the very instance), a rejecting source rejects the chain, and a synchronously throwing thunk throws at the call site. Under the contract none of that happens — your own code returns failures as `Left` and converts foreign throwing APIs at the boundary — so when it does happen, it is a bug failing loudly, never a silently repaired value;
- it is `PromiseLike`, so `await`, `Promise.all`, and async-function returns all work on it;
- its `asyncRight` / `asyncLeft` handlers receive the *unwrapped* value and return the **next step** of the chain: an `Either`, an `AsyncEither`, or a `PromiseLike<Either>` — one level of flattening, exactly like `neverthrow`'s `andThen` / `orElse`. The opposite side is never called and passes through.
- its synchronous `right` / `left` taps observe the settled side without changing what the chain settles to — these are the "reaction" counterparts of the async steps.

## General example

A request to a server can fail in three different places — the network itself, the server's error status, and parsing the response body. `Either` chains compose so that all three failures land in a single typed value:

```ts
import { Either, fromPromise, left, right } from 'either-lite';

// Every failure in the flow is one of these — plain values, not Error instances.
type RequestError =
  | 'network-failed' // connection dropped, DNS failed, offline, …
  | 'invalid-json'   // the body was not valid JSON
  | number;          // the server answered with an error HTTP status

interface User {
  id: string;
  name: string;
}

// Step 1 — send the request. A rejecting fetch() becomes a Left,
// and a non-OK status becomes a Left carrying the status code.
function fetchUser(id: string): Promise<Either<RequestError, Response>> {
  return fetch(`/api/users/${id}`)
    .then((res): Either<RequestError, Response> =>
      res.ok ? right(res) : left(res.status),
    )
    .catch((): Either<RequestError, Response> => left('network-failed'));
}

// Step 2 — parse the body. res.json() rejects on malformed JSON,
// so the failure is converted to a Left as well.
async function parseUser(res: Response): Promise<Either<RequestError, User>> {
  try {
    return right((await res.json()) as User);
  } catch {
    return left('invalid-json');
  }
}

// Step 3 — compose. fromPromise() starts a chain from the Either-returning
// fetchUser(), and asyncRight() flattens the Either that parseUser() returns,
// so the whole flow becomes a single chain of typed Left/Right values.
function loadUser(id: string) {
  return fromPromise(() => fetchUser(id)).asyncRight(parseUser);
}

// Usage — one flow, two ways to consume it.

// 1. React to the in-flight chain: the taps fire when it settles,
//    each receiving the unwrapped value.
loadUser('42')
  .left((error) => showError(errorMessage(error)))
  .right((profile) => renderProfile(profile));

// 2. Or await it: a plain Either comes out, handled with .left() / .right().
const user = await loadUser('42');
user.left((error) => showError(errorMessage(error)));
user.right((profile) => renderProfile(profile));

function errorMessage(error: RequestError): string {
  // Plain values are compared with === — no instanceof anywhere.
  return error === 'network-failed' ? 'You are offline'
       : error === 'invalid-json'   ? 'The server sent a malformed response'
                                    : `The server answered with status ${error}`;
}
```

After the two `===` checks TypeScript narrows `error` to `number` in the last branch, so the status code is used directly — no casting or `instanceof` needed.

## Top-level API

```ts
import {
  Either,          // type Either<LeftValue, RightValue> = Left | Right
  Left,            // class Left<LeftValue, RightValue>
  Right,           // class Right<LeftValue, RightValue>
  type AsyncEither, // the async chain type — exported as type-only; build chains with fromPromise
  AsyncEitherStep,  // type of the values asyncRight/asyncLeft handlers return
  fromPromise,     // starts an async chain from a () => Promise<Either<LeftValue, RightValue>> thunk
  right,           // create a Right
  left,            // create a Left
} from 'either-lite';
```

## Creating Eithers

### `right(value)`

Constructs the `Right` (success) variant.

**Signature:**

```ts
right<LeftValue = never, RightValue = never>(value: RightValue): Either<LeftValue, RightValue>;
```

**Example:**

```ts
import { right, left, Either } from 'either-lite';

type ParseError = 'not-a-number' | 'out-of-range';

const v1 = right(2);                         // Either<never, number>
const v2 = right<ParseError, number>(8080);  // Either<ParseError, number>

function parsePort(raw: string): Either<ParseError, number> {
  const port = Number(raw);
  if (!Number.isInteger(port)) {
    return left<ParseError, number>('not-a-number');
  }
  if (port < 1 || port > 65535) {
    return left<ParseError, number>('out-of-range');
  }
  return right<ParseError, number>(port);
}
```

### `left(value)`

Constructs the `Left` (failure) variant.

**Signature:**

```ts
left<LeftValue = never, RightValue = never>(value: LeftValue): Either<LeftValue, RightValue>;
```

**Example:**

```ts
import { left, Either } from 'either-lite';

export const NOT_FOUND = Symbol('not-found');
type LoadError = typeof NOT_FOUND | 'offline';

const v1 = left(NOT_FOUND);                  // Either<typeof NOT_FOUND, never>
const v2 = left<LoadError, User>(NOT_FOUND); // Either<LoadError, User>
const v3 = left<LoadError, User>('offline'); // Either<LoadError, User>
```

**A note on payloads.** `left()` accepts any data, and plain identifiers are usually the best fit: string literals and symbols compare with `===`, need no `instanceof`, survive serialization, and give you a closed list of failure reasons in the type. Reach for an `Error` object only when you genuinely need a stack trace.

Because the unfilled side defaults to `never`, a bare `left(x)` is assignable wherever a wider `Either` is expected; pass both generics explicitly when you want a fully typed value in one call (same as `@sweet-monads/either`'s `left<L, R>`).

The `Left` / `Right` classes are exported, but the factories are the idiomatic way to construct values — you rarely need `new Left(...)` / `new Right(...)` yourself.

## Inspecting an Either

### `isRight()`

Returns `true` if the Either is a Right. This is a type guard: inside the `if`, the value is narrowed and `value` is `RightValue`.

**Signature:**

```ts
isRight(): boolean; // type guard: inside the if, value is RightValue
```

**Example:**

```ts
const result = parsePort('8080'); // Either<ParseError, number>

if (result.isRight()) {
  result.value; // number — ParseError branch is excluded by the type system
} else {
  result.value; // ParseError
}
```

### `isLeft()`

Returns `true` if the Either is a Left. Mirror of `isRight()`.

**Signature:**

```ts
isLeft(): boolean; // type guard: inside the if, value is LeftValue
```

**Example:**

```ts
const result = parsePort('99999'); // Either<ParseError, number>

if (result.isLeft()) {
  result.value; // 'not-a-number' | 'out-of-range'
  if (result.value === 'out-of-range') {
    // handle one specific reason — plain ===, no instanceof
  }
}
```

### The `value` field

Readonly payload of the Either, typed by its side: `RightValue` on a Right, `LeftValue` on a Left.

On an `Either<LeftValue, RightValue>` union it is `L | R`; narrow with the guards above to get the precise type.

```ts
const result = parsePort('8080'); // Either<ParseError, number>
result.value;                     // ParseError | number

if (result.isRight()) {
  result.value;                   // number
}
```

Eithers are immutable: `value` is `readonly` and no method mutates the instance.

## Reacting to one side

### `.right(callback)`

Runs `callback` with the unwrapped value **only if this is a Right**, then returns `this` for chaining. A Left is passed through untouched, callback not called.

**Signature:**

```ts
right(onRight: (value: RightValue) => void): this;
```

- `onRight: (value: RightValue) => void` — called with the payload when the Either is Right.
- Returns `this` (the same instance), so side handlers chain.

**Example:**

```ts
parsePort(raw)
  .right((port) => console.log(`listening on ${port}`)) // runs for Right only
  .left((error) => console.error(`port error: ${error}`)); // runs for Left only
```

The callback is invoked synchronously during the call. If the callback itself throws, the exception propagates to the caller as usual — this is the synchronous counterpart of the async fail-loud contract below.

### `.left(callback)`

Runs `callback` with the unwrapped value **only if this is a Left**, then returns `this`. Mirror of `.right()`.

**Signature:**

```ts
left(onLeft: (value: LeftValue) => void): this;
```

**Example:**

```ts
left<ParseError, number>('not-a-number')
  .right((port) => console.log(port))      // not called
  .left((error) => console.error(error));  // "not-a-number"
```

## Async chains

### `AsyncEither` overview

`AsyncEither<LeftValue, RightValue>` is the async chain: a `PromiseLike<Either<LeftValue, RightValue>>` with two async step methods (`asyncRight` / `asyncLeft`), two sync taps (`right` / `left`), and `then`. It is exported as a **type only** — the class is module-private — so you can name it in annotations (`function loadUser(id: string): AsyncEither<RequestError, User>`), while `fromPromise` stays the only way to build a chain.

### `fromPromise(fn)`

Starts an async chain from a *thunk* — a function producing a `Promise<Either<LeftValue, RightValue>>`. The thunk is called once, immediately, and the resolved Either is unwrapped into the chain. Both type parameters are inferred from the thunk's return type.

If you already hold the promise, pass a thunk that returns it — the thunk is still invoked once, immediately, so this is the direct way to adopt an existing `PromiseLike<Either<...>>`:

```ts
// fetchUser(id): Promise<Either<RequestError, Response>> — already Either-based
const chain = fromPromise(() => fetchUser('42'));
chain.asyncRight((res) => parseUser(res));
```

The chain settles to exactly what the thunk's promise settles to — `fromPromise` adds no capture or conversion. A resolved Either becomes the chain's value; a rejection rejects the chain; a synchronously throwing thunk throws at the call site. Under the contract neither happens (producers *return* `left(...)` for failures, and foreign throwing APIs are converted at the boundary with `try`/`catch`); if it does happen, it is a bug and it fails loudly — `await` throws, and an unhandled chain crashes the process.

**Signature:**

```ts
fromPromise<LeftValue, RightValue>(
  source: () => PromiseLike<Either<LeftValue, RightValue>>,
): AsyncEither<LeftValue, RightValue>;
```

**Example:**

```ts
const loadData = () =>
  fromPromise(fetchProduct) // () => Promise<Either<string, Product>>
    .asyncRight((product) => fetchRelatedProducts(product.category)) // Either-returning step
    .right((products) => products.forEach(renderProduct)); // sync tap on the result
```

Handlers attached before settlement wait for it; handlers attached after fire on a subsequent microtask.

### `AsyncEither#asyncRight(callback)`

Runs `callback` with the **unwrapped** value once the chain settles as a Right, and flattens the returned **step** into the chain. A step is one of:

- an `Either` — becomes the chain's next value (this is how transformations compose);
- an `AsyncEither` — awaited and adopted;
- a `PromiseLike<Either>` — awaited and flattened (this is how async functions that return `Promise<Either<...>>` plug in directly).

When the chain settles as a Left, the callback is skipped and the Left passes through to the returned chain.

**Signature:**

```ts
asyncRight<NewRightValue, NewLeftValue>(
  onRight: (value: RightValue) => AsyncEitherStep<NewLeftValue, NewRightValue>,
): AsyncEither<LeftValue | NewLeftValue, NewRightValue>;
```

- `onRight` receives the payload, not the Either.
- The method returns a **new** `AsyncEither`; the source chain is untouched.
- The left type widens: a step that can itself fail with `NewLeftValue` produces `AsyncEither<LeftValue | NewLeftValue, NewRightValue>`.

**Example:**

```ts
// fetchUser(id): Promise<Either<RequestError, Response>>
// parseUser(res): Promise<Either<RequestError, User>>
fromPromise(() => fetchUser(1)) // AsyncEither<RequestError, Response>
  .asyncRight(parseUser) // PromiseLike<Either> step → AsyncEither<RequestError, User>
  .right((user) => renderProfile(user)); // reaction: sync tap, chain unchanged
```

**Handlers must not throw.** An exception inside a step handler — or a step promise that rejects — surfaces as a rejection on the *derived* chain: an unhandled rejection (process crash under Node's default `--unhandled-rejections=throw`) if nobody handles it. This is deliberate: callback errors are never silently swallowed (see [Behavioral contracts](#behavioral-contracts-and-edge-cases)). If a handler can fail, handle the failure inside the handler and return it as a Left.

### `AsyncEither#asyncLeft(callback)`

Runs `callback` with the **unwrapped** value once the chain settles as a Left, and flattens the returned step. Mirror of `asyncRight` — and the idiomatic recovery path: return a `Right` to fall back to a value, or a `Left` to keep failing (optionally with a new reason).

**Signature:**

```ts
asyncLeft<NewLeftValue, NewRightValue>(
  onLeft: (value: LeftValue) => AsyncEitherStep<NewLeftValue, NewRightValue>,
): AsyncEither<NewLeftValue, RightValue | NewRightValue>;
```

- The right type widens: a recovery that can produce `NewRightValue` yields `AsyncEither<NewLeftValue, RightValue | NewRightValue>`.
- When the chain settles as a Right, the callback is skipped and the Right passes through.

**Example:**

```ts
fromPromise(() => loadUser(1)) // AsyncEither<LoadError, User>
  .asyncLeft((error) => retry(error)) // recover: Either<LoadError, User>
  .asyncRight((user) => renderProfile(user)) // skipped when loadUser fails
  .left(() => showToast('giving up')); // reaction: sync tap on a settled Left
```

### Sync taps: `AsyncEither#right(callback)` / `AsyncEither#left(callback)`

Synchronous-style counterparts of the async steps, matching the settled-Either API: once the chain settles, the callback fires with the unwrapped value **only if the settled side matches**, and the method returns the same instance. Taps chain freely, and a `.left()` tap intercepts any upstream Left — no matter how many async steps produced it — while a `.right()` tap sees the Right value as it is at that point in the chain.

**Signature:**

```ts
right(onRight: (value: RightValue) => void): this;
left(onLeft: (value: LeftValue) => void): this;
```

- The callback's return value is ignored — a tap never transforms the chain (use `asyncRight` / `asyncLeft` for that). In particular, an Either or promise returned from a tap is *not* unwrapped.
- The callback runs on a microtask after settlement; like the async steps, a throwing tap fails loudly as an unhandled rejection.

**Example:**

```ts
fromPromise(fetchProduct) // () => Promise<Either<string, Product>>
  .asyncRight((product) => fetchRelatedProducts(product.category)) // async step
  .right((products) => { products.forEach(renderProduct); }) // sync tap
  .left(() => showError()); // intercepts any upstream Left
```

### `await` and PromiseLike interop

The chain implements `PromiseLike<Either<LeftValue, RightValue>>`: awaiting it (or calling `.then` on it) yields the settled `Either` itself.

**Signature:**

```ts
then<FulfilledValue = Either<LeftValue, RightValue>, RejectedValue = never>(
  onFulfilled?: ((value: Either<LeftValue, RightValue>) => FulfilledValue | PromiseLike<FulfilledValue>) | null,
  onRejected?: ((reason: unknown) => RejectedValue | PromiseLike<RejectedValue>) | null,
): PromiseLike<FulfilledValue | RejectedValue>;
```

**Example:**

```ts
// await yields the Either
const either: Either<LoadError, User> = await fromPromise(() => loadUser(1));

either.isRight(); // narrow and read as usual

// usable anywhere a PromiseLike is expected
const [either2] = await Promise.all([fromPromise(() => loadUser(2))]);

// returned from an async function, it is awaited like a normal thenable
async function load(id: number): Promise<Either<LoadError, User>> {
  return fromPromise(() => loadUser(id));
}
```

`onRejected` exists to satisfy the `PromiseLike` interface: it fires only if the source promise rejected — a contract violation — so in well-behaved code it is dead code.

## Behavioral contracts and edge cases

These are guarantees (and sharp edges) of the implementation. Every one of them is covered by a unit test in `either.test.ts`.

**The chain settles to exactly what the source settles to.** `fromPromise` performs no capture or repair: a resolved Either becomes the chain's value, a rejection rejects the chain, and a synchronous throw in the thunk propagates to the caller. `await chain` hands you an Either whenever the contract holds; when it doesn't, the failure is loud — a thrown rejection where the chain is awaited, a process crash on an unhandled one. A step handler that throws or returns a rejecting step likewise rejects its derived chain (next paragraph).

**Right can carry any value.** A Right payload is never inspected or filtered: `0`, `''`, `null`, `undefined` and any other falsy value are perfectly valid Right values — only the constructor decides the side.

**fromPromise settles to the resolved Either — nothing more.** A promise that resolves to an Either settles the chain to that very instance; no copying, no re-wrapping, no inspection. Resolving with a non-Either is a contract violation — the types forbid it, and at runtime it will crash downstream when the chain touches it, not get silently repaired into `Right(value)`. To *carry* an Either as the Right value of another Either, wrap it once:

```ts
const inner: Either<ParseError, number> = right<ParseError, number>(8080);
const nested = await fromPromise(() => Promise.resolve(right(inner)));
// Either<never, Either<ParseError, number>> — the Either is the Right payload
```

**Async steps flatten exactly one level.** A step returning an Either, an AsyncEither, or a PromiseLike of Either is flattened into the chain; the opposite side passes through untouched.

**Async handlers fail loudly.** A throwing handler cannot propagate its exception back through the settled chain (the call site has long returned), so it surfaces as a rejection on the derived chain — an unhandled promise rejection, which Node's default policy turns into a process crash, when nobody handles it. The same applies to a step whose returned promise rejects, and to a sync `.right()` / `.left()` tap on a pending chain. Errors are never dropped silently; a handler that can throw must catch internally. The synchronous `.right()` / `.left()` on a settled Either are different: they run during the call, so a throwing callback propagates to the caller as usual.

**Handlers are additive and timing-agnostic.** Any number of `asyncRight` / `asyncLeft` steps and `right` / `left` taps can be attached, in any order, before or after settlement; all matching handlers run. Handlers attached after settlement run on a subsequent microtask, matching promise semantics.

**No mutation.** Eithers are immutable, and registering a handler never changes the settled value. Sync taps return the same chain; `asyncRight` / `asyncLeft` return a new chain that settles to the Either their handler returned — or to the settled Either, carried through, when the handler's side did not match.

## Type-level notes

**Generic order is always `<LeftValue, RightValue>`** — matching the `Either<LeftValue, RightValue>` type, for the factories *and* `fromPromise`:

```ts
right<ParseError, number>(8080);                 // Either<ParseError, number>
left<ParseError, number>('out-of-range');        // Either<ParseError, number>
fromPromise(fetchProduct);                       // AsyncEither<string, Product> — inferred
```

**Literals are preserved.** `left('out-of-range')` infers `Either<'out-of-range', never>` and `right(7)` infers `Either<never, number>` — pin the generics when you want a wider type (`left<RequestError, User>('offline')`), or use them bare when the literal is all you need. The unfilled side defaults to `never`, which is assignable to anything, so a bare `left(x)` / `right(x)` fits any matching position.

**Step types widen by design.** A step that can fail adds its left type to the chain's (`AsyncEither<L | NewLeftValue, R>`); a recovery that can succeed adds its right type (`AsyncEither<L, R | NewRightValue>`). Fully recovering a chain back to a single right type requires the recovery step to produce that same right type.

**Narrowing is what makes `value` precise.** On the `Either<LeftValue, RightValue>` union, `value` is `L | R`; the `isRight()` / `isLeft()` type guards narrow the whole Either, and `value` narrows with it.

**`AsyncEither` is a named, exported type.** Name it directly in types (`function loadUser(id: string): AsyncEither<RequestError, User>`); there is no hidden chain type to work around. The class itself is module-private — `fromPromise` is the only constructor.

Requires TypeScript with `strict: true` (the type guards and narrowing assume it).

## Design goals and non-goals

- **Failures are returned, not thrown.** The contract starts at the chain seed: `fromPromise` takes a thunk returning `Promise<Either<...>>`, and every step returns an Either — so a failing validation, a rejected request, a missing record are all ordinary `left(...)` values flowing down the chain. `fromPromise` captures nothing: a rejecting thunk rejects the chain and `await` throws — the catch-rejection-and-wrap-it behavior other libraries provide is exactly the kind of silent repair this library refuses, and throwing across the API is never required.
- **No separate `map` / `chain` / `fold` / `match` family.** The side callbacks do double duty: return an Either from `asyncRight` / `asyncLeft` to transform the chain, register a sync tap to react; branch with `isRight()` / `isLeft()` when you need the value in the current scope. Transformations that can fail belong in the `Either`-returning functions you call, not in dedicated combinators.
- **Steps return Eithers explicitly.** An `asyncRight` / `asyncLeft` handler never takes a plain value or `undefined` shortcut: the next step is always an `Either`, an `AsyncEither`, or a promise of one. That is the `neverthrow` discipline — what a step produces is visible at the call site, and only one level of flattening ever happens.
- **No error-accumulation combinators** (`mergeInMany`, `combineWithAllErrors`, `Validation`, …) and **no companion types** (Maybe, Option, Task, …). If you need those, look to other implementations.
- **Fail-loud over fail-silent.** Async handler errors crash rather than vanish (see contracts above). The library also never repairs contract violations: a producer that resolves with a non-Either fails loudly when the chain touches it, exactly like a handler that throws. If you prefer wrapped-and-ignored error channels, this is not your library.

What it keeps: a tiny API surface (`right`, `left`, `fromPromise` as the only constructors, classes `Left` / `Right`, exported types `Either` / `AsyncEither` / `AsyncEitherStep`, and the `asyncRight` / `asyncLeft` / side callbacks per layer), full type narrowing and zero runtime dependencies.
