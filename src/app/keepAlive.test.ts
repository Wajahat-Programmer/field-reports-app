import type { Report, ReportStatus } from '../core/types';
import { keepAliveText } from './keepAlive';

const report = (status: ReportStatus): Report => ({
  id: Math.random().toString(),
  description: 'x',
  images: [],
  status,
  createdAt: 0,
  uploadedImages: [],
  attempts: 0,
  nextAttemptAt: 0,
});

describe('keepAliveText', () => {
  it('is undefined when nothing is waiting, so the service stops', () => {
    expect(keepAliveText([], true)).toBeUndefined();
    expect(keepAliveText([report('uploaded'), report('failed')], true)).toBeUndefined();
  });

  it('counts queued and uploading reports', () => {
    expect(keepAliveText([report('queued')], true)).toBe('Uploading 1 report');
    expect(keepAliveText([report('queued'), report('uploading'), report('uploaded')], true)).toBe('Uploading 2 reports');
  });

  it('does not claim to be uploading when offline', () => {
    expect(keepAliveText([report('queued'), report('queued')], false)).toBe('2 reports saved, waiting for a connection');
  });
});
