import { createAsyncStorage } from '@react-native-async-storage/async-storage';

import { HttpTransport } from '../core/httpTransport';
import { ReportsApi } from '../core/reportsApi';
import { UploadRunner } from '../core/runner';
import { config } from '../config';
import { AsyncStorageReportStore } from '../native/asyncStorageStore';
import { blobSendImage } from '../native/blobUploader';
import { NetInfoNetwork } from '../native/netInfoNetwork';
import { newId } from './uuid';

/** The real, device-backed services. Everything else in the app talks to these. */
export function createServices() {
  const runner = new UploadRunner({
    store: new AsyncStorageReportStore(createAsyncStorage('field-reports')),
    transport: new HttpTransport({ baseUrl: config.baseUrl, apiKey: config.apiKey, sendImage: blobSendImage }),
    network: new NetInfoNetwork(),
    newId,
  });
  const api = new ReportsApi({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  return { runner, api };
}

export type Services = ReturnType<typeof createServices>;
