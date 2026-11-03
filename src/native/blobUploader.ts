import ReactNativeBlobUtil from 'react-native-blob-util';

import type { SendImage } from '../core/httpTransport';

const toPath = (uri: string) => uri.replace(/^file:\/\//, '');

/** Streams the file straight from disk (never through JS memory) and reports bytes sent. */
export const blobSendImage: SendImage = async ({ url, headers, image, onProgress, signal }) => {
  const task = ReactNativeBlobUtil.fetch('PUT', url, headers, ReactNativeBlobUtil.wrap(toPath(image.uri)));
  task.uploadProgress({ interval: 250 }, sent => onProgress(sent));
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
  }
};
