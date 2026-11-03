import type { ImageFile, Report } from './types';

/** Durable storage for reports. Must survive the app being killed. */
export interface ReportStore {
  save(report: Report): Promise<void>;
  get(id: string): Promise<Report | undefined>;
  list(): Promise<Report[]>;
  remove(id: string): Promise<void>;
}

/** The three server calls. Implementations throw HttpError for non-2xx and honour `signal`. */
export interface Transport {
  putReport(id: string, body: { description: string; imageCount: number }, signal: AbortSignal): Promise<void>;
  putImage(
    id: string,
    index: number,
    image: ImageFile,
    onProgress: (sentBytes: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
  complete(id: string, signal: AbortSignal): Promise<void>;
}

export interface Network {
  isOnline(): boolean;
  /** Calls back on every change; returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}
