import type { ImageFile } from './types';
import { MAX_IMAGE_BYTES } from './validation';

export interface ResizedImage {
  uri: string;
  bytes: number;
}

/** Re-encodes a photo as a JPEG that fits within `maxDimension` on both sides. */
export type Resizer = (sourceUri: string, maxDimension: number, quality: number) => Promise<ResizedImage>;

export class ImageTooLargeError extends Error {
  constructor() {
    super('This photo could not be made small enough to send.');
    this.name = 'ImageTooLargeError';
  }
}

// Aim well below the 5 MB cap so the app never sends one over it. Each step is smaller than the last;
// the first usually fits (a 12 MP camera photo comes out around 1 MB).
const TARGET_BYTES = 4 * 1024 * 1024;
const STEPS: [maxDimension: number, quality: number][] = [
  [2048, 82],
  [2048, 70],
  [1600, 70],
  [1280, 60],
  [1024, 50],
];

if (TARGET_BYTES >= MAX_IMAGE_BYTES) {
  throw new Error('TARGET_BYTES must stay under MAX_IMAGE_BYTES');
}

/** Produces a sendable image from any photo, discarding every attempt that came out too big. */
export async function prepareImage(
  sourceUri: string,
  resize: Resizer,
  discard: (uri: string) => Promise<void>,
): Promise<ImageFile> {
  for (const [maxDimension, quality] of STEPS) {
    const result = await resize(sourceUri, maxDimension, quality);
    if (result.bytes > 0 && result.bytes <= TARGET_BYTES) {
      return { uri: result.uri, mime: 'image/jpeg', bytes: result.bytes };
    }
    await discard(result.uri);
  }
  throw new ImageTooLargeError();
}
