import type { AsyncStorage } from '@react-native-async-storage/async-storage';

import type { ServerReport } from '../core/reportsApi';

const KEY = 'server-list';

/** The last list the server gave us, kept so "Delivered" still shows something when offline. */
export interface ListCache {
  load(): Promise<ServerReport[] | undefined>;
  save(reports: ServerReport[]): Promise<void>;
}

export function createListCache(storage: AsyncStorage): ListCache {
  return {
    async load() {
      try {
        const raw = await storage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : undefined;
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined; // unreadable cache is just no cache
      }
    },
    save: reports => storage.setItem(KEY, JSON.stringify(reports)),
  };
}
