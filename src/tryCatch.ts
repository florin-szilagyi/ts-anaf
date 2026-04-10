type Success<T> = {
  data: T;
  error: null;
};

type Failure<E> = {
  data: null;
  error: E;
};

type Result<T, E = Error> = Success<T> | Failure<E>;

// Function overloads
export function tryCatch<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>>;
export function tryCatch<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>>;
export function tryCatch<T, E = Error>(fn: () => T): Result<T, E>;

// Implementation
export function tryCatch<T, E = Error>(
  promiseOrFn: Promise<T> | (() => T | Promise<T>)
): Promise<Result<T, E>> | Result<T, E> {
  if (promiseOrFn instanceof Promise) {
    return (async () => {
      try {
        const data = await promiseOrFn;
        return { data, error: null } as Success<T>;
      } catch (error) {
        return { data: null, error: error as E } as Failure<E>;
      }
    })();
  } else if (typeof promiseOrFn === 'function') {
    try {
      const result = promiseOrFn();

      // If the function returned a Promise, handle it asynchronously
      if (result instanceof Promise) {
        return (async () => {
          try {
            const data = await result;
            return { data, error: null } as Success<T>;
          } catch (error) {
            return { data: null, error: error as E } as Failure<E>;
          }
        })();
      }

      return { data: result as T, error: null } as Success<T>;
    } catch (error) {
      return { data: null, error: error as E } as Failure<E>;
    }
  } else {
    throw new Error('Invalid argument passed to tryCatch. Expected a Promise or a function.');
  }
}
