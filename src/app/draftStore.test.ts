import type { AsyncStorage } from '@react-native-async-storage/async-storage';

import type { ImageFile } from '../core/types';
import { createDraftStore } from './draftStore';

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

const image: ImageFile = { uri: 'file:///a.jpg', mime: 'image/jpeg', bytes: 1000 };

describe('createDraftStore', () => {
  it('has no draft to begin with', async () => {
    expect(await createDraftStore(memoryStorage()).load()).toBeUndefined();
  });

  it('round-trips a draft', async () => {
    const store = createDraftStore(memoryStorage());
    await store.save({ description: 'cracked pipe', images: [image] });
    expect(await store.load()).toEqual({ description: 'cracked pipe', images: [image] });
  });

  it('keeps a draft that has only photos, or only text', async () => {
    const store = createDraftStore(memoryStorage());
    await store.save({ description: '', images: [image] });
    expect((await store.load())?.images).toHaveLength(1);
    await store.save({ description: 'just words', images: [] });
    expect((await store.load())?.description).toBe('just words');
  });

  it('treats an empty draft as no draft', async () => {
    const store = createDraftStore(memoryStorage());
    await store.save({ description: 'x', images: [] });
    await store.save({ description: '   ', images: [] });
    expect(await store.load()).toBeUndefined();
  });

  it('clear removes it', async () => {
    const store = createDraftStore(memoryStorage());
    await store.save({ description: 'x', images: [image] });
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });

  it('treats unreadable or wrongly shaped data as no draft', async () => {
    expect(await createDraftStore(memoryStorage({ draft: '{nope' })).load()).toBeUndefined();
    expect(await createDraftStore(memoryStorage({ draft: '{"description":1}' })).load()).toBeUndefined();
  });
});
