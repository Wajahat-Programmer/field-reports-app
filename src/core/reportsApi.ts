import { HttpError } from './errors';

export interface ServerReport {
  id: string;
  description: string;
  imageCount: number;
  completedAt: string;
  images: { index: number; bytes: number; url: string }[];
}

export interface ReportsApiOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** Read side of the backend: what the server actually holds. */
export class ReportsApi {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ReportsApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async list(signal?: AbortSignal): Promise<ServerReport[]> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/reports`, {
      signal,
      headers: { 'x-api-key': this.options.apiKey },
    });
    if (!response.ok) {
      throw new HttpError(response.status);
    }
    return (await response.json()).reports;
  }

  /** An image source for <Image>, which needs the key header to load from the server. */
  imageSource(url: string) {
    return { uri: `${this.options.baseUrl}${url}`, headers: { 'x-api-key': this.options.apiKey } };
  }
}
