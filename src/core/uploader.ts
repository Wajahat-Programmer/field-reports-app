import { HttpError, ResyncError, StallError } from './errors';
import type { Transport } from './ports';
import type { Report } from './types';

export interface UploadHooks {
  /** A request that moves no bytes for this long is aborted, so a hung request can't block the queue. */
  stallMs: number;
  onProgress(index: number, sentBytes: number): void;
  onImageUploaded(index: number): Promise<void>;
  onImagesMissing(indexes: number[]): Promise<void>;
}

/** Runs `fn` with a watchdog: aborts and rejects when `touch()` isn't called for `stallMs`. */
function guarded<T>(
  stallMs: number,
  fn: (signal: AbortSignal, touch: () => void) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let rejectStall!: (err: Error) => void;
  const stalled = new Promise<never>((_, reject) => {
    rejectStall = reject;
  });
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort();
      rejectStall(new StallError());
    }, stallMs);
  };
  arm();
  // Racing the watchdog means a transport that ignores `signal` still can't hang us.
  return Promise.race([fn(controller.signal, arm), stalled]).finally(() => clearTimeout(timer));
}

/**
 * One attempt at delivering a report: create it, send the images the server doesn't have yet,
 * then complete it. Every step is idempotent on the server, so a repeat after any failure is safe.
 */
export async function uploadReport(report: Report, transport: Transport, hooks: UploadHooks): Promise<void> {
  const { id, description, images } = report;
  await guarded(hooks.stallMs, signal => transport.putReport(id, { description, imageCount: images.length }, signal));

  const done = new Set(report.uploadedImages);
  for (let index = 0; index < images.length; index++) {
    if (done.has(index)) {
      continue;
    }
    await guarded(hooks.stallMs, (signal, touch) =>
      transport.putImage(
        id,
        index,
        images[index],
        sent => {
          touch();
          hooks.onProgress(index, sent);
        },
        signal,
      ),
    );
    await hooks.onImageUploaded(index);
  }

  try {
    await guarded(hooks.stallMs, signal => transport.complete(id, signal));
  } catch (err) {
    const missing = err instanceof HttpError && err.status === 409 ? (err.body as { missing?: unknown })?.missing : undefined;
    if (Array.isArray(missing)) {
      // The server lost some images (e.g. it was reset after we uploaded them).
      await hooks.onImagesMissing(missing.filter((i): i is number => typeof i === 'number'));
      throw new ResyncError();
    }
    throw err;
  }
}
