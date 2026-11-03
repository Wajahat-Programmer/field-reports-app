import type { RunnerState } from '../core/runner';
import type { Report, ReportStatus } from '../core/types';
import { retryInSeconds, summarize } from './status';

const online: RunnerState = { online: true, authBlocked: false, running: false };
const offline: RunnerState = { ...online, online: false };

const report = (status: ReportStatus, extra: Partial<Report> = {}): Report => ({
  id: Math.random().toString(),
  description: 'x',
  images: [],
  status,
  createdAt: 0,
  uploadedImages: [],
  attempts: 0,
  nextAttemptAt: 0,
  ...extra,
});

describe('summarize', () => {
  it('says everything is delivered when nothing is pending', () => {
    expect(summarize([], online).tone).toBe('ok');
    expect(summarize([report('uploaded')], online).tone).toBe('ok');
  });

  it('says saved, never uploaded, for waiting reports', () => {
    const s = summarize([report('queued'), report('queued')], online);
    expect(s.title).toBe('2 reports saved on this phone, not uploaded yet');
    expect(s.tone).toBe('warn');
  });

  it('reports offline with the count of saved reports', () => {
    const s = summarize([report('queued')], offline);
    expect(s.title).toBe('Offline: 1 report saved on this phone');
    expect(s.tone).toBe('warn');
  });

  it('stays calm when offline with nothing waiting', () => {
    expect(summarize([], offline).tone).toBe('ok');
  });

  it('shows uploading as busy', () => {
    expect(summarize([report('uploading'), report('queued')], online)).toMatchObject({ tone: 'busy', title: 'Uploading 2 reports' });
  });

  it('mentions retries on a poor connection', () => {
    expect(summarize([report('queued', { attempts: 2 })], online).detail).toMatch(/Retrying automatically/);
  });

  it('rejections take priority over waiting and keep the work visible', () => {
    const s = summarize([report('failed'), report('queued')], online);
    expect(s).toMatchObject({ tone: 'error', title: '1 report rejected by the server' });
    expect(s.detail).toMatch(/saved on this phone/);
  });

  it('a rejected key beats everything and says the work is still saved', () => {
    const s = summarize([report('queued'), report('failed')], { ...online, authBlocked: true });
    expect(s.title).toBe("Can't sign in to the server");
    expect(s.detail).toMatch(/2 reports saved on this phone/);
  });
});

describe('retryInSeconds', () => {
  it('counts down to the next attempt', () => {
    expect(retryInSeconds(report('queued', { nextAttemptAt: 5500 }), 1000)).toBe(5);
  });
  it('is undefined when nothing is scheduled', () => {
    expect(retryInSeconds(report('queued'), 1000)).toBeUndefined();
    expect(retryInSeconds(report('uploading', { nextAttemptAt: 9999 }), 1000)).toBeUndefined();
  });
});
