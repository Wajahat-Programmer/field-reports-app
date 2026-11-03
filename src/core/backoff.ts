const BASE_MS = 1000;
const MAX_MS = 5 * 60 * 1000;

/** Exponential backoff for the given 1-based attempt, with 50-100% jitter so retries don't line up. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling * (0.5 + random() * 0.5));
}
