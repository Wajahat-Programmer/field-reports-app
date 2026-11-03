import { HttpError } from './errors';
import { UploadRunner } from './runner';
import type { RunnerEvent } from './runner';
import { FakeNetwork, FakeServer, FakeTransport, MemoryStore } from './testing/fakes';
import type { ImageFile } from './types';
import { MAX_IMAGE_BYTES, ValidationError } from './validation';

const image = (bytes = 1000): ImageFile => ({ uri: 'file:///a.jpg', mime: 'image/jpeg', bytes });
const input = (images = 1) => ({ description: 'cracked pipe', images: Array.from({ length: images }, () => image()) });
const networkError = () => new TypeError('Network request failed');

function setup(options: { online?: boolean; store?: MemoryStore; server?: FakeServer; stallMs?: number; backoff?: (n: number) => number; idPrefix?: string } = {}) {
  const store = options.store ?? new MemoryStore();
  const server = options.server ?? new FakeServer();
  const transport = new FakeTransport(server);
  const network = new FakeNetwork(options.online ?? true);
  let n = 0;
  const runner = new UploadRunner({
    store,
    transport,
    network,
    newId: () => `${options.idPrefix ?? 'id'}-${++n}`,
    stallMs: options.stallMs,
    backoff: options.backoff,
  });
  return { store, server, transport, network, runner };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('delivery', () => {
  it('uploads a report and marks it uploaded', async () => {
    const { runner, server, store } = setup();
    await runner.start();
    const report = await runner.enqueue(input(2));
    await runner.whenIdle();

    expect((await store.get(report.id))?.status).toBe('uploaded');
    expect(server.completed()).toEqual([report.id]);
    expect(server.imageUploads[`${report.id}/0`]).toBe(1);
    expect(server.imageUploads[`${report.id}/1`]).toBe(1);
  });

  it('reports go through saved, uploading, uploaded in order', async () => {
    const { runner } = setup();
    const statuses: string[] = [];
    runner.subscribe((e: RunnerEvent) => {
      if (e.type === 'report' && statuses[statuses.length - 1] !== e.report.status) {
        statuses.push(e.report.status);
      }
    });
    await runner.start();
    await runner.enqueue(input());
    await runner.whenIdle();
    expect(statuses).toEqual(['queued', 'uploading', 'uploaded']);
  });

  it('holds three reports while offline, then sends each exactly once, oldest first', async () => {
    const { runner, server, network, store } = setup({ online: false });
    await runner.start();
    const a = await runner.enqueue(input(5));
    const b = await runner.enqueue(input());
    const c = await runner.enqueue(input(2));
    await runner.whenIdle();
    expect(server.calls.putReport).toBe(0);
    expect((await store.list()).map(r => r.status)).toEqual(['queued', 'queued', 'queued']);

    network.set(true);
    await runner.whenIdle();

    expect([...server.reports.keys()]).toEqual([a.id, b.id, c.id]);
    expect(server.completed()).toHaveLength(3);
    expect(server.calls.putImage).toBe(8);
  });

  it('never runs two passes at once', async () => {
    const { runner, server } = setup();
    await runner.start();
    await runner.enqueue(input());
    await runner.enqueue(input());
    await runner.enqueue(input());
    await Promise.all([runner.resume(), runner.resume(), runner.resume()]);
    await runner.whenIdle();
    expect(server.calls.putReport).toBe(3);
  });
});

describe('enqueue validation', () => {
  it.each([
    ['blank description', { description: ' ', images: [image()] }],
    ['no images', { description: 'x', images: [] }],
    ['six images', input(6)],
    ['an image over 5 MB', { description: 'x', images: [image(MAX_IMAGE_BYTES + 1)] }],
  ])('rejects %s without saving or sending anything', async (_name, bad) => {
    const { runner, store, server } = setup();
    await runner.start();
    await expect(runner.enqueue(bad)).rejects.toBeInstanceOf(ValidationError);
    expect(await store.list()).toEqual([]);
    expect(server.calls.putReport).toBe(0);
  });
});

describe('surviving a kill', () => {
  it('a new runner on the same store resumes an interrupted upload without resending finished images', async () => {
    const first = setup({ idPrefix: 'a' });
    first.transport.inject('putImage', 'hang', 1);
    await first.runner.start();
    const report = await first.runner.enqueue(input(3));
    await jest.advanceTimersByTimeAsync(1);

    const saved = await first.store.get(report.id);
    expect(saved?.status).toBe('uploading');
    expect(saved?.uploadedImages).toEqual([0]);
    first.runner.stop(); // the "force-quit"

    const second = setup({ store: first.store, server: first.server, idPrefix: 'b' });
    await second.runner.start();
    await second.runner.whenIdle();

    expect((await first.store.get(report.id))?.status).toBe('uploaded');
    expect(first.server.completed()).toEqual([report.id]);
    expect(first.server.imageUploads[`${report.id}/0`]).toBe(1);
    expect(first.server.imageUploads[`${report.id}/1`]).toBe(1);
    expect(first.server.imageUploads[`${report.id}/2`]).toBe(1);
  });
});

describe('failures', () => {
  it('a lost reply to complete is retried and the server still holds one report', async () => {
    const { runner, server, transport, store } = setup();
    transport.inject('complete', 'lose');
    await runner.start();
    const report = await runner.enqueue(input());
    await runner.whenIdle();

    expect((await store.get(report.id))?.status).toBe('queued');
    expect(server.completed()).toEqual([report.id]); // the server did commit

    await jest.advanceTimersByTimeAsync(2000);
    await runner.whenIdle();

    expect((await store.get(report.id))?.status).toBe('uploaded');
    expect(server.reports.size).toBe(1);
    expect(server.completed()).toEqual([report.id]);
  });

  it('retries server errors with growing backoff, then resets the count on success', async () => {
    const { runner, transport, server, store } = setup({ backoff: n => n * 1000 });
    transport.inject('putReport', new HttpError(503));
    transport.inject('putReport', new HttpError(500));
    await runner.start();
    const report = await runner.enqueue(input());
    await runner.whenIdle();

    let saved = await store.get(report.id);
    expect(saved?.attempts).toBe(1);
    expect(saved!.nextAttemptAt - Date.now()).toBe(1000);

    await jest.advanceTimersByTimeAsync(1000);
    await runner.whenIdle();
    saved = await store.get(report.id);
    expect(saved?.attempts).toBe(2);
    expect(saved!.nextAttemptAt - Date.now()).toBe(2000);

    await jest.advanceTimersByTimeAsync(2000);
    await runner.whenIdle();
    saved = await store.get(report.id);
    expect(saved?.status).toBe('uploaded');
    expect(saved?.attempts).toBe(0);
    expect(server.calls.putReport).toBe(3);
  });

  it('does not retry a permanent rejection, and retry() puts it back', async () => {
    const { runner, transport, server, store } = setup();
    transport.inject('putImage', new HttpError(413), 0);
    await runner.start();
    const report = await runner.enqueue(input());
    await runner.whenIdle();

    expect((await store.get(report.id))?.status).toBe('failed');
    expect((await store.get(report.id))?.lastError).toBe('HTTP 413');
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(server.calls.putImage).toBe(1);

    await runner.retry(report.id);
    await runner.whenIdle();
    expect((await store.get(report.id))?.status).toBe('uploaded');
  });

  it('aborts a request that stalls and tries again', async () => {
    const { runner, transport, server, store } = setup({ stallMs: 5000, backoff: () => 500 });
    transport.inject('putImage', 'hang', 0);
    await runner.start();
    const report = await runner.enqueue(input());

    await jest.advanceTimersByTimeAsync(5000);
    expect((await store.get(report.id))?.status).toBe('queued');
    expect((await store.get(report.id))?.attempts).toBe(1);

    await jest.advanceTimersByTimeAsync(500);
    await runner.whenIdle();
    expect((await store.get(report.id))?.status).toBe('uploaded');
    expect(server.calls.putReport).toBe(2);
  });

  it('going offline mid-upload pauses, and coming back resumes at once without redoing finished images', async () => {
    const { runner, transport, network, server, store } = setup();
    transport.inject('putImage', networkError(), 1, () => network.set(false));
    await runner.start();
    const report = await runner.enqueue(input(3));
    await runner.whenIdle();

    expect((await store.get(report.id))?.status).toBe('queued');
    const callsWhileOffline = server.calls.putImage;
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(server.calls.putImage).toBe(callsWhileOffline);

    network.set(true); // no timer advance: backoff must be skipped
    await runner.whenIdle();

    expect((await store.get(report.id))?.status).toBe('uploaded');
    expect(server.imageUploads[`${report.id}/0`]).toBe(1);
    expect(server.imageUploads[`${report.id}/1`]).toBe(1);
    expect(server.imageUploads[`${report.id}/2`]).toBe(1);
  });

  it('a rejected key pauses the queue without dropping the report, until resume()', async () => {
    const { runner, transport, server, store } = setup();
    transport.inject('putReport', new HttpError(401));
    await runner.start();
    const report = await runner.enqueue(input());
    await runner.whenIdle();

    expect(runner.getState().authBlocked).toBe(true);
    expect((await store.get(report.id))?.status).toBe('queued');
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(server.calls.putReport).toBe(1);

    await runner.resume();
    await runner.whenIdle();
    expect(runner.getState().authBlocked).toBe(false);
    expect((await store.get(report.id))?.status).toBe('uploaded');
  });

  it('recovers when the server was wiped after images were already sent', async () => {
    const { runner, transport, server, store } = setup({ backoff: () => 10 });
    transport.inject('complete', 'pass', undefined, () => server.reset());
    await runner.start();
    const report = await runner.enqueue(input(2));
    await runner.whenIdle();
    for (let i = 0; i < 6; i++) {
      await jest.advanceTimersByTimeAsync(20);
      await runner.whenIdle();
    }

    expect((await store.get(report.id))?.status).toBe('uploaded');
    expect(server.completed()).toEqual([report.id]);
    expect(server.reports.get(report.id)?.images.size).toBe(2);
  });
});
