import { backoffMs } from './backoff';
import { classify } from './errors';
import type { Network, ReportStore, Transport } from './ports';
import type { NewReport, Report } from './types';
import { uploadReport } from './uploader';
import { validateNewReport } from './validation';

export interface RunnerState {
  online: boolean;
  /** The server rejected our key; nothing is sent until resume() is called. */
  authBlocked: boolean;
  running: boolean;
}

export type RunnerEvent =
  | { type: 'report'; report: Report }
  | { type: 'removed'; id: string }
  | { type: 'progress'; id: string; index: number; sentBytes: number; totalBytes: number }
  | { type: 'runner'; state: RunnerState };

export interface RunnerOptions {
  store: ReportStore;
  transport: Transport;
  network: Network;
  newId: () => string;
  stallMs?: number;
  backoff?: (attempt: number) => number;
}

export class UploadRunner {
  private readonly store: ReportStore;
  private readonly transport: Transport;
  private readonly network: Network;
  private readonly newId: () => string;
  private readonly stallMs: number;
  private readonly backoff: (attempt: number) => number;

  private listeners = new Set<(event: RunnerEvent) => void>();
  private stopped = true;
  private running = false;
  private again = false;
  private authBlocked = false;
  private done: Promise<void> = Promise.resolve();
  private resuming: Promise<void> = Promise.resolve();
  private wake?: ReturnType<typeof setTimeout>;
  private unsubscribeNetwork?: () => void;
  private cancel = new AbortController();

  constructor(options: RunnerOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.network = options.network;
    this.newId = options.newId;
    // Generous: a cold start (Android's WebView/cookie setup on first request) can eat many seconds on a weak phone.
    this.stallMs = options.stallMs ?? 60_000;
    this.backoff = options.backoff ?? backoffMs;
  }

  subscribe(listener: (event: RunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): RunnerState {
    return { online: this.network.isOnline(), authBlocked: this.authBlocked, running: this.running };
  }

  list(): Promise<Report[]> {
    return this.store.list();
  }

  /** Recovers from a previous run (a killed app leaves reports 'uploading'), then starts delivering. */
  async start(): Promise<void> {
    this.stopped = false;
    for (const report of await this.store.list()) {
      if (report.status === 'uploading') {
        await this.save({ ...report, status: 'queued', nextAttemptAt: 0 });
      }
    }
    this.unsubscribeNetwork = this.network.subscribe(online => {
      this.emitState();
      if (online) {
        this.resuming = this.resume();
      }
    });
    this.emitState();
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.wake);
    this.unsubscribeNetwork?.();
  }

  /**
   * Start over: cancels any upload in flight, then deletes every report held on this phone.
   * Reports already delivered stay on the server. Returns what was deleted so the caller can
   * remove its photo files. Call start() again afterwards.
   */
  async reset(): Promise<Report[]> {
    this.stop();
    this.cancel.abort();
    while (this.running) {
      await this.done;
    }
    const reports = await this.store.list();
    for (const report of reports) {
      await this.store.remove(report.id);
      this.emit({ type: 'removed', id: report.id });
    }
    this.cancel = new AbortController();
    this.authBlocked = false;
    return reports;
  }

  /** Validates, saves, and only then starts sending. A saved report is never lost. */
  async enqueue(input: NewReport): Promise<Report> {
    validateNewReport(input);
    const report = await this.save({
      id: this.newId(),
      description: input.description.trim(),
      images: input.images,
      status: 'queued',
      createdAt: Date.now(),
      uploadedImages: [],
      attempts: 0,
      nextAttemptAt: 0,
    });
    this.kick();
    return report;
  }

  /**
   * Skips any backoff, restarts the retry ladder and clears an auth pause. Call on network return and when
   * the app foregrounds: conditions changed, so failures from before shouldn't keep the wait at its ceiling.
   */
  async resume(): Promise<void> {
    this.authBlocked = false;
    for (const report of await this.store.list()) {
      if (report.status === 'queued' && (report.nextAttemptAt !== 0 || report.attempts !== 0)) {
        await this.save({ ...report, nextAttemptAt: 0, attempts: 0 });
      }
    }
    this.emitState();
    this.kick();
  }

  /** Puts a permanently failed report back in the queue. */
  async retry(id: string): Promise<void> {
    const report = await this.store.get(id);
    if (report?.status === 'failed') {
      await this.save({ ...report, status: 'queued', attempts: 0, nextAttemptAt: 0, lastError: undefined });
      this.kick();
    }
  }

  async discard(id: string): Promise<void> {
    const report = await this.store.get(id);
    if (report?.status === 'uploading') {
      throw new Error('This report is uploading right now.');
    }
    await this.store.remove(id);
    this.emit({ type: 'removed', id });
  }

  /** Resolves once nothing is in flight. Retries waiting on a backoff timer don't count. */
  async whenIdle(): Promise<void> {
    await this.resuming;
    while (this.running) {
      await this.done;
    }
  }

  private kick(): void {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.emitState();
    this.done = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.again = false;
        await this.pass();
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
      this.emitState();
    }
  }

  private async pass(): Promise<void> {
    while (!this.stopped) {
      if (!this.network.isOnline() || this.authBlocked) {
        return;
      }
      const queued = (await this.store.list())
        .filter(r => r.status === 'queued')
        .sort((a, b) => a.createdAt - b.createdAt);
      if (queued.length === 0) {
        return;
      }
      const now = Date.now();
      const due = queued.find(r => r.nextAttemptAt <= now);
      if (!due) {
        clearTimeout(this.wake);
        this.wake = setTimeout(() => this.kick(), Math.min(...queued.map(r => r.nextAttemptAt)) - now);
        return;
      }
      await this.attempt(due);
    }
  }

  private async attempt(start: Report): Promise<void> {
    let current = await this.save({ ...start, status: 'uploading' });
    try {
      await uploadReport(current, this.transport, {
        stallMs: this.stallMs,
        signal: this.cancel.signal,
        onProgress: (index, sentBytes) =>
          this.emit({ type: 'progress', id: current.id, index, sentBytes, totalBytes: current.images[index].bytes }),
        onImageUploaded: async index => {
          current = await this.save({ ...current, uploadedImages: [...new Set([...current.uploadedImages, index])] });
        },
        onImagesMissing: async missing => {
          current = await this.save({
            ...current,
            uploadedImages: current.uploadedImages.filter(i => !missing.includes(i)),
          });
        },
      });
      await this.save({ ...current, status: 'uploaded', attempts: 0, nextAttemptAt: 0, lastError: undefined });
    } catch (err) {
      if (this.stopped) {
        return; // leave it 'uploading'; start() requeues it next run
      }
      const verdict = classify(err);
      const lastError = err instanceof Error ? err.message : String(err);
      if (verdict === 'fatal') {
        await this.save({ ...current, status: 'failed', lastError });
        return;
      }
      if (verdict === 'auth') {
        this.authBlocked = true;
        this.emitState();
      }
      const attempts = current.attempts + 1;
      await this.save({
        ...current,
        status: 'queued',
        attempts,
        nextAttemptAt: verdict === 'auth' ? 0 : Date.now() + this.backoff(attempts),
        lastError,
      });
    }
  }

  private async save(report: Report): Promise<Report> {
    await this.store.save(report);
    this.emit({ type: 'report', report });
    return report;
  }

  private emitState(): void {
    this.emit({ type: 'runner', state: this.getState() });
  }

  private emit(event: RunnerEvent): void {
    this.listeners.forEach(listener => listener(event));
  }
}
