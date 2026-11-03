import { HttpError } from '../errors';
import type { Network, ReportStore, Transport } from '../ports';
import type { ImageFile, Report } from '../types';
import { MAX_IMAGE_BYTES } from '../validation';

/** Round-trips through JSON like a real on-disk store would. */
export class MemoryStore implements ReportStore {
  private data = new Map<string, string>();

  async save(report: Report): Promise<void> {
    this.data.set(report.id, JSON.stringify(report));
  }
  async get(id: string): Promise<Report | undefined> {
    const raw = this.data.get(id);
    return raw ? JSON.parse(raw) : undefined;
  }
  async list(): Promise<Report[]> {
    return [...this.data.values()].map(raw => JSON.parse(raw));
  }
  async remove(id: string): Promise<void> {
    this.data.delete(id);
  }
}

export class FakeNetwork implements Network {
  private listeners = new Set<(online: boolean) => void>();

  constructor(private online = true) {}

  isOnline(): boolean {
    return this.online;
  }
  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(online: boolean): void {
    this.online = online;
    this.listeners.forEach(listener => listener(online));
  }
}

interface StoredReport {
  description: string;
  imageCount: number;
  images: Set<number>;
  complete: boolean;
}

/** An in-memory copy of the backend's rules: idempotent create, per-image upload, complete. */
export class FakeServer {
  reports = new Map<string, StoredReport>();
  calls = { putReport: 0, putImage: 0, complete: 0 };
  /** How many times each image arrived, keyed `${reportId}/${index}`. */
  imageUploads: Record<string, number> = {};

  completed(): string[] {
    return [...this.reports].filter(([, r]) => r.complete).map(([id]) => id);
  }
  reset(): void {
    this.reports.clear();
  }
}

type Method = 'putReport' | 'putImage' | 'complete';
/** Error: fail before doing anything. hang: never answer. lose: do the work, then drop the reply. pass: just run `then`. */
type Fault = Error | 'hang' | 'lose' | 'pass';

export class FakeTransport implements Transport {
  private faults: { method: Method; fault: Fault; index?: number; then?: () => void }[] = [];

  constructor(readonly server: FakeServer) {}

  inject(method: Method, fault: Fault, index?: number, then?: () => void): void {
    this.faults.push({ method, fault, index, then });
  }

  putReport(id: string, body: { description: string; imageCount: number }, signal: AbortSignal): Promise<void> {
    return this.run('putReport', signal, undefined, () => {
      const existing = this.server.reports.get(id);
      if (!existing) {
        this.server.reports.set(id, { ...body, images: new Set(), complete: false });
      } else if (existing.description !== body.description || existing.imageCount !== body.imageCount) {
        throw new HttpError(409);
      }
    });
  }

  putImage(
    id: string,
    index: number,
    image: ImageFile,
    onProgress: (sentBytes: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    return this.run('putImage', signal, index, () => {
      const report = this.server.reports.get(id);
      if (!report) {
        throw new HttpError(404);
      }
      if (image.bytes > MAX_IMAGE_BYTES) {
        throw new HttpError(413);
      }
      report.images.add(index);
      const key = `${id}/${index}`;
      this.server.imageUploads[key] = (this.server.imageUploads[key] ?? 0) + 1;
      onProgress(image.bytes);
    });
  }

  complete(id: string, signal: AbortSignal): Promise<void> {
    return this.run('complete', signal, undefined, () => {
      const report = this.server.reports.get(id);
      if (!report) {
        throw new HttpError(404);
      }
      const missing = [...Array(report.imageCount).keys()].filter(i => !report.images.has(i));
      if (missing.length) {
        throw new HttpError(409, { missing });
      }
      report.complete = true;
    });
  }

  private async run(method: Method, signal: AbortSignal, index: number | undefined, execute: () => void): Promise<void> {
    this.server.calls[method]++;
    const at = this.faults.findIndex(f => f.method === method && (f.index === undefined || f.index === index));
    const injected = at >= 0 ? this.faults.splice(at, 1)[0] : undefined;
    injected?.then?.();
    const fault = injected?.fault;

    if (fault instanceof Error) {
      throw fault;
    }
    if (fault === 'hang') {
      return new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    execute();
    if (fault === 'lose') {
      throw new TypeError('Network request failed');
    }
  }
}
