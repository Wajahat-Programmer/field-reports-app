import type { AsyncStorage } from '@react-native-async-storage/async-storage';

import type { Report } from '../core/types';
import { AsyncStorageReportStore } from './asyncStorageStore';

function memoryAsyncStorage(): AsyncStorage {
  const data = new Map<string, string>();
  return {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async key => void data.delete(key),
    getMany: async keys => Object.fromEntries(keys.map(key => [key, data.get(key) ?? null])),
    setMany: async entries => void Object.entries(entries).forEach(([k, v]) => data.set(k, v)),
    removeMany: async keys => void keys.forEach(key => data.delete(key)),
    getAllKeys: async () => [...data.keys()],
    clear: async () => data.clear(),
  };
}

const report = (id: string, createdAt = 1): Report => ({
  id,
  description: 'cracked pipe',
  images: [{ uri: 'file:///a.jpg', mime: 'image/jpeg', bytes: 1000 }],
  status: 'queued',
  createdAt,
  uploadedImages: [],
  attempts: 0,
  nextAttemptAt: 0,
});

describe('AsyncStorageReportStore', () => {
  it('saves, reads, lists and removes reports', async () => {
    const store = new AsyncStorageReportStore(memoryAsyncStorage());
    await store.save(report('a'));
    await store.save(report('b', 2));

    expect(await store.get('a')).toEqual(report('a'));
    expect((await store.list()).map(r => r.id).sort()).toEqual(['a', 'b']);

    await store.remove('a');
    expect(await store.get('a')).toBeUndefined();
    expect((await store.list()).map(r => r.id)).toEqual(['b']);
  });

  it('overwrites a report in place', async () => {
    const store = new AsyncStorageReportStore(memoryAsyncStorage());
    await store.save(report('a'));
    await store.save({ ...report('a'), status: 'uploaded' });
    expect(await store.list()).toHaveLength(1);
    expect((await store.get('a'))?.status).toBe('uploaded');
  });

  it('ignores keys that are not reports', async () => {
    const storage = memoryAsyncStorage();
    await storage.setItem('something-else', '{"x":1}');
    const store = new AsyncStorageReportStore(storage);
    await store.save(report('a'));
    expect((await store.list()).map(r => r.id)).toEqual(['a']);
  });
});
