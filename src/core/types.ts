export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageFile {
  uri: string;
  mime: ImageMime;
  bytes: number;
}

export type ReportStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';

export interface Report {
  /** Client-generated UUID. It is also the server-side idempotency key. */
  id: string;
  description: string;
  images: ImageFile[];
  status: ReportStatus;
  createdAt: number;
  /** Image indexes the server has confirmed. */
  uploadedImages: number[];
  /** Consecutive failed attempts; drives the backoff. */
  attempts: number;
  /** Epoch ms before which the runner will not retry; 0 means as soon as possible. */
  nextAttemptAt: number;
  lastError?: string;
}

export interface NewReport {
  description: string;
  images: ImageFile[];
}
