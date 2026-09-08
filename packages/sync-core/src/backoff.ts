export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  random?: () => number;
}

/**
 * Exponential backoff with "equal jitter": each delay is somewhere between half
 * and all of the exponential step, so a fleet of tabs that lost the server at
 * the same moment doesn't come back in lockstep.
 */
export class Backoff {
  private attempt = 0;
  private readonly random: () => number;

  constructor(private readonly options: BackoffOptions) {
    this.random = options.random ?? Math.random;
  }

  next(): number {
    const step = Math.min(this.options.maxMs, this.options.baseMs * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 30);
    return Math.round(step / 2 + (this.random() * step) / 2);
  }

  reset(): void {
    this.attempt = 0;
  }
}

/** One pending retry at a time, with its own backoff. */
export class RetryTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly backoff: Backoff) {}

  get pending(): boolean {
    return this.handle !== null;
  }

  schedule(run: () => void): void {
    this.cancel();
    this.handle = setTimeout(() => {
      this.handle = null;
      run();
    }, this.backoff.next());
  }

  cancel(): void {
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
  }

  /** Call after a success so the next failure starts from the base delay again. */
  succeeded(): void {
    this.backoff.reset();
  }
}
