export type Either<LeftValue, RightValue> =
  | Left<LeftValue, RightValue>
  | Right<LeftValue, RightValue>;

export class Left<LeftValue, RightValue> {
  readonly value: LeftValue;

  constructor(value: LeftValue) {
    this.value = value;
  }

  isLeft(): this is Left<LeftValue, RightValue> {
    return true;
  }

  isRight(): this is Right<LeftValue, RightValue> {
    return false;
  }

  left(onLeft: (value: LeftValue) => void): this {
    onLeft(this.value);
    return this;
  }

  right(_onRight: (value: RightValue) => void): this {
    return this;
  }
}

export class Right<LeftValue, RightValue> {
  readonly value: RightValue;

  constructor(value: RightValue) {
    this.value = value;
  }

  isLeft(): this is Left<LeftValue, RightValue> {
    return false;
  }

  isRight(): this is Right<LeftValue, RightValue> {
    return true;
  }

  left(_onLeft: (value: LeftValue) => void): this {
    return this;
  }

  right(onRight: (value: RightValue) => void): this {
    onRight(this.value);
    return this;
  }
}

export function left<LeftValue extends string, RightValue = never>(
  value: LeftValue,
): Either<LeftValue, RightValue>;
export function left<LeftValue, RightValue = never>(
  value: LeftValue,
): Either<LeftValue, RightValue>;
export function left(value: unknown): Either<unknown, unknown> {
  return new Left(value);
}

export function right<LeftValue = never, RightValue extends string = string>(
  value: RightValue,
): Either<LeftValue, RightValue>;
export function right<LeftValue = never, RightValue = never>(
  value: RightValue,
): Either<LeftValue, RightValue>;
export function right(value: unknown): Either<unknown, unknown> {
  return new Right(value);
}

export type AsyncEitherStep<LeftValue, RightValue> =
  | Either<LeftValue, RightValue>
  | AsyncEither<LeftValue, RightValue>
  | PromiseLike<Either<LeftValue, RightValue>>;

class AsyncEither<LeftValue, RightValue>
  implements PromiseLike<Either<LeftValue, RightValue>>
{
  private readonly _promise: PromiseLike<Either<LeftValue, RightValue>>;

  constructor(promise: PromiseLike<Either<LeftValue, RightValue>>) {
    this._promise = promise;
  }

  asyncRight<NewRightValue, NewLeftValue>(
    onRight: (value: RightValue) => AsyncEitherStep<NewLeftValue, NewRightValue>,
  ): AsyncEither<LeftValue | NewLeftValue, NewRightValue> {
    return new AsyncEither<LeftValue | NewLeftValue, NewRightValue>(
      this._promise.then(
        async (either): Promise<Either<LeftValue | NewLeftValue, NewRightValue>> => {
          if (either.isLeft()) {
            return new Left<LeftValue | NewLeftValue, NewRightValue>(either.value);
          }
          return onRight(either.value);
        },
      ),
    );
  }

  asyncLeft<NewLeftValue, NewRightValue>(
    onLeft: (value: LeftValue) => AsyncEitherStep<NewLeftValue, NewRightValue>,
  ): AsyncEither<NewLeftValue, RightValue | NewRightValue> {
    return new AsyncEither<NewLeftValue, RightValue | NewRightValue>(
      this._promise.then(
        async (either): Promise<Either<NewLeftValue, RightValue | NewRightValue>> => {
          if (either.isRight()) {
            return new Right<NewLeftValue, RightValue | NewRightValue>(either.value);
          }
          return onLeft(either.value);
        },
      ),
    );
  }

  left(onLeft: (value: LeftValue) => void): this {
    void this._promise.then((either) => {
      if (either.isLeft()) {
        onLeft(either.value);
      }
    });
    return this;
  }

  right(onRight: (value: RightValue) => void): this {
    void this._promise.then((either) => {
      if (either.isRight()) {
        onRight(either.value);
      }
    });
    return this;
  }

  then<FulfilledValue = Either<LeftValue, RightValue>, RejectedValue = never>(
    onFulfilled?:
      | ((
          value: Either<LeftValue, RightValue>,
        ) => FulfilledValue | PromiseLike<FulfilledValue>)
      | null,
    onRejected?: ((reason: unknown) => RejectedValue | PromiseLike<RejectedValue>) | null,
  ): PromiseLike<FulfilledValue | RejectedValue> {
    return this._promise.then(onFulfilled, onRejected);
  }
}

export type { AsyncEither };

export const fromPromise = <LeftValue, RightValue>(
  source: () => PromiseLike<Either<LeftValue, RightValue>>,
): AsyncEither<LeftValue, RightValue> => new AsyncEither<LeftValue, RightValue>(source());
