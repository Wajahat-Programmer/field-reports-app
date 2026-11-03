import ReactNativeBlobUtil from 'react-native-blob-util';

import type { SendChunk } from '../core/httpTransport';

const { fs } = ReactNativeBlobUtil;
const toPath = (uri: string) => uri.replace(/^file:\/\//, '');

/** Cuts one slice out of the stored photo and PATCHes it, streaming the slice from disk. */
export const blobSendChunk: SendChunk = async ({ url, headers, image, start, end, signal }) => {
  const slice = `${fs.dirs.CacheDir}/chunk-${Date.now()}-${start}.bin`;
  await fs.slice(toPath(image.uri), slice, start, end);
  const task = ReactNativeBlobUtil.fetch('PATCH', url, headers, ReactNativeBlobUtil.wrap(slice));
  const cancel = () => task.cancel();
  if (signal.aborted) {
    cancel();
  } else {
    signal.addEventListener('abort', cancel);
  }
  try {
    const response = await task;
    let body: unknown;
    try {
      body = response.json();
    } catch {
      body = undefined;
    }
    return { status: response.info().status, body };
  } finally {
    signal.removeEventListener('abort', cancel);
    fs.unlink(slice).catch(() => {});
  }
};
