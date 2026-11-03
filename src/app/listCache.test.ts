import type { AsyncStorage } from '@react-native-async-storage/async-storage';

import type { ServerReport } from '../core/reportsApi';
import { createListCache } from './listCache';

function memoryStorage(initial: Record<string, string> = {}): AsyncStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async key => void data.delete(key),
    getMany: async keys => Object.fromEntries(keys.map(key => [key, data.get(key) ?? null])),
    setMany: async () => {},
    removeMany: async () => {},
    getAllKeys: async () => [...data.keys()],
    clear: async () => data.clear(),
  };
}

const report = { id: 'a', description: 'x', imageCount: 1, completedAt: '2026-11-03T00:00:00Z', images: [] } as ServerReport;

describe('createListCache', () => {
  it('returns nothing before anything is saved', async () => {
    expect(await createListCache(memoryStorage()).load()).toBeUndefined();
  });

  it('round-trips the saved list', async () => {
    const cache = createListCache(memoryStorage());
    await cache.save([report]);
    expect(await cache.load()).toEqual([report]);
  });

  it('treats unreadable data as no cache', async () => {
    expect(await createListCache(memoryStorage({ 'server-list': '{not json' })).load()).toBeUndefined();
    expect(await createListCache(memoryStorage({ 'server-list': '{"a":1}' })).load()).toBeUndefined();
  });
});
