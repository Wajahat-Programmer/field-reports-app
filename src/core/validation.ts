import type { NewReport } from './types';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 5;
export const MAX_DESCRIPTION_LENGTH = 2000;
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateNewReport({ description, images }: NewReport): void {
  if (!description.trim()) {
    throw new ValidationError('Add a short description.');
  }
  if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(`Description is limited to ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (images.length < 1) {
    throw new ValidationError('Add at least one photo.');
  }
  if (images.length > MAX_IMAGES) {
    throw new ValidationError(`A report holds at most ${MAX_IMAGES} photos.`);
  }
  for (const image of images) {
    if (!MIMES.includes(image.mime)) {
      throw new ValidationError('Photos must be JPEG, PNG or WebP.');
    }
    if (!(image.bytes > 0) || image.bytes > MAX_IMAGE_BYTES) {
      throw new ValidationError('Each photo must be under 5 MB.');
    }
  }
}
