import { classify, HttpError } from './errors';
import { HttpTransport } from './httpTransport';
import type { SendChunk } from './httpTransport';
import type { ImageFile } from './types';

const IMAGE: ImageFile = { uri: 'file:///a.jpg', mime: 'image/jpeg', bytes: 1000 };
const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;

/** A stand-in for the backend's chunk rules, with hooks to misbehave. */
function setup(options: { have?: number; chunkBytes?: number; onChunk?: (call: number, start: number, end: number) => ReturnType<SendChunk> | undefined } = {}) {
  const state = { have: options.have ?? 0, ranges: [] as [number, number][], progress: [] as number[], calls: 0 };
  const fetchImpl = jest.fn(async (url: string) => {
    if (String(url).endsWith('/upload')) {
      return json({ received: state.have, complete: state.have >= IMAGE.bytes });
    }
    return json({});
  });
  const sendChunk: SendChunk = async ({ start, end }) => {
    const call = ++state.calls;
    const scripted = options.onChunk?.(call, start, end);
    if (scripted) {
      return scripted;
    }
    state.ranges.push([start, end]);
    if (start > state.have) {
      return { status: 409, body: { received: state.have } };
    }
    state.have = Math.max(state.have, end);
    return { status: 200, body: { received: state.have, complete: state.have >= IMAGE.bytes } };
  };
  const transport = new HttpTransport({
    baseUrl: 'https://x.test',
    apiKey: 'k',
    sendChunk,
    chunkBytes: options.chunkBytes ?? 300,
    busyWaitMs: 0,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const put = () => transport.putImage('id', 0, IMAGE, sent => state.progress.push(sent), new AbortController().signal);
  return { state, put, fetchImpl };
}

describe('HttpTransport chunked upload', () => {
  it('sends the image as consecutive ranges and reports server-confirmed progress', async () => {
    const { state, put } = setup();
    await put();
    expect(state.ranges).toEqual([[0, 300], [300, 600], [600, 900], [900, 1000]]);
    expect(state.progress[0]).toBe(0);
    expect(state.progress[state.progress.length - 1]).toBe(1000);
    expect([...state.progress].sort((a, b) => a - b)).toEqual(state.progress); // never goes backwards
  });

  it('sends the right headers on every chunk', async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async () => json({ received: 0, complete: false })) as unknown as typeof fetch;
    const transport = new HttpTransport({
      baseUrl: 'https://x.test',
      apiKey: 'secret',
      chunkBytes: 600,
      fetchImpl,
      sendChunk: async ({ headers, end }) => {
        seen.push(headers);
        return { status: 200, body: { received: end, complete: end >= 1000 } };
      },
    });
    await transport.putImage('id', 0, IMAGE, () => {}, new AbortController().signal);
    expect(seen[0]).toEqual({ 'x-api-key': 'secret', 'content-type': 'image/jpeg', 'content-range': 'bytes 0-599/1000' });
    expect(seen[1]['content-range']).toBe('bytes 600-999/1000');
  });

  it('resumes from what the server already has', async () => {
    const { state, put } = setup({ have: 600 });
    await put();
    expect(state.ranges).toEqual([[600, 900], [900, 1000]]);
  });

  it('does nothing when the server already has the whole image', async () => {
    const { state, put } = setup({ have: 1000 });
    await put();
    expect(state.ranges).toEqual([]);
  });

  it('nudges the server when it holds every byte but never registered the image', async () => {
    const ranges: [number, number][] = [];
    // "all bytes, not complete": what the offset request says after a connection died at the very end
    const fetchImpl = (async () => json({ received: 1000, complete: false })) as unknown as typeof fetch;
    const transport = new HttpTransport({
      baseUrl: 'https://x.test',
      apiKey: 'k',
      fetchImpl,
      sendChunk: async ({ start, end }) => {
        ranges.push([start, end]);
        return { status: 200, body: { received: 1000, complete: true } };
      },
    });
    await transport.putImage('id', 0, IMAGE, () => {}, new AbortController().signal);
    expect(ranges).toEqual([[999, 1000]]);
  });

  it('after a failure, the next attempt continues without resending confirmed chunks', async () => {
    const { state, put } = setup({
      onChunk: call => (call === 3 ? Promise.reject(new TypeError('Network request failed')) : undefined),
    });
    await expect(put()).rejects.toThrow('Network request failed');
    expect(state.have).toBe(600);

    await put();
    expect(state.ranges).toEqual([[0, 300], [300, 600], [600, 900], [900, 1000]]); // each range sent exactly once
  });

  it('realigns when the server is behind what we thought', async () => {
    const { state, put } = setup({
      onChunk: call => (call === 2 ? Promise.resolve({ status: 409, body: { received: 100 } }) : undefined),
    });
    await put();
    expect(state.ranges).toEqual([[0, 300], [100, 400], [400, 700], [700, 1000]]);
  });

  it('waits and retries when another chunk is still being written', async () => {
    const { state, put } = setup({
      onChunk: call => (call === 1 ? Promise.resolve({ status: 409, body: { received: 0, busy: true } }) : undefined),
    });
    await put();
    expect(state.have).toBe(1000);
  });

  it('gives up after repeated conflicts instead of looping forever, and the failure is retryable', async () => {
    const { put } = setup({ onChunk: () => Promise.resolve({ status: 409, body: { received: 0, busy: true } }) });
    const failure = await put().catch(e => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpError);
    expect(classify(failure)).toBe('retry'); // a drop must never become a permanent rejection
  });

  it.each([413, 500, 502])('turns HTTP %i into an HttpError', async status => {
    const { put } = setup({ onChunk: () => Promise.resolve({ status, body: {} }) });
    await expect(put()).rejects.toBeInstanceOf(HttpError);
  });

  it('fails clearly when the offset request fails', async () => {
    const fetchImpl = (async () => json({}, 503)) as unknown as typeof fetch;
    const transport = new HttpTransport({ baseUrl: 'https://x.test', apiKey: 'k', fetchImpl, sendChunk: async () => ({ status: 200 }) });
    await expect(transport.putImage('id', 0, IMAGE, () => {}, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  });
});
