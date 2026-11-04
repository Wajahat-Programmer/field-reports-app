import ReactNativeBlobUtil from 'react-native-blob-util';

import type { SendChunk } from '../core/httpTransport';

const { fs } = ReactNativeBlobUtil;
const toPath = (uri: string) => uri.replace(/^file:\/\//, '');

/**
 * Every request in the app goes through blob-util, so they all share one connection pool. After a network
 * drop the pooled connection can be dead while still looking alive; with this timeout the first request to hit
 * it gives up in seconds (the library default is 60 s), and the dead connection is dropped from the pool.
 */
const REQUEST_TIMEOUT_MS = 25_000;
const client = () => ReactNativeBlobUtil.config({ timeout: REQUEST_TIMEOUT_MS });

/** A fetch-shaped wrapper (ok, status, json) so the transport and the list client can use blob-util. */
export const blobFetch = (async (url: string, init: RequestInit = {}) => {
  const task = client().fetch(
    (init.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH',
    url,
    (init.headers ?? {}) as Record<string, string>,
    (init.body as string | undefined) ?? '',
  );
  const { signal } = init;
  const cancel = () => task.cancel();
  if (signal?.aborted) {
    cancel();
  } else {
    signal?.addEventListener('abort', cancel);
  }
  try {
    const response = await task;
    const status = response.info().status;
    return { ok: status >= 200 && status < 300, status, json: async () => response.json() } as unknown as Response;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}) as typeof fetch;

/** Cuts one slice out of the stored photo and PATCHes it, streaming the slice from disk. */
export const blobSendChunk: SendChunk = async ({ url, headers, image, start, end, signal }) => {
  const slice = `${fs.dirs.CacheDir}/chunk-${Date.now()}-${start}.bin`;
  await fs.slice(toPath(image.uri), slice, start, end);
  const task = client().fetch('PATCH', url, headers, ReactNativeBlobUtil.wrap(slice));
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
