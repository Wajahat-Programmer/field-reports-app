import { ImageTooLargeError, prepareImage } from './imagePipeline';
import type { Resizer } from './imagePipeline';
import { MAX_IMAGE_BYTES } from './validation';

const MB = 1024 * 1024;

function fakeResizer(sizes: number[]) {
  const calls: [number, number][] = [];
  const resize: Resizer = async (_uri, maxDimension, quality) => {
    calls.push([maxDimension, quality]);
    return { uri: `out-${calls.length}.jpg`, bytes: sizes[Math.min(calls.length, sizes.length) - 1] };
  };
  return { resize, calls };
}

describe('prepareImage', () => {
  it('keeps the first result when it is small enough', async () => {
    const { resize, calls } = fakeResizer([MB]);
    const discard = jest.fn(async () => {});
    const image = await prepareImage('file:///camera.jpg', resize, discard);

    expect(image).toEqual({ uri: 'out-1.jpg', mime: 'image/jpeg', bytes: MB });
    expect(calls).toHaveLength(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it('tries harder and discards each attempt that was too big', async () => {
    const { resize, calls } = fakeResizer([9 * MB, 5 * MB, 3 * MB]);
    const discard = jest.fn(async () => {});
    const image = await prepareImage('file:///camera.jpg', resize, discard);

    expect(image.uri).toBe('out-3.jpg');
    expect(image.bytes).toBe(3 * MB);
    expect(discard.mock.calls).toEqual([['out-1.jpg'], ['out-2.jpg']]);
    // each retry shrinks the dimensions or the quality, never grows them
    expect(calls[1][1]).toBeLessThan(calls[0][1]);
    expect(calls[2][0]).toBeLessThan(calls[1][0]);
  });

  it('gives up with a clear error and leaves no files behind', async () => {
    const { resize } = fakeResizer([20 * MB]);
    const discard = jest.fn(async () => {});
    await expect(prepareImage('file:///huge.jpg', resize, discard)).rejects.toBeInstanceOf(ImageTooLargeError);
    expect(discard).toHaveBeenCalledTimes(5);
  });

  it('never returns an image over the 5 MB cap', async () => {
    for (const size of [MB, 3 * MB, 4 * MB]) {
      const image = await prepareImage('x', fakeResizer([size]).resize, async () => {});
      expect(image.bytes).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    }
    await expect(prepareImage('x', fakeResizer([4.5 * MB]).resize, async () => {})).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it('treats an empty output as a failed attempt', async () => {
    const { resize } = fakeResizer([0, MB]);
    const image = await prepareImage('x', resize, async () => {});
    expect(image.uri).toBe('out-2.jpg');
  });

  it('passes a resizer failure straight through', async () => {
    const resize: Resizer = async () => {
      throw new Error('not an image');
    };
    await expect(prepareImage('x', resize, async () => {})).rejects.toThrow('not an image');
  });
});
