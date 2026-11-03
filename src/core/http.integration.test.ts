/**
 * Runs the real upload runner against the real backend (../field-reports-backend) with its
 * fault switches. Skipped when that folder isn't next to this repo.
 *
 * @jest-environment node
 */
// @ts-nocheck - dev-only Node test; Node's global types clash with React Native's (AbortSignal).
import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { HttpTransport } from './httpTransport';
import type { Transport } from './ports';
import { UploadRunner } from './runner';
import { FakeNetwork, MemoryStore } from './testing/fakes';
import type { ImageFile } from './types';

const backendDir = path.resolve(__dirname, '../../../field-reports-backend');
const describeIfBackend = fs.existsSync(path.join(backendDir, 'src/index.js')) ? describe : describe.skip;

const API_KEY = 'integration-key';
const PORT = 40000 + Math.floor(Math.random() * 10000);
const BASE = `http://127.0.0.1:${PORT}`;
const admin = (method: string, url: string, body?: object) =>
  fetch(BASE + url, {
    method,
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });

type Method = 'putReport' | 'putImage' | 'complete';

/** Arms a one-shot backend fault right before a given call, so a test can hit that exact request. */
class ArmedTransport implements Transport {
  armed: Partial<Record<Method, object>> = {};
  constructor(private inner: Transport) {}

  private async arm(method: Method) {
    const fault = this.armed[method];
    if (fault) {
      delete this.armed[method];
      await admin('PUT', '/admin/faults', fault);
    }
  }
  async putReport(...args: Parameters<Transport['putReport']>) {
    await this.arm('putReport');
    return this.inner.putReport(...args);
  }
  async putImage(...args: Parameters<Transport['putImage']>) {
    await this.arm('putImage');
    return this.inner.putImage(...args);
  }
  async complete(...args: Parameters<Transport['complete']>) {
    await this.arm('complete');
    return this.inner.complete(...args);
  }
}

describeIfBackend('upload runner against the real backend', () => {
  let backend: ChildProcess;
  let dataDir: string;
  const bytes = new Map<string, Buffer>();

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'field-int-'));
    backend = spawn(process.execPath, ['src/index.js'], {
      cwd: backendDir,
      env: { ...process.env, API_KEY, PORT: String(PORT), DATA_DIR: dataDir },
      stdio: 'ignore',
    });
    for (let i = 0; i < 150; i++) {
      if (await fetch(`${BASE}/health`).then(r => r.ok, () => false)) {
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }
    throw new Error('backend did not start');
  }, 30000);

  afterAll(() => {
    backend?.kill();
  });

  beforeEach(async () => {
    await admin('DELETE', '/admin/faults');
    await admin('DELETE', '/reports');
  });

  function setup() {
    const transport = new ArmedTransport(
      new HttpTransport({ baseUrl: BASE, apiKey: API_KEY, readImage: async image => bytes.get(image.uri)! }),
    );
    let n = 0;
    const runner = new UploadRunner({
      store: new MemoryStore(),
      transport,
      network: new FakeNetwork(true),
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      stallMs: 5000,
      backoff: () => 20,
    });
    return { runner, transport };
  }

  const photo = (size: number): ImageFile => {
    const uri = `mem://${bytes.size}`;
    bytes.set(uri, randomBytes(size));
    return { uri, mime: 'image/jpeg', bytes: size };
  };

  async function delivered(runner: UploadRunner, id: string) {
    for (let i = 0; i < 300; i++) {
      await runner.whenIdle();
      const report = (await runner.list()).find(r => r.id === id);
      if (report?.status === 'uploaded' || report?.status === 'failed') {
        return report;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
    throw new Error('report was never delivered');
  }

  async function serverReports() {
    return (await (await admin('GET', '/reports')).json()).reports as { id: string; images: { url: string; bytes: number }[] }[];
  }

  it('delivers a report with intact images', async () => {
    const { runner } = setup();
    const images = [photo(200_000), photo(300_000)];
    await runner.start();
    const report = await runner.enqueue({ description: 'cracked pipe', images });
    expect((await delivered(runner, report.id)).status).toBe('uploaded');

    const reports = await serverReports();
    expect(reports).toHaveLength(1);
    for (let i = 0; i < images.length; i++) {
      const stored = Buffer.from(await (await admin('GET', reports[0].images[i].url)).arrayBuffer());
      expect(stored.equals(bytes.get(images[i].uri)!)).toBe(true);
    }
  });

  it('a lost reply to complete leaves exactly one report after the retry', async () => {
    const { runner, transport } = setup();
    transport.armed.complete = { mode: 'lostResponse', count: 1 };
    await runner.start();
    const report = await runner.enqueue({ description: 'cracked pipe', images: [photo(100_000)] });
    expect((await delivered(runner, report.id)).status).toBe('uploaded');
    expect(await serverReports()).toHaveLength(1);
  });

  it('a connection dropped mid-upload is retried and the image arrives whole', async () => {
    const { runner, transport } = setup();
    transport.armed.putImage = { mode: 'dropMidUpload', dropAfterBytes: 1000, count: 1 };
    const images = [photo(400_000)];
    await runner.start();
    const report = await runner.enqueue({ description: 'cracked pipe', images });
    expect((await delivered(runner, report.id)).status).toBe('uploaded');

    const reports = await serverReports();
    expect(reports).toHaveLength(1);
    const stored = Buffer.from(await (await admin('GET', reports[0].images[0].url)).arrayBuffer());
    expect(stored.equals(bytes.get(images[0].uri)!)).toBe(true);
  });

  it('retries injected server errors, then delivers once', async () => {
    const { runner, transport } = setup();
    transport.armed.putReport = { mode: 'error', status: 503, count: 2 };
    await runner.start();
    const report = await runner.enqueue({ description: 'cracked pipe', images: [photo(50_000)] });
    const done = await delivered(runner, report.id);
    expect(done.status).toBe('uploaded');
    expect(await serverReports()).toHaveLength(1);
  });

  it('a hung server is abandoned after the stall timeout and the retry succeeds', async () => {
    const { runner, transport } = setup();
    transport.armed.putReport = { mode: 'hang', count: 1 };
    await runner.start();
    const report = await runner.enqueue({ description: 'cracked pipe', images: [photo(50_000)] });
    expect((await delivered(runner, report.id)).status).toBe('uploaded');
    expect(await serverReports()).toHaveLength(1);
  }, 20000);
});
