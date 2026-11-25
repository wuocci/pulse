import { setTimeout as delay } from "node:timers/promises";

export interface RetryOptions {
  initialMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  // Called after each failure, before waiting waitMs.
  onRetry?: (error: unknown, waitMs: number) => void;
}

// Runs `step` until it succeeds, waiting twice as long after each failure, up to maxMs. Never gives up:
// ingest runs unattended, so it waits out a database that is still starting or briefly down.
export async function retryWithBackoff<T>(
  step: () => Promise<T>,
  {
    initialMs = 1_000,
    maxMs = 60_000,
    sleep = (ms) => delay(ms),
    onRetry = (error, waitMs) => console.error(`Retrying in ${waitMs / 1000} s:`, error),
  }: RetryOptions = {},
): Promise<T> {
  for (let waitMs = initialMs; ; waitMs = Math.min(waitMs * 2, maxMs)) {
    try {
      return await step();
    } catch (error) {
      onRetry(error, waitMs);
      await sleep(waitMs);
    }
  }
}
