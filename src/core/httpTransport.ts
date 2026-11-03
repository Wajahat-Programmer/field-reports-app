import { HttpError } from './errors';
import type { Transport } from './ports';
import type { ImageFile } from './types';

export interface SendChunkRequest {
  url: string;
  headers: Record<string, string>;
  image: ImageFile;
  /** Byte range of the image to send: [start, end). */
  start: number;
  end: number;
  signal: AbortSignal;
}

/** Sends one slice of an image. Must resolve (not throw) on any HTTP status; reject only on network failure. */
export type SendChunk = (request: SendChunkRequest) => Promise<{ status: number; body?: unknown }>;

export interface HttpTransportOptions {
  baseUrl: string;
  apiKey: string;
  /**
   * Uploads an image in resumable chunks (the app's native sender). Progress then means bytes the server
   * has confirmed, and a dropped connection resumes from there. Without it, `readImage` + one plain PUT is used.
   */
  sendChunk?: SendChunk;
  chunkBytes?: number;
  /** How long to wait when the server says another chunk is still being written. */
  busyWaitMs?: number;
  /** Reads an image into a fetch body. Injected because file access differs between the app and tests. */
  readImage?: (image: ImageFile) => Promise<NonNullable<RequestInit['body']>>;
  fetchImpl?: typeof fetch;
}

// Small enough to finish well inside the stall timeout on a slow 2G link (64 KB at ~20 kbit/s is ~26 s).
const DEFAULT_CHUNK_BYTES = 64 * 1024;
const MAX_CONFLICTS = 20;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface UploadStatus {
  received?: number;
  complete?: boolean;
  busy?: boolean;
}

export class HttpTransport implements Transport {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  putReport(id: string, body: { description: string; imageCount: number }, signal: AbortSignal): Promise<void> {
    return this.request('PUT', `/reports/${id}`, signal, JSON.stringify(body), 'application/json').then(() => {});
  }

  async putImage(
    id: string,
    index: number,
    image: ImageFile,
    onProgress: (sentBytes: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const path = `/reports/${id}/images/${index}`;
    if (this.options.sendChunk) {
      return this.putImageInChunks(path, image, onProgress, signal, this.options.sendChunk);
    }
    const { readImage } = this.options;
    if (!readImage) {
      throw new Error('HttpTransport needs sendChunk or readImage');
    }
    await this.request('PUT', path, signal, await readImage(image), image.mime);
    // a plain PUT gives no upload progress, so report completion only
    onProgress(image.bytes);
  }

  complete(id: string, signal: AbortSignal): Promise<void> {
    return this.request('POST', `/reports/${id}/complete`, signal).then(() => {});
  }

  /** Asks the server how much of the image it holds, then sends the rest chunk by chunk. */
  private async putImageInChunks(
    path: string,
    image: ImageFile,
    onProgress: (sentBytes: number) => void,
    signal: AbortSignal,
    sendChunk: SendChunk,
  ): Promise<void> {
    const chunkBytes = this.options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    const status: UploadStatus = (await (await this.request('GET', `${path}/upload`, signal)).json()) ?? {};
    let received = status.received ?? 0;
    let complete = status.complete === true;
    let conflicts = 0;

    while (!complete) {
      // The server holds every byte but hasn't registered the image (a connection died at the very end):
      // repeating the last byte makes it finalize.
      received = Math.min(received, image.bytes - 1);
      onProgress(received);
      const end = Math.min(received + chunkBytes, image.bytes);
      const response = await sendChunk({
        url: `${this.options.baseUrl}${path}`,
        headers: {
          'x-api-key': this.options.apiKey,
          'content-type': image.mime,
          'content-range': `bytes ${received}-${end - 1}/${image.bytes}`,
        },
        image,
        start: received,
        end,
        signal,
      });
      const body = response.body as UploadStatus | undefined;

      if (response.status === 409 && typeof body?.received === 'number') {
        // Out of step with the server (a gap, or another chunk still landing): realign to its offset.
        if (++conflicts > MAX_CONFLICTS) {
          throw new HttpError(409, body);
        }
        received = body.received;
        if (body.busy) {
          await wait(this.options.busyWaitMs ?? 500);
        }
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new HttpError(response.status, response.body);
      }
      conflicts = 0;
      received = typeof body?.received === 'number' ? body.received : end;
      complete = body?.complete === true;
    }
    onProgress(image.bytes);
  }

  private async request(
    method: string,
    path: string,
    signal: AbortSignal,
    body?: RequestInit['body'],
    contentType?: string,
  ): Promise<Response> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      signal,
      body,
      headers: { 'x-api-key': this.options.apiKey, ...(contentType ? { 'content-type': contentType } : {}) },
    });
    if (!response.ok) {
      throw new HttpError(response.status, await response.json().catch(() => undefined));
    }
    return response;
  }
}
