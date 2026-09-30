export class TimeoutError extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`No response within ${ms / 1000}s`);
    this.name = 'TimeoutError';
    this.ms = ms;
  }
}

/** setTimeout as a promise that rejects with the signal's reason when aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
