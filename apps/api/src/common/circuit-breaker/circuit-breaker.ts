export type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  failureThreshold?: number;  // failures before opening (default 5)
  successThreshold?: number;  // successes in half-open to close (default 2)
  timeout?: number;           // ms before trying half-open (default 60_000)
  name?: string;
}

/**
 * Simple in-process circuit breaker. Wraps any async call.
 * State: closed (normal) → open (failing, reject fast) → half-open (test) → closed
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private nextRetry = 0;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly name: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.successThreshold = opts.successThreshold ?? 2;
    this.timeout = opts.timeout ?? 60_000;
    this.name = opts.name ?? 'unknown';
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextRetry) {
        throw new Error(`Circuit breaker OPEN for ${this.name} — service unavailable`);
      }
      this.state = 'half-open';
      this.successCount = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'closed';
      }
    }
  }

  private onFailure() {
    this.failureCount++;
    if (this.state === 'half-open') {
      this.state = 'open';
      this.nextRetry = Date.now() + this.timeout;
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      this.nextRetry = Date.now() + this.timeout;
    }
  }

  getState(): CircuitState { return this.state; }
  reset() { this.state = 'closed'; this.failureCount = 0; this.successCount = 0; }
}
