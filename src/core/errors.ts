export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/** A request made no progress for too long. */
export class StallError extends Error {
  constructor() {
    super('request stalled');
    this.name = 'StallError';
  }
}

/** The server lost images we thought were uploaded; they are marked missing and sent again. */
export class ResyncError extends Error {
  constructor() {
    super('server is missing images, uploading them again');
    this.name = 'ResyncError';
  }
}

/**
 * retry: try again later. fatal: retrying cannot help. auth: the key is wrong, so pause
 * the whole queue rather than drop the report.
 */
export type Verdict = 'retry' | 'fatal' | 'auth';

export function classify(err: unknown): Verdict {
  if (err instanceof HttpError) {
    const { status } = err;
    if (status === 401 || status === 403) {
      return 'auth';
    }
    // 404 means the report vanished from the server (a reset); creating it again fixes that.
    if (status === 404 || status === 408 || status === 429 || status >= 500) {
      return 'retry';
    }
    return 'fatal';
  }
  // Network failures, stalls, aborts and our own resync all land here.
  return 'retry';
}
