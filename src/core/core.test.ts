import { backoffMs } from './backoff';
import { classify, HttpError, StallError } from './errors';
import type { ImageFile } from './types';
import { MAX_IMAGE_BYTES, validateNewReport, ValidationError } from './validation';

const image = (bytes = 1000): ImageFile => ({ uri: 'file:///a.jpg', mime: 'image/jpeg', bytes });

describe('classify', () => {
  it.each([
    [500, 'retry'],
    [502, 'retry'],
    [503, 'retry'],
    [408, 'retry'],
    [429, 'retry'],
    [404, 'retry'],
    [400, 'fatal'],
    [409, 'fatal'],
    [413, 'fatal'],
    [415, 'fatal'],
    [401, 'auth'],
    [403, 'auth'],
  ])('HTTP %i is %s', (status, verdict) => {
    expect(classify(new HttpError(status))).toBe(verdict);
  });

  it('retries network failures and stalls', () => {
    expect(classify(new TypeError('Network request failed'))).toBe('retry');
    expect(classify(new StallError())).toBe('retry');
  });
});

describe('backoffMs', () => {
  it('doubles per attempt within the jitter band', () => {
    expect(backoffMs(1, () => 1)).toBe(1000);
    expect(backoffMs(1, () => 0)).toBe(500);
    expect(backoffMs(3, () => 1)).toBe(4000);
  });

  it('never exceeds five minutes', () => {
    expect(backoffMs(40, () => 1)).toBe(300_000);
    expect(backoffMs(40, () => 0)).toBe(150_000);
  });
});

describe('validateNewReport', () => {
  const ok = { description: 'cracked pipe', images: [image()] };

  it('accepts one to five images', () => {
    for (let n = 1; n <= 5; n++) {
      expect(() => validateNewReport({ ...ok, images: Array.from({ length: n }, () => image()) })).not.toThrow();
    }
  });

  it.each([
    ['a blank description', { ...ok, description: '   ' }],
    ['zero images', { ...ok, images: [] }],
    ['a sixth image', { ...ok, images: Array.from({ length: 6 }, () => image()) }],
    ['an image over 5 MB', { ...ok, images: [image(MAX_IMAGE_BYTES + 1)] }],
    ['an empty image', { ...ok, images: [image(0)] }],
    ['a description over 2000 characters', { ...ok, description: 'x'.repeat(2001) }],
  ])('rejects %s', (_name, input) => {
    expect(() => validateNewReport(input)).toThrow(ValidationError);
  });

  it('accepts an image of exactly 5 MB', () => {
    expect(() => validateNewReport({ ...ok, images: [image(MAX_IMAGE_BYTES)] })).not.toThrow();
  });
});
