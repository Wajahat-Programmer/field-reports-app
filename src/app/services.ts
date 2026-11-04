import { createAsyncStorage } from '@react-native-async-storage/async-storage';

import { HttpTransport } from '../core/httpTransport';
import { ReportsApi } from '../core/reportsApi';
import { UploadRunner } from '../core/runner';
import { config } from '../config';
import { AsyncStorageReportStore } from '../native/asyncStorageStore';
import { blobFetch, blobSendChunk } from '../native/blobUploader';
import { NetInfoNetwork } from '../native/netInfoNetwork';
import { createListCache } from './listCache';
import { newId } from './uuid';

/** The real, device-backed services. Everything else in the app talks to these. */
export function createServices() {
  const storage = createAsyncStorage('field-reports');
  const runner = new UploadRunner({
    store: new AsyncStorageReportStore(storage),
    transport: new HttpTransport({ baseUrl: config.baseUrl, apiKey: config.apiKey, sendChunk: blobSendChunk, fetchImpl: blobFetch }),
    network: new NetInfoNetwork(),
    newId,
  });
  const api = new ReportsApi({ baseUrl: config.baseUrl, apiKey: config.apiKey, fetchImpl: blobFetch });
  return { runner, api, listCache: createListCache(storage) };
}

export type Services = ReturnType<typeof createServices>;
