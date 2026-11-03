import { HttpError } from './errors';
import type { Transport } from './ports';
import type { ImageFile } from './types';

export interface HttpTransportOptions {
  baseUrl: string;
  apiKey: string;
  /** Reads an image into a fetch body. Injected because file access differs between the app and tests. */
  readImage: (image: ImageFile) => Promise<NonNullable<RequestInit['body']>>;
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
    const body = await this.options.readImage(image);
    await this.request('PUT', `/reports/${id}/images/${index}`, signal, body, image.mime);
    // fetch gives no upload progress; a native uploader can report it later through the same callback.
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
