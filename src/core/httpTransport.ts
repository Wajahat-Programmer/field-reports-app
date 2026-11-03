import { HttpError } from './errors';
import type { Transport } from './ports';
import type { ImageFile } from './types';

export interface SendImageRequest {
  url: string;
  headers: Record<string, string>;
  image: ImageFile;
  onProgress: (sentBytes: number) => void;
  signal: AbortSignal;
}

/** Streams one image to the server. Must resolve (not throw) on any HTTP status; reject only on network failure. */
export type SendImage = (request: SendImageRequest) => Promise<{ status: number; body?: unknown }>;

export interface HttpTransportOptions {
  baseUrl: string;
  apiKey: string;
  /** Uploads an image with progress (the app's native uploader). Without it, `readImage` + fetch is used. */
  sendImage?: SendImage;
  /** Reads an image into a fetch body. Injected because file access differs between the app and tests. */
  readImage?: (image: ImageFile) => Promise<NonNullable<RequestInit['body']>>;
  fetchImpl?: typeof fetch;
}

export class HttpTransport implements Transport {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  putReport(id: string, body: { description: string; imageCount: number }, signal: AbortSignal): Promise<void> {
    return this.request('PUT', `/reports/${id}`, signal, JSON.stringify(body), 'application/json');
  }

  async putImage(
    id: string,
    index: number,
    image: ImageFile,
    onProgress: (sentBytes: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const path = `/reports/${id}/images/${index}`;
    const { sendImage, readImage } = this.options;
    if (sendImage) {
      const response = await sendImage({
        url: `${this.options.baseUrl}${path}`,
        headers: { 'x-api-key': this.options.apiKey, 'content-type': image.mime },
        image,
        onProgress,
        signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new HttpError(response.status, response.body);
      }
      return;
    }
    if (!readImage) {
      throw new Error('HttpTransport needs sendImage or readImage');
    }
    await this.request('PUT', path, signal, await readImage(image), image.mime);
    // plain fetch gives no upload progress, so report completion only
    onProgress(image.bytes);
  }

  complete(id: string, signal: AbortSignal): Promise<void> {
    return this.request('POST', `/reports/${id}/complete`, signal);
  }

  private async request(
    method: string,
    path: string,
    signal: AbortSignal,
    body?: RequestInit['body'],
    contentType?: string,
  ): Promise<void> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      signal,
      body,
      headers: { 'x-api-key': this.options.apiKey, ...(contentType ? { 'content-type': contentType } : {}) },
    });
    if (!response.ok) {
      throw new HttpError(response.status, await response.json().catch(() => undefined));
    }
  }
}
